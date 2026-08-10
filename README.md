# PS99 Stats

A live clan/league dashboard for Pet Simulator 99, built as a plain static
site (no build step, no framework) so it can be hosted for free on GitHub
Pages. Rosters, points/hour trends, and "gap to your leaderboard neighbors"
cards, all built on the public [BIG Games API](https://github.com/BIG-Games-LLC/ps99-public-api-docs).

## Why there's a GitHub Action in here

The live API has **no history endpoint at all** — it only ever tells you the
current state. Real hour-over-hour graphs and "closing the gap" trends are
only possible if *something* is taking snapshots over time, on a schedule,
independent of whether anyone has the site open.

`.github/workflows/collect.yml` does that: every 15 minutes it runs
`scripts/collect.mjs`, which pulls the current top ~150 clans and top ~150
leagues by points and commits the result into `data/`:

```
data/leaderboard/clans-latest.json    current top-150 clans, ranked
data/leaderboard/leagues-latest.json  current top-150 leagues, ranked
data/history/clans/<name>.json        7-day rolling points-over-time
data/history/leagues/<name>.json
```

The site reads these same-origin (no CORS risk, no server needed, cached by
GitHub Pages' CDN). Anything **inside** the tracked top ~150 gets full 24h
graphs and real neighbor-gap trends. Anything outside it still works for
live search — roster, points, rank via a live lookup — it just won't have
deep history until/unless it's within the tracked window. This is a real
API limitation, not a bug: there's no way to know a clan's hour-ago points
without having recorded them an hour ago.

If you'd rather use Firebase for this instead of committing JSON to the
repo (e.g. you want to track more than ~150 entities, or want real-time
push updates), the collector script is the only piece that would change —
swap its `fs.writeFile` calls for Firestore/Realtime Database writes via
the Admin SDK, keep the schedule the same, and point `js/history.js` at
your Firebase config instead of `fetch('data/...')`. Happy to build that
version too if you set up a project and hand me the config.

## Deploying

1. Push this repo to GitHub.
2. **Settings → Pages** → Source: "Deploy from a branch" → pick `main` / `root`.
3. **Settings → Actions → General** → under "Workflow permissions", select
   "Read and write permissions" (the collector needs to commit `data/`).
4. **Actions** tab → run "Collect PS99 snapshot" once manually
   (workflow_dispatch) so `data/` isn't empty while you wait for the first
   scheduled run.
5. Visit `https://<you>.github.io/<repo>/`.

No npm install, no bundler — `scripts/collect.mjs` only needs Node 18+'s
built-in `fetch`, and the site itself is plain HTML/CSS/JS plus a single
Chart.js CDN `<script>` tag.

## What's real vs. best-effort (straight from the API's own limits)

- **Clan roster** works for any clan. Usernames are resolved for every
  member via Roblox's own public users endpoint, not just sampled ones.
- **Per-member points/gems for clans** only exist for the ~25 clans BIG
  Games itself samples in `/v1/clans/players`. Smaller clans show `-` for
  those two columns — everything else (roster, rank, history) is unaffected.
- **Leagues** expose exact per-member points for everyone, no sampling, but
  have no gem/diamond stat at all.
- **Leaderboard rank**: instant for anything in the tracked top ~150 (read
  straight from `data/leaderboard/*.json`); for everything else, a live
  binary search over the sorted leaderboard, or a capped scan of the top
  2000 if a clan's own point total isn't available from its detail endpoint.
- **"Live Δ" / "Hourly ≈" columns**: for entities outside the tracked set,
  these are estimated from what your own browser has observed this session
  (stored in `sessionStorage`), same as the desktop version of this tool —
  they get more accurate the longer the tab stays open, and reset on reload.

## Local preview

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000`.
