# House Hunt — Italy Property Search Tool

A Cloudflare Pages-hosted SPA + Chrome extension for tracking Idealista property listings during an Italy house hunt.

## Repo Structure

```
househunting/
├── index.html                    # SPA — auto-deploys to Cloudflare Pages on every push to main
├── functions/
│   └── api/
│       └── [[path]].js           # Cloudflare Pages Function (API backend)
└── extension/                    # Chrome Extension MV3 source
    ├── manifest.json             # v1.6.5
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
| SPA | v3.3.2 | Current on main |
| Extension | v1.6.5 | Current — IFL sync, postMessage bridge |
| API | — | Cloudflare Pages Function, KV-backed |
