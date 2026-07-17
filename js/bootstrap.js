/** Bootstrap ES modules and expose globals for inline handlers + legacy app script */
import * as config from './config.js';
import { createApiClient } from './api-client.js';
import { createLocationModule } from './location.js';
import { createPropSyncConflict } from './property-sync-conflict.js';
import { createPropertyHistoryModule } from './property-history.js';

function getApiToken() {
  const ver = localStorage.getItem('hh_api_key_ver');
  if (ver !== config.API_TOKEN_VER) {
    try {
      localStorage.setItem('hh_api_key', config.API_TOKEN);
      localStorage.setItem('hh_api_key_ver', config.API_TOKEN_VER);
    } catch (e) {}
    return config.API_TOKEN;
  }
  let t = localStorage.getItem('hh_api_key');
  if (!t && config.API_TOKEN) {
    t = config.API_TOKEN;
    try {
      localStorage.setItem('hh_api_key', t);
      localStorage.setItem('hh_api_key_ver', config.API_TOKEN_VER);
    } catch (e) {}
  }
  return t || '';
}

const HHApi = createApiClient(getApiToken);
const HHLoc = createLocationModule(HHApi);
const HHPropConflict = createPropSyncConflict();
const HHPropHistory = createPropertyHistoryModule({
  formatPropTownDisplay: HHLoc.formatPropTownDisplay,
  getPropGps: HHLoc.getPropGps,
  getBase: (abbr) => (typeof window !== 'undefined' && window.getBase ? window.getBase(abbr) : null),
});

Object.assign(window, config);
window.HHApi = HHApi;
window.HHLoc = HHLoc;
window.HHPropConflict = HHPropConflict;
window.HHPropHistory = HHPropHistory;
window.getApiToken = getApiToken;

const locNames = [
  'parseGPS', 'isCoordinateGps', 'buildAddressFromParts', 'getPropAddress', 'getPropGps', 'getPropCalcGps',
  'clearPropCalcGps', 'getPropTownQuery',
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
