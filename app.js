/* ===========================================================
   PS99 Stats — main controller
=========================================================== */
(() => {
  "use strict";

  // ---------- tiny formatters (mirrors the desktop app's fmt_num/fmt_date) ----------
  function fmtNum(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "-";
    const sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    const units = ["", "K", "M", "B", "T", "Q"];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    const txt = i === 0 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString();
    return sign + txt + units[i];
  }
  function fmtDate(ts) {
    if (!ts) return "-";
    const d = new Date(ts * (ts < 2e10 ? 1000 : 1)); // handle sec or ms epoch
    return d.toISOString().slice(0, 10);
  }
  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    const off = 127397;
    return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + off)).join("");
  }
  function initials(name) {
    return (name || "?").replace(/[\[\]]/g, "").slice(0, 2).toUpperCase();
  }

  // ---------- state ----------
  const state = {
    mode: "clan",
    name: null,
    entity: null,
    kind: null,
    memberSample: new Map(),
    resolvedNames: new Map(),
    rank: null,
    rankTotal: null,
    rankSource: null, // "tracked" | "live" | null
    neighborAbove: null,
    neighborBelow: null,
    prevPoints: new Map(), // uid -> {ts, points}
    gen: 0,
    settings: {
      colCreated: true, colCountry: true, colPoints: true, colGems: true, colJoined: false,
      memberCount: 20, usernameFilter: "", viewMode: "live", interval: 30, showAverages: true,
    },
    sort: { key: "points", dir: "desc" },
    leaderboards: { clan: null, league: null },
    refreshDeadline: 0,
    refreshTimer: null,
    countdownTimer: null,
  };

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    scanBar: $("scanBar"),
    searchForm: $("searchForm"), searchInput: $("searchInput"), suggestions: $("suggestions"),
    modeSwitch: $("modeSwitch"),
    settingsBtn: $("settingsBtn"), settingsDrawer: $("settingsDrawer"), drawerScrim: $("drawerScrim"),
    soundBtn: $("soundBtn"), soundOn: $("soundIconOn"), soundOff: $("soundIconOff"),
    ringFg: $("ringFg"),
    emptyState: $("emptyState"), emptySuggest: $("emptySuggest"),
    dashboard: $("dashboard"), loadingOverlay: $("loadingOverlay"), loadingText: $("loadingText"),
    heroIcon: $("heroIcon"), heroName: $("heroName"), rankBadge: $("rankBadge"),
    heroMeta: $("heroMeta"), heroStats: $("heroStats"),
    chartChips: $("chartChips"), chartSourceNote: $("chartSourceNote"), pointsChart: $("pointsChart"),
    rosterHead: $("rosterHead"), rosterBody: $("rosterBody"), rosterCount: $("rosterCount"),
    gapCards: $("gapCards"),
    statusLine: $("statusLine"),
  };

  // ---------- settings wiring ----------
  function wireSettings() {
    $("colCreated").addEventListener("change", (e) => { state.settings.colCreated = e.target.checked; render(); });
    $("colCountry").addEventListener("change", (e) => { state.settings.colCountry = e.target.checked; render(); });
    $("colPoints").addEventListener("change", (e) => { state.settings.colPoints = e.target.checked; render(); });
    $("colGems").addEventListener("change", (e) => { state.settings.colGems = e.target.checked; render(); });
    $("colJoined").addEventListener("change", (e) => { state.settings.colJoined = e.target.checked; render(); });
    $("showAverages").addEventListener("change", (e) => { state.settings.showAverages = e.target.checked; render(); });

    const mc = $("memberCount"), mcOut = $("memberCountOut");
    mc.addEventListener("input", () => { mcOut.textContent = mc.value; state.settings.memberCount = +mc.value; render(); });

    $("usernameFilter").addEventListener("input", (e) => { state.settings.usernameFilter = e.target.value; render(); });

    $("viewModeSwitch").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn"); if (!btn) return;
      [...e.currentTarget.children].forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.settings.viewMode = btn.dataset.view;
      render();
    });
    $("intervalSwitch").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn"); if (!btn) return;
      [...e.currentTarget.children].forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.settings.interval = +btn.dataset.interval;
      armCountdown();
    });

    el.settingsBtn.addEventListener("click", () => {
      const open = el.settingsDrawer.classList.toggle("is-open");
      el.settingsBtn.setAttribute("aria-pressed", String(open));
      el.drawerScrim.hidden = !open;
    });
    el.drawerScrim.addEventListener("click", closeDrawer);
    function closeDrawer() {
      el.settingsDrawer.classList.remove("is-open");
      el.settingsBtn.setAttribute("aria-pressed", "false");
      el.drawerScrim.hidden = true;
    }

    el.soundBtn.addEventListener("click", () => {
      const next = !PS99Sounds.isEnabled();
      PS99Sounds.setEnabled(next);
      el.soundOn.hidden = !next; el.soundOff.hidden = next;
      el.soundBtn.setAttribute("aria-pressed", String(next));
    });
    const soundOn = PS99Sounds.isEnabled();
    el.soundOn.hidden = !soundOn; el.soundOff.hidden = soundOn;
    el.soundBtn.setAttribute("aria-pressed", String(soundOn));
  }

  function wireSearch() {
    el.modeSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest(".mode-btn"); if (!btn) return;
      [...el.modeSwitch.children].forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
      state.mode = btn.dataset.mode;
      renderSuggestions("");
    });

    el.searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = el.searchInput.value.trim();
      if (!name) return;
      el.suggestions.hidden = true;
      doSearch(name, state.mode);
    });

    el.searchInput.addEventListener("input", () => renderSuggestions(el.searchInput.value.trim()));
    el.searchInput.addEventListener("focus", () => renderSuggestions(el.searchInput.value.trim()));
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-input-wrap")) el.suggestions.hidden = true;
    });
  }

  async function renderSuggestions(query) {
    const board = await getLeaderboard(state.mode);
    if (!board || !board.entries?.length) { el.suggestions.hidden = true; return; }
    const q = query.toLowerCase();
    const pool = board.entries;
    const matches = (q ? pool.filter((c) => c.Name.toLowerCase().includes(q)) : pool).slice(0, 8);
    if (!matches.length) { el.suggestions.hidden = true; return; }
    el.suggestions.innerHTML = matches.map((c) => `
      <div class="suggestion-item" data-name="${escapeHtml(c.Name)}">
        <span class="suggestion-rank">#${c.Rank}</span>
        <span class="suggestion-name">${escapeHtml(c.Name)}</span>
        <span class="suggestion-pts">${fmtNum(c.Points)} pts</span>
      </div>`).join("");
    el.suggestions.hidden = false;
    [...el.suggestions.children].forEach((row) => {
      row.addEventListener("click", () => {
        el.searchInput.value = row.dataset.name;
        el.suggestions.hidden = true;
        doSearch(row.dataset.name, state.mode);
      });
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- leaderboard snapshot (committed by the GitHub Action) ----------
  async function getLeaderboard(kind) {
    if (!state.leaderboards[kind]) {
      state.leaderboards[kind] = await PS99History.loadLeaderboard(kind);
    }
    return state.leaderboards[kind];
  }

  async function primeEmptyState() {
    const board = await getLeaderboard("clan");
    if (!board || !board.entries?.length) return;
    el.emptySuggest.innerHTML = board.entries.slice(0, 5).map((c) =>
      `<button data-name="${escapeHtml(c.Name)}">${escapeHtml(c.Name)}</button>`).join("");
    [...el.emptySuggest.children].forEach((btn) => {
      btn.addEventListener("click", () => { el.searchInput.value = btn.dataset.name; doSearch(btn.dataset.name, "clan"); });
    });
  }

  // ---------- search / refresh cycle ----------
  function search(name, kind) { doSearch(name, kind); }

  async function doSearch(name, kind) {
    state.gen++;
    const gen = state.gen;
    state.name = name; state.kind = kind; state.mode = kind;
    state.prevPoints = new Map();
    clearTimeout(state.refreshTimer);
    clearInterval(state.countdownTimer);

    el.emptyState.hidden = true;
    el.dashboard.hidden = false;
    el.loadingOverlay.hidden = false;
    el.loadingText.textContent = `Loading ${kind} "${name}"…`;
    el.statusLine.textContent = "";
    sweepScanBar();

    try {
      const [entity, sample] = await Promise.all([
        kind === "clan" ? PS99Api.getClan(name) : PS99Api.getLeague(name),
        kind === "clan" ? PS99Api.getClanPlayerSample() : Promise.resolve(new Map()),
      ]);
      if (gen !== state.gen) return;

      let resolvedNames = new Map();
      if (kind === "clan") {
        const uids = (entity.Members || []).map((m) => m.UserID);
        resolvedNames = await PS99Api.resolveUsernames(uids);
      }
      if (gen !== state.gen) return;

      const { rank, total, source, above, below } = await resolveRank(kind, entity, name);
      if (gen !== state.gen) return;

      state.entity = entity; state.memberSample = sample; state.resolvedNames = resolvedNames;
      state.rank = rank; state.rankTotal = total; state.rankSource = source;
      state.neighborAbove = above; state.neighborBelow = below;

      el.loadingOverlay.hidden = true;
      render();
      el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      armCountdown();
      state.refreshTimer = setTimeout(() => silentRefresh(gen, name, kind), state.settings.interval * 1000);
    } catch (err) {
      if (gen !== state.gen) return;
      el.loadingOverlay.hidden = true;
      el.statusLine.textContent = `Not found: "${name}" (${err.message})`;
      PS99Sounds.errorTone();
    }
  }

  async function silentRefresh(gen, name, kind) {
    if (gen !== state.gen) return;
    try {
      const [entity, sample] = await Promise.all([
        kind === "clan" ? PS99Api.getClan(name) : PS99Api.getLeague(name),
        kind === "clan" ? PS99Api.getClanPlayerSample() : Promise.resolve(new Map()),
      ]);
      if (gen !== state.gen) return;
      let resolvedNames = state.resolvedNames;
      if (kind === "clan") {
        const uids = (entity.Members || []).map((m) => m.UserID);
        resolvedNames = await PS99Api.resolveUsernames(uids);
      }
      const { rank, total, source, above, below } = await resolveRank(kind, entity, name);
      if (gen !== state.gen) return;

      const prevTotal = state.entity?.Points;
      state.entity = entity; state.memberSample = sample; state.resolvedNames = resolvedNames;
      state.rank = rank; state.rankTotal = total; state.rankSource = source;
      state.neighborAbove = above; state.neighborBelow = below;

      sweepScanBar();
      render();
      el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      if (entity.Points != null && prevTotal != null) {
        if (entity.Points > prevTotal) PS99Sounds.chime();
        else PS99Sounds.tick();
      } else {
        PS99Sounds.tick();
      }
    } catch (err) {
      el.statusLine.textContent = `Refresh failed: ${err.message}`;
      PS99Sounds.errorTone();
    } finally {
      if (gen === state.gen) {
        armCountdown();
        state.refreshTimer = setTimeout(() => silentRefresh(gen, name, kind), state.settings.interval * 1000);
      }
    }
  }

  // Rank + neighbors: prefer the committed leaderboard snapshot (instant,
  // no live calls, works for anything in the tracked top ~150). Falls back
  // to a live lookup against the API for everything else.
  async function resolveRank(kind, entity, name) {
    const board = await getLeaderboard(kind);
    if (board && board.entries?.length) {
      const idx = board.entries.findIndex((c) => c.Name.toLowerCase() === name.toLowerCase());
      if (idx !== -1) {
        return {
          rank: board.entries[idx].Rank, total: board.total || board.entries.length,
          source: "tracked",
          above: idx > 0 ? board.entries[idx - 1] : null,
          below: idx < board.entries.length - 1 ? board.entries[idx + 1] : null,
        };
      }
    }
    try {
      const { rank, total } = await PS99Api.findLeaderboardRank(kind, entity.Name || name, entity.Points ?? null);
      if (!rank) return { rank: null, total, source: "live", above: null, below: null };
      const [above, below] = await Promise.all([PS99Api.getAtRank(kind, rank - 1), PS99Api.getAtRank(kind, rank + 1)]);
      return { rank, total, source: "live", above, below };
    } catch {
      return { rank: null, total: null, source: null, above: null, below: null };
    }
  }

  // ---------- countdown ring ----------
  function armCountdown() {
    clearInterval(state.countdownTimer);
    const totalMs = state.settings.interval * 1000;
    state.refreshDeadline = Date.now() + totalMs;
    const CIRC = 97.4;
    const tick = () => {
      const remain = Math.max(0, state.refreshDeadline - Date.now());
      const frac = remain / totalMs;
      el.ringFg.style.strokeDashoffset = String(CIRC * (1 - frac));
    };
    tick();
    state.countdownTimer = setInterval(tick, 250);
  }

  function sweepScanBar() {
    el.scanBar.classList.remove("is-active");
    void el.scanBar.offsetWidth; // restart animation
    el.scanBar.classList.add("is-active");
  }

  // ---------- rendering ----------
  function render() {
    if (!state.entity) return;
    renderHero();
    renderRoster();
    renderChart();
    renderGapCards();
  }

  function renderHero() {
    const e = state.entity, kind = state.kind;
    const iconAsset = e.Icon;
    if (iconAsset) {
      const url = PS99Api.iconUrl(iconAsset);
      el.heroIcon.classList.add("skeleton");
      el.heroIcon.onload = () => el.heroIcon.classList.remove("skeleton");
      el.heroIcon.onerror = () => { el.heroIcon.classList.remove("skeleton"); el.heroIcon.style.display = "none"; };
      el.heroIcon.style.display = "";
      el.heroIcon.src = url;
      el.heroIcon.alt = e.Name || "";
    } else {
      el.heroIcon.style.display = "none";
    }

    el.heroName.textContent = e.Name || state.name;

    if (state.rank) {
      el.rankBadge.hidden = false;
      el.rankBadge.textContent = `#${state.rank.toLocaleString()} of ${(state.rankTotal || 0).toLocaleString()}`;
      el.rankBadge.title = state.rankSource === "tracked" ? "From the tracked leaderboard snapshot" : "Live lookup";
    } else {
      el.rankBadge.hidden = true;
    }

    const meta = [];
    if (state.settings.colCreated) meta.push(`<span>Since ${fmtDate(e.Created)}</span>`);
    if (state.settings.colCountry && e.CountryCode) meta.push(`<span>${flagEmoji(e.CountryCode)} ${e.CountryCode}</span>`);
    if (kind === "clan") meta.push(`<span>${(e.Members || []).length}/${e.MemberCapacity || "?"} members</span>`);
    else meta.push(`<span>Level ${e.Level ?? "?"}</span>`, `<span>${(e.Members || []).length} members</span>`);
    el.heroMeta.innerHTML = meta.join("");

    const rows = buildRowData().filtered.slice(0, state.settings.memberCount);
    const stats = [];
    if (e.Points != null) stats.push(statChip(fmtNum(e.Points), "Total points"));
    if (kind === "clan" && e.DepositedDiamonds != null) stats.push(statChip("💎 " + fmtNum(e.DepositedDiamonds), "Clan gems"));
    if (state.settings.showAverages && rows.length) {
      const pts = rows.map((r) => r.points).filter((v) => v != null);
      const gems = rows.map((r) => r.gems).filter((v) => v != null);
      if (pts.length) stats.push(statChip(fmtNum(pts.reduce((a, b) => a + b, 0) / pts.length), "Avg pts/member"));
      if (gems.length) stats.push(statChip("💎 " + fmtNum(gems.reduce((a, b) => a + b, 0) / gems.length), "Avg gems/member"));
    }
    el.heroStats.innerHTML = stats.join("");
  }
  function statChip(v, l) { return `<div class="hero-stat"><span class="v">${v}</span><span class="l">${l}</span></div>`; }

  function buildRowData() {
    const e = state.entity, kind = state.kind;
    let rows = [];
    if (kind === "clan") {
      rows = (e.Members || []).map((m) => {
        const uid = m.UserID;
        const sample = state.memberSample.get(uid);
        const name = sample ? String(sample.DisplayName) : (state.resolvedNames.get(uid) || String(uid));
        return {
          uid, name,
          points: sample ? sample.ActiveBattlePoints : null,
          gems: sample ? sample.AllTimeDiamonds : null,
          joined: m.JoinTime,
        };
      });
      rows.sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
    } else {
      const contrib = new Map((e.PointContributions || []).map((c) => [c.UserID, c]));
      rows = (e.Members || []).map((m) => {
        const c = contrib.get(m.UserID);
        return { uid: m.UserID, name: m.DisplayName || String(m.UserID), points: c ? c.Points : 0, gems: null, joined: m.JoinTime };
      });
      if (e.Owner?.UserID) {
        const c = contrib.get(e.Owner.UserID);
        rows.push({ uid: e.Owner.UserID, name: (e.Owner.DisplayName || String(e.Owner.UserID)) + " (owner)", points: c ? c.Points : 0, gems: null, joined: e.Created });
      }
      rows.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    }

    const sortKey = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    if (sortKey !== "default") {
      rows.sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === "string" || typeof bv === "string") return dir * String(av ?? "").localeCompare(String(bv ?? ""));
        return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
      });
    }

    const needle = state.settings.usernameFilter.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
    return { all: rows, filtered };
  }

  const COLUMNS = [
    { key: "rank", label: "#" },
    { key: "name", label: "Name" },
    { key: "points", label: "Points", setting: "colPoints" },
    { key: "rate", label: "Δ" },
    { key: "gems", label: "💎", setting: "colGems", clanOnly: true },
    { key: "joined", label: "Joined", setting: "colJoined" },
  ];

  function renderRoster() {
    const kind = state.kind;
    const cols = COLUMNS.filter((c) => (!c.setting || state.settings[c.setting]) && (!c.clanOnly || kind === "clan"));

    el.rosterHead.innerHTML = cols.map((c) => {
      const label = c.key === "rate" ? (state.settings.viewMode === "hourly" ? "≈/hr" : "Δ") : c.label;
      const sorted = state.sort.key === c.key ? `sorted ${state.sort.dir}` : "";
      return `<th data-key="${c.key}" class="${sorted}">${label}</th>`;
    }).join("");
    [...el.rosterHead.children].forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else { state.sort.key = key; state.sort.dir = "desc"; }
        renderRoster();
      });
    });

    const { filtered } = buildRowData();
    const shown = filtered.slice(0, state.settings.memberCount);
    const now = Date.now();
    const newPrev = new Map();

    el.rosterBody.innerHTML = shown.map((r, i) => {
      const prev = state.prevPoints.get(r.uid);
      let rateTxt = "-", rateClass = "muted-cell";
      if (r.points != null) {
        newPrev.set(r.uid, { ts: now, points: r.points });
        if (prev) {
          const dtH = Math.max(now - prev.ts, 1000) / 3600000;
          const delta = r.points - prev.points;
          if (state.settings.viewMode === "hourly") rateTxt = fmtNum(delta / dtH);
          else rateTxt = delta ? fmtNum(delta) : "0";
          rateClass = delta > 0 ? "pts-up" : delta < 0 ? "pts-down" : "muted-cell";
        }
      }
      const cells = cols.map((c) => {
        if (c.key === "rank") return `<td>${i + 1}</td>`;
        if (c.key === "name") return `<td class="name-cell">${escapeHtml(r.name)}</td>`;
        if (c.key === "points") return `<td>${fmtNum(r.points)}</td>`;
        if (c.key === "rate") return `<td class="${rateClass}">${rateTxt}</td>`;
        if (c.key === "gems") return `<td>${r.gems != null ? fmtNum(r.gems) : "-"}</td>`;
        if (c.key === "joined") return `<td>${fmtDate(r.joined)}</td>`;
        return "<td>-</td>";
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    state.prevPoints = newPrev;
    el.rosterCount.textContent = `${shown.length} of ${filtered.length} shown`;
  }

  async function renderChart() {
    const kind = state.kind, name = state.entity.Name || state.name;
    if (state.entity.Points != null) PS99History.pushSessionPoint(kind, name, state.entity.Points);

    const committed = await PS99History.loadHistory(kind, name);
    const session = PS99History.getSessionSeries(kind, name);
    const committedSeries = committed?.points || [];
    const series = PS99History.mergeSeries(committedSeries, session);

    if (series.length < 2) {
      el.chartSourceNote.textContent = "collecting live data…";
      el.chartChips.innerHTML = "";
      return;
    }
    PS99Charts.render(el.pointsChart, series);
    el.chartSourceNote.textContent = committed ? "last 24h · tracked snapshot + live session" : "live session only (not yet in the tracked top ~150)";

    const stats = PS99History.seriesStats(series);
    if (stats) {
      el.chartChips.innerHTML = [
        chip(fmtNum(stats.total), "Total"),
        chip(fmtNum(stats.avgPerHour), "Avg / h"),
        chip(fmtNum(stats.bestPerHour), "Best / h"),
        chip(fmtNum(stats.latestPerHour), "Latest / h"),
      ].join("");
    }
    function chip(v, l) { return `<div class="chip"><span class="v">${v}</span><span class="l">${l}</span></div>`; }
  }

  async function renderGapCards() {
    const kind = state.kind, name = state.entity.Name || state.name, myPoints = state.entity.Points;
    const cards = [];
    for (const [neighbor, who] of [[state.neighborAbove, "above"], [state.neighborBelow, "below"]]) {
      if (!neighbor || myPoints == null) continue;
      const gap = Math.abs((neighbor.Points ?? 0) - myPoints);
      const myHist = await PS99History.loadHistory(kind, name);
      const theirHist = await PS99History.loadHistory(kind, neighbor.Name);
      const myRate = PS99History.hourlyRateFromSeries(PS99History.mergeSeries(myHist?.points, PS99History.getSessionSeries(kind, name)));
      const theirRate = theirHist ? PS99History.hourlyRateFromSeries(theirHist.points) : null;

      let trendHtml = "";
      if (myRate != null && theirRate != null) {
        const closing = myRate > theirRate;
        const magnitude = Math.abs(myRate - theirRate);
        trendHtml = `<div class="gap-trend ${closing ? "closing" : "extending"}">${closing ? "Closing" : "Extending"} · ${fmtNum(magnitude)}/h</div>`;
      }

      cards.push(`
        <div class="gap-card">
          <div class="gap-card-head">
            <div><span class="who">Gap to ${who === "above" ? "#" + (state.rank - 1) : "#" + (state.rank + 1)}</span><br><span class="name">${escapeHtml(neighbor.Name)}</span></div>
            <span class="gap">${fmtNum(gap)}</span>
          </div>
          <div class="gap-stats">
            <div class="gap-stat"><span class="v">${myRate != null ? fmtNum(myRate) : "-"}</span><span class="l">Your ${state.settings.viewMode === "hourly" ? "≈/h" : "gain"}</span></div>
            <div class="gap-stat"><span class="v">${theirRate != null ? fmtNum(theirRate) : "-"}</span><span class="l">Their /h</span></div>
          </div>
          ${trendHtml}
        </div>`);
    }
    el.gapCards.innerHTML = cards.length ? cards.join("") : `<div class="gap-empty">No leaderboard neighbors found for this ${kind}.</div>`;
  }

  // ---------- init ----------
  function init() {
    wireSettings();
    wireSearch();
    primeEmptyState();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
