/** @module config — shared SPA constants */
export const SPA_VERSION = 'v3.11.2';
export const API_BASE = '/api';
export const GEMINI_KEY = 'AIzaSyBmBWSxxAvawMG4noiDA7ulzm6hHtYtCAc';
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

export const STATUS_OPTS = ['New','Working','Reset','Reached Out','Replied','Info Supplied',
  'To Be Scheduled','Proposed','Scheduled','Unavailable','Unresponsive','Rejected',
  'Duplicate','Deleted','Deleted-Idealista'];
export const ELIM_STATUSES = new Set(['Unavailable','Unresponsive','Rejected','Duplicate','Deleted','Deleted-Idealista']);
export const ACTIVE_ELIM = new Set(['Unavailable','Unresponsive','Rejected','Duplicate']);
export const DRIVE_CAP = 120;
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
export const LS_CLIENT_ID = 'italy_hunt_client_id';
export const SYNC_POLL_MS = 3000;

export const PERSIST_FIELDS = ['status','schedDate','schedTime','proposedDate','lastContacted',
  'firmName','firmPhone','broker','brokerPhone','brokerEmail',
  'address','gps','userPlannedDate','userPlannedTime','notes','realtorUrl','sourceIfl','grp',
  'commune','town','prov','driveTimes','name','price','rooms','size','lat','lng','elevation','elevationCoordsKey'];
