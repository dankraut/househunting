/** Bootstrap ES modules and expose globals for inline handlers + legacy app script */
import * as config from './config.js';
import { createApiClient } from './api-client.js';
import { createLocationModule } from './location.js';
import { createPropSyncConflict } from './property-sync-conflict.js';

function getApiToken() {
  let t = localStorage.getItem('hh_api_key');
  if (!t && config.API_TOKEN) {
    t = config.API_TOKEN;
    try { localStorage.setItem('hh_api_key', t); } catch (e) {}
  }
  return t || '';
}

const HHApi = createApiClient(getApiToken);
const HHLoc = createLocationModule(HHApi);
const HHPropConflict = createPropSyncConflict();

Object.assign(window, config);
window.HHApi = HHApi;
window.HHLoc = HHLoc;
window.HHPropConflict = HHPropConflict;
window.getApiToken = getApiToken;

const locNames = [
  'parseGPS', 'isCoordinateGps', 'buildAddressFromParts', 'getPropAddress', 'getPropGps', 'getPropCalcGps',
  'formatPropTownDisplay', 'applyTownTextToProp', 'syncCalcGpsFromTown', 'getBaseGps',
  'clearEntityCoords', 'normalizeGpsString', 'formatItalianLocation', 'applyGpsToEntity',
  'geocodeAddress', 'reverseGeocode', 'syncEntityLocation', 'resolveLocSyncMode', 'resolvePropCoords',
  'resolveStayBaseCoords', 'migratePropLocation',
  'setLocLoading', 'setLocError', 'setLocSuccess', 'clearLocUi', 'runLocSync',
  'isLocSyncing', 'debouncedLocBlur',
];
for (const n of locNames) window[n] = HHLoc[n];

window.__hhModulesReady = true;
window.dispatchEvent(new Event('hh-modules-ready'));
