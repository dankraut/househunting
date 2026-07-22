/** @module config — shared SPA constants */
export const SPA_VERSION = 'v2.65';
export const FIND_BASE_MAX_PROPS = 15;
export const FIND_BASE_MAX_TOWN_CANDIDATES = 12;
export const FIND_BASE_MIN_POPULATION = 5000;
export const FIND_BASE_TOWN_SEARCH_KM = 40;
export const API_TOKEN = '5c237b666d2c79d58f0152e5';
export const API_TOKEN_VER = '5c237b666d2c79d58f0152e5';
/** Origins allowed to postMessage into the SPA (extension relays use the page origin). */
export const HH_MSG_ORIGINS = [
  'https://househunt.pages.dev',
  'http://127.0.0.1:8788',
  'http://localhost:8788',
];
export function isAllowedHouseHuntOrigin(origin) {
  if (!origin) return false;
  if (HH_MSG_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith('.pages.dev');
  } catch { return false; }
}
/** Minimum scraped IFL count vs existing base props before marking deletions. */
export const IFL_DELETION_MIN_RATIO = 0.5;
export const IFL_DELETION_MIN_COUNT = 3;
export const UNASSIGNED_GRP = 'UNA';
/** Multi-day route colors — high contrast (blue / orange / green / red …) so day 1 violations never read as day 2 */
export const DAY_ROUTE_COLORS = ['#2563EB', '#EA580C', '#059669', '#DC2626', '#7C3AED', '#0891B2', '#CA8A04', '#BE185D'];
export const API_BASE = '/api';
export const GEMINI_KEY = 'AIzaSyBmBWSxxAvawMG4noiDA7ulzm6hHtYtCAc';
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

export const STATUS_UNDER_AGREEMENT_SOLD = 'Under Agreement/Sold';
export const STATUS_UNABLE_TO_SEE = 'Unable To See';
export const STATUS_REACHED_OUT_AGAIN = 'Reached Out Again';

export const STATUS_OPTS = ['New','Working','Reset','Reached Out',STATUS_REACHED_OUT_AGAIN,'Replied','Info Supplied',
  'To Be Scheduled','Proposed','Scheduled',STATUS_UNDER_AGREEMENT_SOLD,'Unresponsive','Rejected',
  STATUS_UNABLE_TO_SEE,'Duplicate','Deleted','Deleted-Idealista'];
export const ELIM_STATUSES = new Set([STATUS_UNDER_AGREEMENT_SOLD,'Unresponsive','Rejected',STATUS_UNABLE_TO_SEE,'Duplicate','Deleted','Deleted-Idealista']);
export const IFL_ELIM_STATUSES = new Set([STATUS_UNDER_AGREEMENT_SOLD,'Rejected','Deleted-Idealista','Deleted']);
export const IFL_RESET_STATUSES = new Set(['Unresponsive','Rejected','Deleted']);
export const ACTIVE_ELIM = new Set([STATUS_UNDER_AGREEMENT_SOLD,'Unresponsive','Rejected',STATUS_UNABLE_TO_SEE,'Duplicate']);
export const DRIVE_CAP = 120;
export const DRIVE_SHOW_CAP = 45;
export const VIEWING_MIN = 45;
export const DAY_START = 8.5;
export const DAY_END = 19.0;
export const DAY_START_MIN = Math.round(DAY_START * 60);
export const DAY_END_MIN = Math.round(DAY_END * 60);
export const SUGGESTED_DRIVE_STAY = 180;
export const SUGGESTED_DRIVE_TRANSIT = 120;

export const BASE_COLORS = ['#5B7232','#F5A623','#2C5F7A','#C0603A','#8B5CF6','#0891B2','#DC2626','#059669','#92400E','#BE185D'];

export const LS_KEY = 'italy_hunt_2026_v35';
export const LS_BASES = 'italy_hunt_bases_v35';
export const LS_AIRPORTS = 'italy_hunt_airports';
export const LS_ADDR_MIGRATED = 'italy_hunt_addr_migrated_v35';
export const LS_GPS_AUTH_MIGRATED = 'italy_hunt_gps_authoritative_v310';
export const LS_ELEV_MIGRATED = 'italy_hunt_elev_migrated_v351';
export const LS_PROP_NAME_MIGRATED = 'italy_hunt_prop_name_fix_v313';
export const LS_ELEV_BACKFILL = 'italy_hunt_elev_backfill_v313';
export const LS_MXP_AIRPORT_BACKFILL = 'italy_hunt_mxp_airport_v314';
export const LS_ACTIVE_PROPS_TOUCH = 'italy_hunt_active_props_touch_v317';
export const LS_PLANNED_CLEARED = 'italy_hunt_planned_cleared_v37';
export const LS_SCHED_STATUS_MIGRATED = 'italy_hunt_sched_status_v312';
export const LS_SCHED_STALE_CLEANED = 'italy_hunt_sched_stale_v3123';
export const LS_VISIT_FIELDS_MIGRATED = 'italy_hunt_visit_fields_v31352';
export const LS_STATUS_LABELS_MIGRATED = 'italy_hunt_status_labels_v31353';
export const LS_PROV_MIGRATED = 'italy_hunt_prov_migrated_v3129';
export const LS_ORPHAN_GRP_MIGRATED = 'italy_hunt_orphan_grp_v3138';
export const LS_CALC_GPS_MIGRATED = 'italy_hunt_calc_gps_v3145';
export const LS_DRIVE_TIMES_STALE_BACKFILL = 'italy_hunt_drive_times_stale_v226';
export const LS_CLIENT_ID = 'italy_hunt_client_id';
export const SYNC_POLL_MS = 3000;

export const PERSIST_FIELDS = ['status','visitDate','visitTime','schedDate','schedTime','proposedDate','proposedTime','lastContacted',
  'firmName','firmPhone','broker','brokerPhone','brokerEmail',
  'address','propertyAddress','meetingAddress','gps','gpsPinExact','calcGps','idealistaGps','userPlannedDate','userPlannedTime','notes','realtorUrl','sourceIfl','grp',
  'commune','town','prov','driveTimes','driveMiles','refAirport','driveTimesCoordsKey','name','price','rooms','size','lat','lng','elevation','elevationCoordsKey'];
