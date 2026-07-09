# AGENTS.md

See `README.md` and `PROJECT_STATE` for the product overview, API endpoints, versioning, and the ship-via-PR pipeline. `PROJECT_STATE` is the source of truth for the current phase and must-keep features.

## Cursor Cloud specific instructions

This is a **build-less** project: vanilla-JS SPA (`index.html` + `js/`) + a Cloudflare Pages Function API (`functions/api/[[path]].js`) backed by a KV namespace `HH_KV`, plus an optional Chrome extension (`extension/`). There is no `package.json`, lockfile, `wrangler.toml`, or `node_modules` — nothing to compile and no build step.

### Run the dev environment (SPA + API + KV together)

```bash
npx wrangler pages dev . --kv HH_KV --port 8788 --ip 127.0.0.1
```

- This serves the static SPA **and** the `/api/*` functions together with a **local** KV namespace. KV data is stored per-VM under `.wrangler/state/` (git-ignored, not shared with production). Open `http://127.0.0.1:8788/`.
- Serving the repo with a plain static server (e.g. `python -m http.server`) will load the SPA but the `/api/*` calls will 404/500 — use `wrangler pages dev` so the Functions + KV binding are available.

### Auth
All `/api/*` calls require `Authorization: Bearer jmjk05DK` (or `?tk=jmjk05DK`). The SPA supplies this token automatically (`js/config.js` → `API_TOKEN`), so no manual key entry is needed for local dev.

### Non-obvious gotchas
- **Google Maps needs a key.** Forward geocoding (typing a *Town* to resolve GPS) requires `env.GMAPS_KEY`, which is unset in local dev, so adding a property by town alone fails ("Could not find coordinates for that town"). Reverse-geocode, drive-time, and elevation endpoints return offline fallback estimates, so entering **GPS coordinates directly** in the add/edit forms works and still populates location + drive times. Set `GMAPS_KEY` (Wrangler env / Cloudflare) for real geocoding.
- **Unassigned properties are hidden.** The app is organized around "Bases" (lodging during the hunt). A property with no base (`grp` = `UNA`) is treated as *Unassigned* and is **excluded from the default Properties list and the header counts** — it only appears when the Base filter is set to "Unassigned". To see a newly added property in the default view, create/select a **Base** first (Settings → + Add Base, or seed one via `PUT /api/bases`) and assign the property to it. This is expected behavior, not a bug.
- The SPA loads data from the API on startup (falling back to `localStorage`), then polls `GET /api/sync` every few seconds. If you seed/reset data via the API, reload the page to see it. Stale browser `localStorage` can mask an empty backend — `localStorage.clear()` in the console gives a clean slate.

### Lint / test / build
- **Lint / pre-ship validation:** `bash scripts/smoke-check.sh` (checks regression markers in `scripts/smoke-markers.txt` and SPA/extension version alignment).
- **Automated tests:** none in this repo.
- **Build:** none (static assets + edge Functions).
### Ship (Cloud agents)

After editing, run `bash scripts/ship.sh` (smoke check → commit → push → open PR). Branch: `cursor/<description>-<suffix>` (e.g. `-288c`, `-fb87`).

**Push all commits before opening a PR** when possible. Auto-merge waits **8 minutes** after the last push before merging. If a branch already merged, push follow-up commits and auto-open will create a new PR.

**One-time repo setup** so PRs open automatically on push: see [`.github/CLOUD_SHIP_SETUP.md`](.github/CLOUD_SHIP_SETUP.md) — enable *Allow GitHub Actions to create and approve pull requests* in [Actions settings](https://github.com/dankraut/househunting/settings/actions), or add a `GH_PAT` secret.

Do **not** leave PRs as drafts; `auto-merge-cursor.yml` merges when Cloudflare Pages passes (after the settle wait).
- The Windows ship tooling (`deploy.cmd`, `scripts/*.ps1`) mirrors the same pipeline for Desktop.

### Chrome extension (optional)
`extension/` is Manifest V3, loaded unpacked in Chrome. It scrapes Idealista and syncs to the SPA/API; testing it requires Chrome + an Idealista login, so it is not part of the automated local run.
