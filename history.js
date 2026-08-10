/* ===========================================================
   PS99History — reads the GitHub-Actions-collected snapshots
   in /data (same-origin, no CORS issues, works even if the
   live API is having a bad day) and layers a short in-browser
   "session" buffer on top so the chart/gap cards stay live
   between the collector's ~15-minute snapshots.
=========================================================== */
const PS99History = (() => {
  const leaderboardCache = new Map(); // kind -> {ts, data}
  const historyCache = new Map();     // "kind:name" -> {ts, data}
  const LEADERBOARD_TTL = 5 * 60 * 1000;
  const HISTORY_TTL = 5 * 60 * 1000;
  const SESSION_MAX_POINTS = 400;

  function fileSafe(name) {
    return encodeURIComponent(name.trim());
  }

  async function loadLeaderboard(kind) {
    const cached = leaderboardCache.get(kind);
    if (cached && Date.now() - cached.ts < LEADERBOARD_TTL) return cached.data;
    try {
      const res = await fetch(`data/leaderboard/${kind}s-latest.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("no snapshot");
      const data = await res.json();
      leaderboardCache.set(kind, { ts: Date.now(), data });
      return data;
    } catch {
      return null; // not tracked yet / repo hasn't run the collector — caller falls back to live API
    }
  }

  async function loadHistory(kind, name) {
    const key = `${kind}:${name}`;
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.ts < HISTORY_TTL) return cached.data;
    try {
      const res = await fetch(`data/history/${kind}s/${fileSafe(name)}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("no history");
      const data = await res.json();
      historyCache.set(key, { ts: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  }

  function sessionKey(kind, name) {
    return `ps99_session_${kind}_${name.toLowerCase()}`;
  }

  function pushSessionPoint(kind, name, points) {
    const key = sessionKey(kind, name);
    let series = [];
    try { series = JSON.parse(sessionStorage.getItem(key) || "[]"); } catch { series = []; }
    series.push([Date.now(), points]);
    if (series.length > SESSION_MAX_POINTS) series = series.slice(-SESSION_MAX_POINTS);
    try { sessionStorage.setItem(key, JSON.stringify(series)); } catch { /* storage full/unavailable, skip silently */ }
    return series;
  }

  function getSessionSeries(kind, name) {
    try { return JSON.parse(sessionStorage.getItem(sessionKey(kind, name)) || "[]"); } catch { return []; }
  }

  // Merge committed points-over-time (ms epoch, points) with anything the
  // browser has collected this session, deduped and sorted.
  function mergeSeries(committed, session) {
    const merged = [...(committed || []), ...(session || [])];
    merged.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of merged) {
      if (!out.length || p[0] - out[out.length - 1][0] > 60000) out.push(p);
    }
    return out;
  }

  // Rate of change over the trailing `windowMs`, extrapolated to points/hour.
  function hourlyRateFromSeries(series, windowMs = 60 * 60 * 1000) {
    if (!series || series.length < 2) return null;
    const now = series[series.length - 1][0];
    const cutoff = now - windowMs;
    let start = series[0];
    for (const p of series) { if (p[0] >= cutoff) { start = p; break; } }
    const end = series[series.length - 1];
    const dtHours = (end[0] - start[0]) / 3600000;
    if (dtHours <= 0) return null;
    return (end[1] - start[1]) / dtHours;
  }

  function seriesStats(series) {
    if (!series || series.length < 2) return null;
    const hourly = [];
    for (let i = 1; i < series.length; i++) {
      const dtH = (series[i][0] - series[i - 1][0]) / 3600000;
      if (dtH > 0) hourly.push((series[i][1] - series[i - 1][1]) / dtH);
    }
    if (!hourly.length) return null;
    const total = series[series.length - 1][1] - series[0][1];
    return {
      total,
      avgPerHour: hourly.reduce((a, b) => a + b, 0) / hourly.length,
      bestPerHour: Math.max(...hourly),
      latestPerHour: hourly[hourly.length - 1],
    };
  }

  return { loadLeaderboard, loadHistory, pushSessionPoint, getSessionSeries, mergeSeries, hourlyRateFromSeries, seriesStats };
})();
