# House Hunt — Italy Property Search Tool

A Cloudflare Pages-hosted SPA + Chrome extension for tracking Idealista property listings during an Italy house hunt.

## Repo Structure

```
househunting/
├── index.html                    # SPA shell + app logic (loads js/ modules)
├── js/
│   ├── bootstrap.js              # Module entry — exposes HHApi, HHLoc, HHPropConflict
│   ├── config.js                 # SPA_VERSION, constants
│   ├── api-client.js             # REST API wrapper
│   ├── location.js               # GPS/town sync + field loading/errors
│   └── property-sync-conflict.js # Remote-edit banner on property modal
├── deploy.cmd                    # Ship via PR (Windows wrapper)
├── scripts/
│   ├── deploy.ps1                # Commit → push cursor/* branch → open PR → auto-merge
│   └── push.ps1                  # Alias for deploy.ps1
├── functions/
│   └── api/
│       └── [[path]].js           # Cloudflare Pages Function (API backend)
└── extension/                    # Chrome Extension MV3 source
    ├── manifest.json             # v1.7.4
    ├── popup.html / popup.js     # Extension popup UI
    ├── content.js                # Injected into Idealista listing pages
    ├── background.js             # Service worker — relays messages to SPA tab
    ├── sync.js                   # IFL (Favorites List) sync logic
    └── icon16/48/128.png         # Extension icons
```

## Deployment

Production updates **only when a PR merges to `main`**. Cloudflare Pages then deploys to `househunt.pages.dev`. Direct push to `main` is blocked by branch protection.

- **SPA + API**: merge to `main` → Cloudflare Pages deploys `index.html`, `js/`, and `functions/api/[[path]].js`
- **KV**: Cloudflare KV namespace `HH_KV` stores all data (keys: `data`, `bases`, `snapshots-index`, `snapshot:{id}`)
- **Auth**: Bearer token `jmjk05DK` required on all API calls
- **Extension**: not deployed by Cloudflare — after merge, pull `main` locally and **Reload** the unpacked extension in Chrome when `extension/` changed

### Ship command (Desktop — same path as Cursor Cloud)

One command commits, pushes a `cursor/*-fb87` branch, opens a PR, and relies on auto-merge when Cloudflare Pages passes.

| How | Command |
|-----|---------|
| **Cursor / VS Code** | `Terminal` → `Run Task` → **Ship (PR → auto-merge)** (or `Ctrl+Shift+B`) |
| **PowerShell** | `.\scripts\deploy.ps1` |
| **Cmd / double-click** | `deploy.cmd` |

**Options** (PowerShell):

```powershell
.\scripts\deploy.ps1                                    # on cursor/*-fb87 branch
.\scripts\deploy.ps1 -Description "map-filter-fix"      # on main: create cursor/map-filter-fix-fb87
.\scripts\deploy.ps1 -Message "Fix map pins"            # custom commit message
.\scripts\deploy.ps1 -PrTitle "Fix map base filter"      # custom PR title
.\scripts\deploy.ps1 -DryRun                              # print steps without changing git
```

**Workflow (Desktop = Cloud agent):**

1. `git checkout main && git pull`
2. `git checkout -b cursor/my-feature-fb87` (or let `-Description` create the branch from `main`)
3. Edit, run smoke check, bump SPA version (Extension only if `extension/` changed)
4. `.\scripts\deploy.ps1` → push branch → open PR
5. GitHub Actions auto-merge squash-merges when **Cloudflare Pages** check succeeds
6. GitHub Desktop **Pull** on `main`; hard-refresh SPA; reload extension if needed

The script refuses to commit obvious secrets (`.env`, `credentials.json`, etc.). Never pushes `main`. Stops on rebase conflicts with recovery instructions.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data` | Load all property data |
| PUT | `/api/data` | Save all property data |
| GET | `/api/bases` | Load bases config |
| PUT | `/api/bases` | Save bases config |
| GET | `/api/snapshots` | List snapshots |
| POST | `/api/snapshots` | Create snapshot |
| POST | `/api/snapshots/restore` | Restore snapshot |
| DELETE | `/api/snapshots/:id` | Delete snapshot |
| POST | `/api/ifl-sync` | Sync Idealista favorites list |

## Chrome Extension

Load unpacked from the `extension/` folder in Chrome. Requires:
- Logged into Idealista
- SPA open in another tab
- API key set in extension popup (Sync IFL tab)

### Storage Keys
- `chrome.storage.local`: `apiToken`, `spaUrl`, `savedIflUrl`, `pendingData`
- `localStorage` (SPA): `italy_hunt_2026_v3` (props), `hh_bases`, `hh_api_key`, `hh_tpl`

## Version History

| Component | Version | Notes |
|-----------|---------|-------|
| SPA | v3.2.2 | Stable baseline |
| SPA | v3.11.0 | ES modules (api/location/sync-conflict), location field UX |
| Extension | v1.7.4 | IFL sync, postMessage bridge |
| API | — | Cloudflare Pages Function, KV-backed |
