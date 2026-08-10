/* ===========================================================
   PS99 Stats — main controller
=========================================================== */
(() => {
  "use strict";

  // ---------- tiny formatters ----------
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
    const d = new Date(ts * (ts < 2e10 ? 1000 : 1));
    return d.toISOString().slice(0, 10);
  }
  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    const off = 127397;
    return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + off)).join("");
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- state ----------
  const state = {
    view: "browse",        // "browse" | "detail"
    mode: "clan",           // clan/league toggle, applies to both browse + search
    activeTab: "overview",
    name: null, entity: null, kind: null,
    memberSample: new Map(), resolvedNames: new Map(),
    rank: null, rankTotal: null, rankSource: null,
    neighborAbove: null, neighborBelow: null,
    prevPoints: new Map(),
    gen: 0,
    settings: {
      colCreated: true, colCountry: true, colPoints: true, colGems: true, colJoined: false,
      memberCount: 20, usernameFilter: "", viewMode: "live", interval: 30, showAverages: true,
    },
    sort: { key: "points", dir: "desc" },
    leaderboards: { clan: null, league: null },
    refreshDeadline: 0, refreshTimer: null, countdownTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    scanBar: $("scanBar"),
    searchForm: $("searchForm"), searchInput: $("searchInput"), suggestions: $("suggestions"),
    modeSwitch: $("modeSwitch"),
    settingsBtn: $("settingsBtn"), settingsDrawer: $("settingsDrawer"), drawerScrim: $("drawerScrim"),
    soundBtn: $("soundBtn"), soundOn: $("soundIconOn"), soundOff: $("soundIconOff"),
    ringFg: $("ringFg"),
    browseState: $("browseState"), browseGrid: $("browseGrid"), browseTitle: $("browseTitle"), browseTotal: $("browseTotal"),
    dashboard: $("dashboard"), loadingOverlay: $("loadingOverlay"), loadingText: $("loadingText"), backBtn: $("backBtn"),
    heroIcon: $("heroIcon"), heroIconFallback: $("heroIconFallback"), heroName: $("heroName"), rankBadge: $("rankBadge"),
    heroMeta: $("heroMeta"), heroStats: $("heroStats"),
    tabbar: $("tabbar"), tabIndicator: $("tabIndicator"),
    tabOverview: $("tabOverview"), tabMembers: $("tabMembers"), tabBattle: $("tabBattle"),
    chartChips: $("chartChips"), chartSourceNote: $("chartSourceNote"), pointsChart: $("pointsChart"),
    rankUpGrid: $("rankUpGrid"), formRow: $("formRow"),
    rosterHead: $("rosterHead"), rosterBody: $("rosterBody"), rosterCount: $("rosterCount"),
    gapCards: $("gapCards"),
    battleTitle: $("battleTitle"), battleSub: $("battleSub"), battleBody: $("battleBody"),
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
    el.drawerScrim.addEventListener("click", () => {
      el.settingsDrawer.classList.remove("is-open");
      el.settingsBtn.setAttribute("aria-pressed", "false");
      el.drawerScrim.hidden = true;
    });

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

  // ---------- search / mode / tabs wiring ----------
  function wireSearch() {
    el.modeSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest(".mode-btn"); if (!btn) return;
      [...el.modeSwitch.children].forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
      state.mode = btn.dataset.mode;
      renderSuggestions("");
      if (state.view === "browse") showBrowse(state.mode);
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

    el.backBtn.addEventListener("click", () => showBrowse(state.mode));

    el.tabbar.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn"); if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    [...el.tabbar.querySelectorAll(".tab-btn")].forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    el.tabOverview.hidden = tab !== "overview";
    el.tabMembers.hidden = tab !== "members";
    el.tabBattle.hidden = tab !== "battle";
    positionTabIndicator();
    if (tab === "battle") renderBattleTab();
  }
  function positionTabIndicator() {
    const activeBtn = el.tabbar.querySelector(".tab-btn.is-active");
    if (!activeBtn) return;
    el.tabIndicator.style.left = activeBtn.offsetLeft + "px";
    el.tabIndicator.style.width = activeBtn.offsetWidth + "px";
  }

  async function renderSuggestions(query) {
    const board = await getLeaderboard(state.mode);
    if (!board || !board.entries?.length) { el.suggestions.hidden = true; return; }
    const q = query.toLowerCase();
    const matches = (q ? board.entries.filter((c) => c.Name.toLowerCase().includes(q)) : board.entries).slice(0, 8);
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

  // ---------- leaderboard snapshot ----------
  async function getLeaderboard(kind) {
    if (!state.leaderboards[kind]) state.leaderboards[kind] = await PS99History.loadLeaderboard(kind);
    return state.leaderboards[kind];
  }

  // ---------- browse (top-100 grid) ----------
  async function showBrowse(kind) {
    state.view = "browse"; state.mode = kind;
    clearTimeout(state.refreshTimer); clearInterval(state.countdownTimer);
    el.dashboard.hidden = true;
    el.browseState.hidden = false;
    el.browseTitle.textContent = kind === "clan" ? "Top clans" : "Top leagues";
    el.browseGrid.innerHTML = Array.from({ length: 8 }).map(() => `<div class="browse-card skeleton" aria-hidden="true"></div>`).join("");

    const board = await getLeaderboard(kind);
    if (!board || !board.entries?.length) {
      el.browseGrid.innerHTML = `<div class="form-empty">No tracked leaderboard data yet — the collector Action may not have run. You can still search any ${kind} by name above.</div>`;
      el.browseTotal.textContent = "";
      return;
    }
    el.browseTotal.textContent = `${board.total.toLocaleString()} total ${kind}s tracked · showing top ${Math.min(100, board.entries.length)}`;
    el.browseGrid.innerHTML = board.entries.slice(0, 100).map((c, i) => `
      <button type="button" class="browse-card" style="--i:${i}" data-name="${escapeHtml(c.Name)}">
        <img class="browse-card-icon" alt="" loading="lazy" src="${c.Icon ? PS99Api.iconUrl(c.Icon) : ""}" onerror="this.style.visibility='hidden'">
        <div class="browse-card-body">
          <div class="browse-card-rank">Position ${c.Rank}</div>
          <div class="browse-card-name">${escapeHtml(c.Name)}</div>
          <div class="browse-card-stats"><span class="pts">${fmtNum(c.Points)} pts</span><span>${c.Members ?? "?"} members</span></div>
        </div>
      </button>`).join("");
    [...el.browseGrid.children].forEach((card) => {
      card.addEventListener("click", () => { el.searchInput.value = card.dataset.name; doSearch(card.dataset.name, kind); });
    });
  }

  // ---------- search / refresh cycle ----------
  async function doSearch(name, kind) {
    state.gen++;
    const gen = state.gen;
    state.name = name; state.kind = kind; state.mode = kind; state.view = "detail";
    state.prevPoints = new Map();
    clearTimeout(state.refreshTimer); clearInterval(state.countdownTimer);

    el.browseState.hidden = true;
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
        resolvedNames = await PS99Api.resolveUsernames((entity.Members || []).map((m) => m.UserID));
      }
      if (gen !== state.gen) return;

      const { rank, total, source, above, below } = await resolveRank(kind, entity, name);
      if (gen !== state.gen) return;

      Object.assign(state, { entity, memberSample: sample, resolvedNames, rank, rankTotal: total, rankSource: source, neighborAbove: above, neighborBelow: below });

      el.loadingOverlay.hidden = true;
      setActiveTab("overview");
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
      if (kind === "clan") resolvedNames = await PS99Api.resolveUsernames((entity.Members || []).map((m) => m.UserID));
      const { rank, total, source, above, below } = await resolveRank(kind, entity, name);
      if (gen !== state.gen) return;

      const prevTotal = state.entity?.Points;
      Object.assign(state, { entity, memberSample: sample, resolvedNames, rank, rankTotal: total, rankSource: source, neighborAbove: above, neighborBelow: below });

      sweepScanBar();
      render();
      el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      if (entity.Points != null && prevTotal != null) (entity.Points > prevTotal ? PS99Sounds.chime() : PS99Sounds.tick());
      else PS99Sounds.tick();
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

  async function resolveRank(kind, entity, name) {
    const board = await getLeaderboard(kind);
    if (board && board.entries?.length) {
      const idx = board.entries.findIndex((c) => c.Name.toLowerCase() === name.toLowerCase());
      if (idx !== -1) {
        return {
          rank: board.entries[idx].Rank, total: board.total || board.entries.length, source: "tracked",
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
      el.ringFg.style.strokeDashoffset = String(CIRC * (1 - remain / totalMs));
    };
    tick();
    state.countdownTimer = setInterval(tick, 250);
  }
  function sweepScanBar() {
    el.scanBar.classList.remove("is-active");
    void el.scanBar.offsetWidth;
    el.scanBar.classList.add("is-active");
  }

  // ---------- row data (with defensive field auto-detection) ----------
  const CLAN_IGNORE = new Set([
    "UserID", "JoinTime", "PermissionLevel", "DisplayName",
    "Points", "ActiveBattlePoints", "BattlePoints", "ContributionPoints",
    "Diamonds", "DonatedDiamonds", "DiamondsDonated", "Donations", "TotalDonated", "AllTimeDiamonds",
  ]);
  const LEAGUE_IGNORE = new Set(["UserID", "JoinTime", "DisplayName", "Points"]);

  function buildRowData() {
    const e = state.entity, kind = state.kind;
    let rows = [];
    if (kind === "clan") {
      rows = (e.Members || []).map((m) => {
        const uid = m.UserID;
        const sample = state.memberSample.get(uid);
        const raw = sample ? { ...m, ...sample } : m;
        const name = sample ? String(sample.DisplayName) : (state.resolvedNames.get(uid) || String(uid));
        const points = sample ? sample.ActiveBattlePoints : PS99Api.pick(m, ["Points", "ActiveBattlePoints", "BattlePoints", "ContributionPoints"]);
        const gems = sample ? sample.AllTimeDiamonds : PS99Api.pick(m, ["Diamonds", "DonatedDiamonds", "DiamondsDonated", "Donations", "TotalDonated", "AllTimeDiamonds"]);
        return { uid, name, points: points ?? null, gems: gems ?? null, joined: m.JoinTime, extra: PS99Api.extraNumericFields(raw, CLAN_IGNORE) };
      });
    } else {
      const contrib = new Map((e.PointContributions || []).map((c) => [c.UserID, c]));
      rows = (e.Members || []).map((m) => {
        const c = contrib.get(m.UserID);
        const raw = c ? { ...m, ...c } : m;
        return { uid: m.UserID, name: m.DisplayName || String(m.UserID), points: c ? c.Points : 0, gems: null, joined: m.JoinTime, extra: PS99Api.extraNumericFields(raw, LEAGUE_IGNORE) };
      });
      if (e.Owner?.UserID) {
        const c = contrib.get(e.Owner.UserID);
        rows.push({ uid: e.Owner.UserID, name: (e.Owner.DisplayName || String(e.Owner.UserID)) + " (owner)", points: c ? c.Points : 0, gems: null, joined: e.Created, extra: {} });
      }
    }

    const sortKey = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortKey.startsWith("extra:") ? a.extra[sortKey.slice(6)] : a[sortKey];
      const bv = sortKey.startsWith("extra:") ? b.extra[sortKey.slice(6)] : b[sortKey];
      if (typeof av === "string" || typeof bv === "string") return dir * String(av ?? "").localeCompare(String(bv ?? ""));
      return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });

    const needle = state.settings.usernameFilter.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
    return { all: rows, filtered };
  }

  // Hourly-equivalent rate for a row, independent of the Live/Hourly toggle
  // (used by the roster Δ column *and* the Player Form widget).
  function rateFor(uid, points, now, forHourly) {
    const prev = state.prevPoints.get(uid);
    if (points == null || !prev) return null;
    const dtH = Math.max(now - prev.ts, 1000) / 3600000;
    const delta = points - prev.points;
    return forHourly ? delta / dtH : delta;
  }

  // ---------- rendering ----------
  function render() {
    if (!state.entity) return;
    renderHero();
    renderRoster();
    renderChart();
    renderGapCards();
    renderRankUp();
    requestAnimationFrame(positionTabIndicator);
  }

  function renderHero() {
    const e = state.entity, kind = state.kind;
    if (e.Icon) {
      const url = PS99Api.iconUrl(e.Icon);
      el.heroIconFallback.hidden = true;
      el.heroIcon.hidden = false;
      el.heroIcon.classList.add("skeleton");
      el.heroIcon.onload = () => el.heroIcon.classList.remove("skeleton");
      el.heroIcon.onerror = () => { el.heroIcon.hidden = true; el.heroIconFallback.hidden = false; el.heroIconFallback.textContent = (e.Name || "?").slice(0, 2).toUpperCase(); };
      el.heroIcon.src = url; el.heroIcon.alt = e.Name || "";
    } else {
      el.heroIcon.hidden = true;
      el.heroIconFallback.hidden = false;
      el.heroIconFallback.textContent = (e.Name || "?").slice(0, 2).toUpperCase();
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

  const BASE_COLUMNS = [
    { key: "rank", label: "#" },
    { key: "name", label: "Name" },
    { key: "points", label: "Points", setting: "colPoints" },
    { key: "rate", label: "Δ" },
    { key: "gems", label: "💎", setting: "colGems", clanOnly: true },
    { key: "joined", label: "Joined", setting: "colJoined" },
  ];

  function renderRoster() {
    const kind = state.kind;
    const { filtered } = buildRowData();
    const shown = filtered.slice(0, state.settings.memberCount);

    const extraKeySet = new Set();
    shown.forEach((r) => Object.keys(r.extra).forEach((k) => extraKeySet.add(k)));
    const extraCols = [...extraKeySet].slice(0, 3).map((k) => ({ key: `extra:${k}`, label: PS99Api.prettyKey(k) }));

    const cols = [...BASE_COLUMNS.filter((c) => (!c.setting || state.settings[c.setting]) && (!c.clanOnly || kind === "clan")), ...extraCols];

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

    const now = Date.now();
    const newPrev = new Map();

    el.rosterBody.innerHTML = shown.map((r, i) => {
      const delta = rateFor(r.uid, r.points, now, state.settings.viewMode === "hourly");
      if (r.points != null) newPrev.set(r.uid, { ts: now, points: r.points });
      let rateTxt = "-", rateClass = "muted-cell";
      if (delta != null) { rateTxt = delta ? fmtNum(delta) : "0"; rateClass = delta > 0 ? "pts-up" : delta < 0 ? "pts-down" : "muted-cell"; }

      const cells = cols.map((c) => {
        if (c.key === "rank") return `<td>${i + 1}</td>`;
        if (c.key === "name") return `<td class="name-cell">${escapeHtml(r.name)}</td>`;
        if (c.key === "points") return `<td>${fmtNum(r.points)}</td>`;
        if (c.key === "rate") return `<td class="${rateClass}">${rateTxt}</td>`;
        if (c.key === "gems") return `<td>${r.gems != null ? fmtNum(r.gems) : "-"}</td>`;
        if (c.key === "joined") return `<td>${fmtDate(r.joined)}</td>`;
        if (c.key.startsWith("extra:")) { const v = r.extra[c.key.slice(6)]; return `<td>${v != null ? fmtNum(v) : "-"}</td>`; }
        return "<td>-</td>";
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    state.prevPoints = newPrev;
    el.rosterCount.textContent = `${shown.length} of ${filtered.length} shown`;

    renderPlayerForm(shown, now);
  }

  async function renderPlayerForm(rows, now) {
    const ranked = rows
      .map((r) => ({ ...r, hourly: rateFor(r.uid, r.points, now, true) }))
      .filter((r) => r.hourly != null && r.hourly > 0)
      .sort((a, b) => b.hourly - a.hourly)
      .slice(0, 3);

    if (!ranked.length) {
      el.formRow.innerHTML = `<div class="form-empty">Collecting data — best gainers show up after a couple of refreshes.</div>`;
      return;
    }
    const avatars = await PS99Api.getAvatarHeadshots(ranked.map((r) => r.uid));
    el.formRow.innerHTML = ranked.map((r) => {
      const av = avatars.get(r.uid);
      const img = av
        ? `<img class="form-avatar" src="${av}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'form-avatar-fallback',textContent:'${escapeHtml(r.name).slice(0, 2).toUpperCase()}'}))">`
        : `<div class="form-avatar-fallback">${escapeHtml(r.name).slice(0, 2).toUpperCase()}</div>`;
      return `<div class="form-card">${img}<div><div class="form-name">${escapeHtml(r.name)}</div><div class="form-gain">+${fmtNum(r.hourly)} · 1h</div></div></div>`;
    }).join("");
  }

  async function renderChart() {
    const kind = state.kind, name = state.entity.Name || state.name;
    if (state.entity.Points != null) PS99History.pushSessionPoint(kind, name, state.entity.Points);

    const committed = await PS99History.loadHistory(kind, name);
    const session = PS99History.getSessionSeries(kind, name);
    const series = PS99History.mergeSeries(committed?.points, session);

    if (series.length < 2) {
      el.chartSourceNote.textContent = "collecting live data…";
      el.chartChips.innerHTML = "";
      return;
    }
    PS99Charts.render(el.pointsChart, series);
    el.chartSourceNote.textContent = committed ? "last 24h · tracked snapshot + live session" : "live session only (not yet in the tracked top ~150)";

    const stats = PS99History.seriesStats(series);
    if (stats) {
      const chip = (v, l) => `<div class="chip"><span class="v">${v}</span><span class="l">${l}</span></div>`;
      el.chartChips.innerHTML = [
        chip(fmtNum(stats.total), "Total"), chip(fmtNum(stats.avgPerHour), "Avg / h"),
        chip(fmtNum(stats.bestPerHour), "Best / h"), chip(fmtNum(stats.latestPerHour), "Latest / h"),
      ].join("");
    }
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
        trendHtml = `<div class="gap-trend ${closing ? "closing" : "extending"}">${closing ? "Closing" : "Extending"} · ${fmtNum(Math.abs(myRate - theirRate))}/h</div>`;
      }
      const rankLabel = who === "above" ? "#" + (state.rank - 1) : "#" + (state.rank + 1);
      cards.push(`
        <div class="gap-card">
          <div class="gap-card-head">
            <div><span class="who">Gap to ${rankLabel}</span><br><span class="name">${escapeHtml(neighbor.Name)}</span></div>
            <span class="gap">${fmtNum(gap)}</span>
          </div>
          <div class="gap-stats">
            <div class="gap-stat"><span class="v">${myRate != null ? fmtNum(myRate) : "-"}</span><span class="l">Your ≈/h</span></div>
            <div class="gap-stat"><span class="v">${theirRate != null ? fmtNum(theirRate) : "-"}</span><span class="l">Their ≈/h</span></div>
          </div>
          ${trendHtml}
        </div>`);
    }
    el.gapCards.innerHTML = cards.length ? cards.join("") : `<div class="gap-empty">No leaderboard neighbors found for this ${kind}.</div>`;
  }

  async function renderRankUp() {
    const kind = state.kind, myPoints = state.entity.Points;
    const board = await getLeaderboard(kind);
    if (!board || !board.entries?.length || myPoints == null || !state.rank) {
      el.rankUpGrid.innerHTML = `<div class="form-empty">Only available for the tracked top ~150 ${kind}s.</div>`;
      return;
    }
    const targets = [];
    if (state.rank > 1) targets.push({ label: "Next position", rank: state.rank - 1 });
    for (const r of [1, 2, 3, 5, 10, 25, 50, 100]) if (r < state.rank) targets.push({ label: ordinal(r), rank: r });

    el.rankUpGrid.innerHTML = targets.map((t) => {
      const entry = board.entries[t.rank - 1];
      if (!entry) return "";
      const needed = entry.Points - myPoints;
      const passed = needed <= 0;
      return `<div class="rankup-cell">
        <span class="l">${t.label}</span>
        <span class="v ${passed ? "passed" : ""}">${passed ? "Passed" : fmtNum(needed)}</span>
        <span class="sub">${fmtNum(entry.Points)} pts</span>
      </div>`;
    }).join("") || `<div class="form-empty">Already #1 — nothing left to chase.</div>`;
  }

  // ---------- current battle tab (defensive: shape isn't publicly documented) ----------
  function findMedalFields(entity) {
    return Object.entries(entity || {}).filter(([k, v]) => /medals?$/i.test(k) && typeof v === "number");
  }
  function findClanInBattle(battleData, name) {
    if (!battleData) return null;
    const nameLower = name.toLowerCase();
    const candidateArrays = [];
    if (Array.isArray(battleData)) candidateArrays.push(battleData);
    for (const key of ["Clans", "Results", "Leaderboard", "Battles", "Data"]) {
      if (Array.isArray(battleData[key])) candidateArrays.push(battleData[key]);
    }
    for (const arr of candidateArrays) {
      const hit = arr.find((it) => {
        const n = PS99Api.pick(it, ["ClanName", "Name"]);
        return n && String(n).toLowerCase() === nameLower;
      });
      if (hit) return hit;
    }
    if (battleData[name]) return battleData[name];
    const foundKey = Object.keys(battleData).find((k) => k.toLowerCase() === nameLower);
    return foundKey ? battleData[foundKey] : null;
  }
  function extractContributionPoints(clanBattleEntry) {
    if (!clanBattleEntry) return [];
    let list = PS99Api.pick(clanBattleEntry, ["Contribution", "Members", "Players", "Scores"]);
    if (list && !Array.isArray(list)) list = PS99Api.pick(list, ["Battle", "Points"]);
    if (!Array.isArray(list)) return [];
    return list.map((it) => PS99Api.pick(it, ["Points", "Score", "Amount"])).filter((v) => typeof v === "number");
  }

  async function renderBattleTab() {
    const kind = state.kind, e = state.entity;
    if (kind !== "clan") {
      el.battleTitle.textContent = "Current battle";
      el.battleSub.textContent = "";
      el.battleBody.innerHTML = `<div class="battle-empty">Battle data is a clan-only feature.</div>`;
      return;
    }
    el.battleBody.innerHTML = `<div class="battle-empty">Loading…</div>`;
    const battleData = await PS99Api.getActiveClanBattle();
    const entry = findClanInBattle(battleData, e.Name || state.name);
    const points = extractContributionPoints(entry);
    const battleName = PS99Api.pick(battleData, ["Name", "BattleName", "Title"]) || PS99Api.pick(entry, ["Name", "BattleName"]) || "Current battle";
    el.battleTitle.textContent = battleName;

    const medals = findMedalFields(e);
    const parts = [];
    if (points.length) {
      const avg = points.reduce((a, b) => a + b, 0) / points.length;
      const max = Math.max(...points), min = Math.min(...points);
      el.battleSub.textContent = `${points.length} members with battle points`;
      parts.push(`<div class="battle-stat-row">
        ${statChip(fmtNum(avg), "Average points")}
        ${statChip(fmtNum(max), "Highest points")}
        ${statChip(fmtNum(min), "Lowest points")}
      </div>`);
    } else {
      el.battleSub.textContent = "";
      parts.push(`<div class="battle-empty">No active-battle contribution data found for this clan right now.</div>`);
    }
    if (medals.length) {
      const total = medals.reduce((a, [, v]) => a + v, 0);
      parts.push(`<div><strong>Battle medals</strong> · total ${total}</div><div class="medal-row">${medals.map(([k, v]) => `<span class="medal-pill">${PS99Api.prettyKey(k.replace(/Medals?$/i, ""))}: ${v}</span>`).join("")}</div>`);
    }
    el.battleBody.innerHTML = parts.join("");
  }

  // ---------- init ----------
  function init() {
    wireSettings();
    wireSearch();
    showBrowse("clan");
    window.addEventListener("resize", positionTabIndicator);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
