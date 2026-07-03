/** @module config — shared SPA constants */
export const SPA_VERSION = 'v3.13.11';
export const UNASSIGNED_GRP = 'UNA';
export const DAY_ROUTE_COLORS = ['#2C5F7A', '#7B1FA2', '#C0603A', '#5B7232', '#0891B2', '#DC2626', '#8B5CF6', '#059669'];
export const API_BASE = '/api';
export const GEMINI_KEY = 'AIzaSyBmBWSxxAvawMG4noiDA7ulzm6hHtYtCAc';
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

export const STATUS_OPTS = ['New','Working','Reset','Reached Out','Replied','Info Supplied',
  'To Be Scheduled','Scheduled','Unavailable','Unresponsive','Rejected',
  'Duplicate','Deleted','Deleted-Idealista'];
export const ELIM_STATUSES = new Set(['Unavailable','Unresponsive','Rejected','Duplicate','Deleted','Deleted-Idealista']);
export const IFL_ELIM_STATUSES = new Set(['Unavailable','Rejected','Deleted-Idealista','Deleted']);
export const IFL_RESET_STATUSES = new Set(['Unresponsive','Rejected','Deleted']);
export const ACTIVE_ELIM = new Set(['Unavailable','Unresponsive','Rejected','Duplicate']);
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
export const LS_PLANNED_CLEARED = 'italy_hunt_planned_cleared_v37';
export const LS_SCHED_STATUS_MIGRATED = 'italy_hunt_sched_status_v312';
export const LS_SCHED_STALE_CLEANED = 'italy_hunt_sched_stale_v3123';
export const LS_PROV_MIGRATED = 'italy_hunt_prov_migrated_v3129';
export const LS_ORPHAN_GRP_MIGRATED = 'italy_hunt_orphan_grp_v3138';
export const LS_CLIENT_ID = 'italy_hunt_client_id';
export const SYNC_POLL_MS = 3000;

export const PERSIST_FIELDS = ['status','schedDate','schedTime','proposedDate','proposedTime','lastContacted',
  'firmName','firmPhone','broker','brokerPhone','brokerEmail',
  'address','gps','userPlannedDate','userPlannedTime','notes','realtorUrl','sourceIfl','grp',
  'commune','town','prov','driveTimes','driveMiles','refAirport','name','price','rooms','size','lat','lng','elevation','elevationCoordsKey'];
