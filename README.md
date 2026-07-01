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
├── deploy.cmd                    # One-command deploy wrapper (Windows)
├── scripts/
│   └── deploy.ps1                # Commit → sync → merge to main → push
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

- **SPA**: Push `index.html` to `main` → Cloudflare Pages auto-deploys to `househunt.pages.dev`
- **API**: `functions/api/[[path]].js` deploys alongside as a Cloudflare Pages Function
- **KV**: Cloudflare KV namespace `HH_KV` stores all data (keys: `data`, `bases`, `snapshots-index`, `snapshot:{id}`)
- **Auth**: Bearer token `jmjk05DK` required on all API calls

### Deploy command (local → GitHub → Cloudflare)

One command commits your work, syncs with GitHub, merges into `main`, and pushes. Cloudflare Pages picks up the `main` push automatically.

| How | Command |
|-----|---------|
| **Cursor / VS Code** | `Terminal` → `Run Task` → **Deploy** (or `Ctrl+Shift+B` if build is default) |
| **PowerShell** | `.\scripts\deploy.ps1` |
| **Cmd / double-click** | `deploy.cmd` |

**Options** (PowerShell):

```powershell
.\scripts\deploy.ps1                          # auto commit message from SPA_VERSION
.\scripts\deploy.ps1 -Message "Fix map pins"  # custom commit message
.\scripts\deploy.ps1 -DryRun                    # print steps without changing git
.\scripts\deploy.ps1 -NoReturnToBranch          # stay on main after merge
```

**Workflow:**

- On **`main`**: fetch → commit (if needed) → pull --rebase → push `main`
- On a **feature branch** (e.g. `feature/cursor-branch`): commit → push branch → checkout `main` → pull → merge branch → push `main` → return to feature branch

The script refuses to commit obvious secrets (`.env`, `credentials.json`, etc.). Never force-pushes. Stops on merge/rebase conflicts with recovery instructions.

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
