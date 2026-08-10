/* ===========================================================
   PS99Api — thin wrapper around the public BIG Games API.
   Docs: https://github.com/BIG-Games-LLC/ps99-public-api-docs

   Caveats baked in on purpose (not bugs):
   - Per-member points/gems for CLANS only exist for the ~25
     top clans sampled by /v1/clans/players. Smaller clans
     still get real usernames (via Roblox's users API) and a
     full roster, just without those two numeric columns.
   - LEAGUES expose exact per-member points for everyone.
   - There's no history endpoint at all — that's what
     data/history/*.json (built by the GitHub Action) is for.
=========================================================== */
const PS99Api = (() => {
  const LEGACY = "https://ps99.biggamesapi.io/api";
  const V1 = "https://ps99.biggamesapi.io/v1";
  const IMG_PROXY = (id) => `https://ps99.biggamesapi.io/image/${id}`;

  const nameCache = new Map(); // uid -> resolved username

  async function getJSON(url, params) {
    const u = new URL(url);
    if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.status && body.status !== "ok") {
      throw new Error(body.error?.message || "API error");
    }
    return body.data !== undefined ? body.data : body;
  }

  function assetIdOf(rbx) {
    if (!rbx) return null;
    return String(rbx).replace("rbxassetid://", "").trim();
  }

  function iconUrl(rbx) {
    const id = assetIdOf(rbx);
    return id ? IMG_PROXY(id) : null;
  }

  async function getClan(name) {
    return getJSON(`${LEGACY}/clan/${encodeURIComponent(name)}`);
  }

  async function getLeague(name) {
    return getJSON(`${V1}/leagues/${encodeURIComponent(name)}`);
  }

  async function getClanPlayerSample() {
    try {
      const data = await getJSON(`${V1}/clans/players`);
      const map = new Map();
      (data.players || []).forEach((p) => map.set(p.UserID, p));
      return map;
    } catch {
      return new Map();
    }
  }

  async function resolveUsernames(uids) {
    const unique = [...new Set(uids.filter((u) => u != null))];
    const result = new Map();
    const uncached = [];
    unique.forEach((u) => {
      if (nameCache.has(u)) result.set(u, nameCache.get(u));
      else uncached.push(u);
    });
    for (let i = 0; i < uncached.length; i += 100) {
      const chunk = uncached.slice(i, i + 100);
      try {
        const res = await fetch("https://users.roblox.com/v1/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: chunk, excludeBannedUsers: false }),
        });
        const body = await res.json();
        (body.data || []).forEach((item) => {
          const name = item.displayName || item.name || String(item.id);
          result.set(item.id, name);
          nameCache.set(item.id, name);
        });
      } catch {
        /* username resolution is a nice-to-have; roster still renders with IDs */
      }
    }
    return result;
  }

  const RANK_PAGE_SIZE = 100;
  const RANK_LINEAR_CAP_PAGES = 20; // cheap fallback cap: top 2000

  // Live leaderboard rank finder: binary search when we know the entity's
  // own point total (fast, ~log2(total/100) requests), otherwise a capped
  // linear scan of the leaderboard's top 2000. Prefer PS99Store's committed
  // snapshot (data/leaderboard/*.json) before calling this — it's instant
  // and needs zero live requests for anything in the tracked top ~150.
  async function findLeaderboardRank(kind, name, targetPoints) {
    const nameLower = name.toLowerCase();
    let total;
    let getPage;

    if (kind === "clan") {
      total = await getJSON(`${LEGACY}/clansTotal`);
      getPage = (p) => getJSON(`${LEGACY}/clans`, { page: p, pageSize: RANK_PAGE_SIZE, sort: "Points", sortOrder: "desc" });
    } else {
      const first = await getJSON(`${V1}/leagues`, { page: 1, pageSize: RANK_PAGE_SIZE, sort: "Points", sortOrder: "desc" });
      total = first.total || 0;
      getPage = async (p) => (await getJSON(`${V1}/leagues`, { page: p, pageSize: RANK_PAGE_SIZE, sort: "Points", sortOrder: "desc" })).leagues;
    }
    if (!total) return { rank: null, total: 0 };

    if (targetPoints == null) {
      const pages = Math.min(RANK_LINEAR_CAP_PAGES, Math.ceil(total / RANK_PAGE_SIZE));
      for (let p = 1; p <= pages; p++) {
        const items = await getPage(p);
        if (!items || !items.length) break;
        const idx = items.findIndex((it) => (it.Name || "").toLowerCase() === nameLower);
        if (idx !== -1) return { rank: (p - 1) * RANK_PAGE_SIZE + idx + 1, total };
      }
      return { rank: null, total };
    }

    let lo = 1, hi = Math.max(1, Math.ceil(total / RANK_PAGE_SIZE));
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const items = await getPage(mid);
      if (!items || !items.length) { hi = mid - 1; continue; }
      const top = items[0].Points, bottom = items[items.length - 1].Points;
      if (targetPoints > top) { hi = mid - 1; }
      else if (targetPoints < bottom) { lo = mid + 1; }
      else {
        let idx = items.findIndex((it) => (it.Name || "").toLowerCase() === nameLower);
        if (idx === -1) idx = items.findIndex((it) => it.Points <= targetPoints);
        return idx === -1 ? { rank: null, total } : { rank: (mid - 1) * RANK_PAGE_SIZE + idx + 1, total };
      }
    }
    return { rank: null, total };
  }

  // Fetch the single entity sitting at leaderboard position `rank`
  // (pageSize=1 means `page` IS the rank) — used for live neighbor lookups
  // when an entity isn't in the committed top-150 snapshot.
  async function getAtRank(kind, rank) {
    if (rank < 1) return null;
    try {
      if (kind === "clan") {
        const items = await getJSON(`${LEGACY}/clans`, { page: rank, pageSize: 1, sort: "Points", sortOrder: "desc" });
        return items[0] || null;
      }
      const data = await getJSON(`${V1}/leagues`, { page: rank, pageSize: 1, sort: "Points", sortOrder: "desc" });
      return (data.leagues || [])[0] || null;
    } catch {
      return null;
    }
  }

  return { getClan, getLeague, getClanPlayerSample, resolveUsernames, findLeaderboardRank, getAtRank, iconUrl, assetIdOf };
})();
