/** Property detail change history — snapshot, diff, append, merge */
import { UNASSIGNED_GRP } from './config.js';

export const PROP_HISTORY_MAX = 100;

const FIELD_LABELS = {
  name: 'Name',
  status: 'Status',
  grp: 'Base',
  visit: 'Visit',
  lastContacted: 'Last Contacted',
  address: 'Town',
  gps: 'GPS',
  price: 'Price (€k)',
  rooms: 'Rooms',
  size: 'Size (m²)',
  firmName: 'Brokerage Firm',
  firmPhone: 'Firm Phone',
  realtorUrl: 'Agency URL',
  broker: 'Broker',
  brokerPhone: 'Broker Phone',
  brokerEmail: 'Broker Email',
  notes: 'Notes',
};

function emptySnap() {
  const o = {};
  for (const k of Object.keys(FIELD_LABELS)) o[k] = '';
  return o;
}

function formatVisit(p) {
  if (!p) return '';
  const d = p.visitDate || p.proposedDate || p.schedDate || '';
  const t = p.visitTime || p.proposedTime || p.schedTime || '';
  if (!d) return '';
  return t ? `${d} ${t}` : d;
}

function formatGrp(grp, getBase) {
  if (!grp || grp === UNASSIGNED_GRP) return 'Unassigned';
  const b = getBase?.(grp);
  return b?.name || grp;
}

function formatPriceVal(v) {
  const n = Number(v);
  if (!n) return '—';
  return `${n}k`;
}

function formatScalar(field, val, { getBase } = {}) {
  if (val == null || val === '') return '—';
  if (field === 'grp') return formatGrp(val, getBase);
  if (field === 'price') return formatPriceVal(val);
  if (field === 'notes') {
    const s = String(val).trim();
    if (!s) return '—';
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  }
  return String(val);
}

export function snapshotPropDetails(p, ctx = {}) {
  if (!p) return emptySnap();
  const formatTown = ctx.formatPropTownDisplay || (x => x.address || x.town || '');
  const getGps = ctx.getPropGps || (x => x.gps || '');
  return {
    name: p.name || '',
    status: p.status || '',
    grp: p.grp || UNASSIGNED_GRP,
    visit: formatVisit(p),
    lastContacted: p.lastContacted || '',
    address: formatTown(p) || '',
    gps: getGps(p) || '',
    price: p.price || 0,
    rooms: p.rooms || 0,
    size: p.size || 0,
    firmName: p.firmName || '',
    firmPhone: p.firmPhone || '',
    realtorUrl: p.realtorUrl || '',
    broker: p.broker || '',
    brokerPhone: p.brokerPhone || '',
    brokerEmail: p.brokerEmail || '',
    notes: p.notes || '',
  };
}

export function diffPropDetails(before, after, ctx = {}) {
  const changes = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const oldV = before?.[field] ?? '';
    const newV = after?.[field] ?? '';
    if (String(oldV) === String(newV)) continue;
    changes.push({
      field,
      label,
      old: formatScalar(field, oldV, ctx),
      new: formatScalar(field, newV, ctx),
    });
  }
  return changes;
}

function historyKey(entry) {
  return `${entry.ts}|${entry.source}|${JSON.stringify(entry.changes)}`;
}

export function mergePropHistory(serverHist, clientHist) {
  const combined = [...(Array.isArray(clientHist) ? clientHist : []), ...(Array.isArray(serverHist) ? serverHist : [])];
  if (!combined.length) return [];
  const seen = new Set();
  const out = [];
  combined.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const e of combined) {
    if (!e || !Array.isArray(e.changes) || !e.changes.length) continue;
    const key = historyKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= PROP_HISTORY_MAX) break;
  }
  return out;
}

export function appendPropHistory(p, source, changes) {
  if (!p || !Array.isArray(changes) || !changes.length) return;
  if (!Array.isArray(p.history)) p.history = [];
  p.history.unshift({
    ts: Date.now(),
    source: source || 'App',
    changes,
  });
  if (p.history.length > PROP_HISTORY_MAX) p.history.length = PROP_HISTORY_MAX;
}

export function recordPropDetailChanges(p, beforeSnap, source, ctx = {}) {
  const changes = diffPropDetails(beforeSnap, snapshotPropDetails(p, ctx), ctx);
  if (changes.length) appendPropHistory(p, source, changes);
}

export function formatHistoryTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

export function createPropertyHistoryModule(ctx = {}) {
  return {
    PROP_HISTORY_MAX,
    snapshotPropDetails: (p) => snapshotPropDetails(p, ctx),
    diffPropDetails: (before, after) => diffPropDetails(before, after, ctx),
    mergePropHistory,
    appendPropHistory,
    recordPropDetailChanges: (p, beforeSnap, source) => recordPropDetailChanges(p, beforeSnap, source, ctx),
    formatHistoryTimestamp,
    FIELD_LABELS,
  };
}
