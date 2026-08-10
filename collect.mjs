// Run by .github/workflows/collect.yml on a schedule (Node 18+, native fetch).
// Builds:
//   data/leaderboard/clans-latest.json   { kind, updatedAt, total, entries:[{Rank,Name,Points,Icon,...}] }
//   data/leaderboard/leagues-latest.json  (same shape)
//   data/history/clans/<name>.json       { name, kind, updatedAt, points:[[ts,points], ...] } (7d rolling)
//   data/history/leagues/<name>.json
//
// This is the site's entire "database": free, needs no external account,
// and the static site just fetches these JSON files same-origin.

import fs from "node:fs/promises";
import path from "node:path";

const LEGACY = "https://ps99.biggamesapi.io/api";
const V1 = "https://ps99.biggamesapi.io/v1";
const TOP_N = parseInt(process.env.TRACKED_TOP_N || "150", 10);
const PAGE_SIZE = 100;
const RETENTION_MS = 7 * 24 * 3600 * 1000; // keep 7 days of history per entity
const MAX_POINTS = 700; // ~7 days at a 15-min collection cadence
const DATA_DIR = path.join(process.cwd(), "data");

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = await res.json();
  if (body.status && body.status !== "ok") throw new Error(body.error?.message || "API error");
  return body.data !== undefined ? body.data : body;
}

async function fetchTopClans(n) {
  const pages = Math.ceil(n / PAGE_SIZE);
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const items = await getJSON(`${LEGACY}/clans?page=${p}&pageSize=${PAGE_SIZE}&sort=Points&sortOrder=desc`);
    if (!items || !items.length) break;
    out.push(...items);
  }
  let total = out.length;
  try { total = await getJSON(`${LEGACY}/clansTotal`); } catch { /* keep fallback */ }
  return { entries: out.slice(0, n), total };
}

async function fetchTopLeagues(n) {
  const pages = Math.ceil(n / PAGE_SIZE);
  const out = [];
  let total = 0;
  for (let p = 1; p <= pages; p++) {
    const data = await getJSON(`${V1}/leagues?page=${p}&pageSize=${PAGE_SIZE}&sort=Points&sortOrder=desc`);
    total = data.total || total;
    const items = data.leagues || [];
    if (!items.length) break;
    out.push(...items);
  }
  return { entries: out.slice(0, n), total };
}

function safeFileName(name) {
  return `${encodeURIComponent(name.trim())}.json`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeLeaderboard(kind, entries, total) {
  const ranked = entries.map((e, i) => ({
    Rank: i + 1,
    Name: e.Name,
    Points: e.Points ?? null,
    Icon: e.Icon || null,
    Members: e.Members?.length ?? e.MemberCount ?? null,
  }));
  const payload = { kind, updatedAt: Date.now(), total, entries: ranked };
  const dir = path.join(DATA_DIR, "leaderboard");
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, `${kind}s-latest.json`), JSON.stringify(payload));
  return ranked;
}

async function updateHistory(kind, ranked) {
  const dir = path.join(DATA_DIR, "history", `${kind}s`);
  await ensureDir(dir);
  const now = Date.now();
  for (const e of ranked) {
    if (e.Points == null || !e.Name) continue;
    const file = path.join(dir, safeFileName(e.Name));
    let existing = { points: [] };
    try {
      existing = JSON.parse(await fs.readFile(file, "utf8"));
    } catch { /* first time tracking this entity */ }
    const points = existing.points || [];
    points.push([now, e.Points]);
    const cutoff = now - RETENTION_MS;
    let pruned = points.filter((p) => p[0] >= cutoff);
    if (pruned.length > MAX_POINTS) pruned = pruned.slice(-MAX_POINTS);
    await fs.writeFile(file, JSON.stringify({ name: e.Name, kind, updatedAt: now, points: pruned }));
  }
}

async function main() {
  console.log(`Collecting top ${TOP_N} clans & leagues from the BIG Games API…`);
  const [clans, leagues] = await Promise.all([fetchTopClans(TOP_N), fetchTopLeagues(TOP_N)]);
  const rankedClans = await writeLeaderboard("clan", clans.entries, clans.total);
  const rankedLeagues = await writeLeaderboard("league", leagues.entries, leagues.total);
  await updateHistory("clan", rankedClans);
  await updateHistory("league", rankedLeagues);
  console.log(`Done: tracked ${rankedClans.length} clans and ${rankedLeagues.length} leagues.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
