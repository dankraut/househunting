// House Hunt API — Cloudflare Pages Function v1.4
// Routes: GET/PUT /api/data, GET /api/sync, POST/DELETE /api/lock,
//         GET/POST /api/snapshots, POST /api/snapshots/restore,
//         DELETE /api/snapshots/:id, GET/PUT /api/bases, POST /api/ifl-sync,
//         GET /api/drive-time, GET /api/geocode, GET /api/reverse-geocode,
//         GET /api/directions, GET /api/elevation

const TOKEN = 'jmjk05DK';
const MAX_SNAPSHOTS = 20;
const LOCK_TTL_SEC = 120;

const MERGE_FIELDS = [
  'status', 'schedDate', 'schedTime', 'proposedDate', 'lastContacted',
  'firmName', 'firmPhone', 'broker', 'brokerPhone', 'brokerEmail',
  'address', 'gps', 'userPlannedDate', 'userPlannedTime', 'notes', 'realtorUrl', 'sourceIfl', 'grp',
  'commune', 'town', 'prov', 'driveTimes', 'name', 'price', 'rooms', 'size', 'lat', 'lng',
  'elevation', 'elevationCoordsKey',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authOk(request, url) {
  const auth = request.headers.get('Authorization') || '';
  return auth === 'Bearer ' + TOKEN || url.searchParams.get('tk') === TOKEN;
}

function parseProps(raw) {
  if (!raw) return [];
  const d = JSON.parse(raw);
  return Array.isArray(d) ? d : (d.props || []);
}

async function getDataRev(env) {
  const r = await env.HH_KV.get('data-rev');
  if (r != null) return parseInt(r, 10) || 0;
  const data = await env.HH_KV.get('data');
  if (data) {
    await env.HH_KV.put('data-rev', '1');
    return 1;
  }
  return 0;
}

async function bumpDataRev(env) {
  const rev = (await getDataRev(env)) + 1;
  await env.HH_KV.put('data-rev', String(rev));
  return rev;
}

async function getBasesRev(env) {
  const r = await env.HH_KV.get('bases-rev');
  if (r != null) return parseInt(r, 10) || 0;
  const bases = await env.HH_KV.get('bases');
  if (bases) {
    await env.HH_KV.put('bases-rev', '1');
    return 1;
  }
  return 0;
}

async function bumpBasesRev(env) {
  const rev = (await getBasesRev(env)) + 1;
  await env.HH_KV.put('bases-rev', String(rev));
  return rev;
}

function mergeProp(server, client) {
  const out = { ...server };
  const sTs = server._fts || {};
  const cTs = client._fts || {};
  const mergedTs = { ...sTs };
  for (const field of MERGE_FIELDS) {
    const ct = cTs[field] || 0;
    const st = sTs[field] || 0;
    if (ct > st) {
      out[field] = client[field];
      mergedTs[field] = ct;
    } else if (ct === st && ct > 0 && client[field] !== server[field]) {
      if ((client._v || 0) >= (server._v || 0)) out[field] = client[field];
    }
  }
  out._fts = mergedTs;
  out._v = Math.max(server._v || 0, client._v || 0);
  return out;
}

function mergeProps(serverProps, clientProps) {
  const serverById = Object.fromEntries(serverProps.map(p => [String(p.id), p]));
  const clientIds = new Set(clientProps.map(p => String(p.id)));
  const merged = [];
  for (const cp of clientProps) {
    const sid = String(cp.id);
    const sp = serverById[sid];
    merged.push(sp ? mergeProp(sp, cp) : cp);
  }
  for (const sp of serverProps) {
    const sid = String(sp.id);
    if (!clientIds.has(sid)) merged.push(sp);
  }
  return merged;
}

async function readLocks(env) {
  try {
    return JSON.parse((await env.HH_KV.get('locks')) || '{}');
  } catch {
    return {};
  }
}

async function getActiveLocks(env) {
  const raw = await readLocks(env);
  const now = Date.now();
  const active = {};
  let dirty = false;
  for (const [id, lock] of Object.entries(raw)) {
    if (lock.exp > now) active[id] = lock;
    else dirty = true;
  }
  if (dirty) await env.HH_KV.put('locks', JSON.stringify(active));
  return active;
}

async function saveDataProps(env, props) {
  await env.HH_KV.put('data', JSON.stringify(props));
  return bumpDataRev(env);
}

function parseGeocodeComponents(comps) {
  const pick = (...types) => {
    for (const t of types) {
      const c = comps.find(x => x.types.includes(t));
      if (c) return c;
    }
    return null;
  };
  const locality = pick('locality', 'administrative_area_level_3', 'postal_town', 'village', 'hamlet');
  const commune = pick('administrative_area_level_3', 'locality');
  const prov = pick('administrative_area_level_2');
  return {
    town: locality?.long_name || '',
    commune: commune?.long_name || '',
    prov: prov?.short_name || '',
  };
}

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!authOk(request, url)) return json({ error: 'Unauthorized' }, 401);

  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // Lightweight multi-user sync poll
  if (path === 'sync' && request.method === 'GET') {
    const clientRev = parseInt(url.searchParams.get('rev') || '0', 10);
    const clientBasesRev = parseInt(url.searchParams.get('basesRev') || '0', 10);
    const rev = await getDataRev(env);
    const basesRev = await getBasesRev(env);
    const locks = await getActiveLocks(env);
    const out = { rev, basesRev, locks, locksOnly: rev === clientRev && basesRev === clientBasesRev };
    if (rev !== clientRev) {
      const data = await env.HH_KV.get('data');
      out.props = parseProps(data || '[]');
      out.changed = true;
    }
    if (basesRev !== clientBasesRev) {
      out.bases = JSON.parse((await env.HH_KV.get('bases')) || '[]');
      out.basesChanged = true;
    }
    return json(out);
  }

  // Property edit lock (short TTL)
  if (path === 'lock' && request.method === 'POST') {
    const { id, clientId, ttlSec = LOCK_TTL_SEC, who = '' } = await request.json();
    if (!id || !clientId) return json({ error: 'Missing id or clientId' }, 400);
    const locks = await getActiveLocks(env);
    const sid = String(id);
    const existing = locks[sid];
    const now = Date.now();
    if (existing && existing.clientId !== clientId && existing.exp > now) {
      return json({ ok: false, locked: true, lock: existing }, 423);
    }
    locks[sid] = { clientId, who, exp: now + (ttlSec * 1000) };
    await env.HH_KV.put('locks', JSON.stringify(locks));
    return json({ ok: true, lock: locks[sid] });
  }

  if (path === 'lock' && request.method === 'DELETE') {
    const { id, clientId } = await request.json();
    if (!id || !clientId) return json({ error: 'Missing id or clientId' }, 400);
    const locks = await getActiveLocks(env);
    const sid = String(id);
    if (locks[sid]?.clientId === clientId) {
      delete locks[sid];
      await env.HH_KV.put('locks', JSON.stringify(locks));
    }
    return json({ ok: true });
  }

  if (path === 'data' && request.method === 'GET') {
    const data = await env.HH_KV.get('data');
    const rev = await getDataRev(env);
    const locks = await getActiveLocks(env);
    const props = parseProps(data || '[]');
    return json({ rev, props, locks });
  }

  if (path === 'data' && request.method === 'PUT') {
    const bodyText = await request.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch { payload = null; }

    let clientProps, baseRev;
    if (Array.isArray(payload)) {
      clientProps = payload;
      baseRev = null;
    } else if (payload && Array.isArray(payload.props)) {
      clientProps = payload.props;
      baseRev = payload.baseRev;
    } else {
      return json({ error: 'Invalid payload' }, 400);
    }

    const currentRev = await getDataRev(env);
    const dataRaw = await env.HH_KV.get('data');
    const serverProps = parseProps(dataRaw || '[]');

    let merged = clientProps;
    let didMerge = false;
    if (baseRev != null && baseRev !== currentRev && serverProps.length) {
      merged = mergeProps(serverProps, clientProps);
      didMerge = true;
    }

    const newRev = await saveDataProps(env, merged);
    const locks = await getActiveLocks(env);
    return json({ ok: true, rev: newRev, props: merged, merged: didMerge, locks });
  }

  if (path === 'snapshots' && request.method === 'GET') {
    const index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    return json(index);
  }

  if (path === 'snapshots' && request.method === 'POST') {
    const { label, data } = await request.json();
    const id = Date.now().toString();
    let index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    let count = 0;
    try { const d = JSON.parse(data); count = Array.isArray(d) ? d.length : (d?.props?.length || 0); } catch {}
    index.unshift({ id, label: label || '', ts: new Date().toISOString(), count });
    const removed = index.splice(MAX_SNAPSHOTS);
    for (const r of removed) await env.HH_KV.delete('snapshot:' + r.id);
    await env.HH_KV.put('snapshots-index', JSON.stringify(index));
    await env.HH_KV.put('snapshot:' + id, typeof data === 'string' ? data : JSON.stringify(data));
    return json({ ok: true, id });
  }

  if (path === 'snapshots/restore' && request.method === 'POST') {
    const { id } = await request.json();
    const raw = await env.HH_KV.get('snapshot:' + id);
    if (!raw) return json({ error: 'Snapshot not found' }, 404);
    const props = parseProps(raw);
    const newRev = await saveDataProps(env, props);
    return json({ ok: true, rev: newRev, data: props });
  }

  if (path.startsWith('snapshots/') && request.method === 'DELETE') {
    const id = path.slice('snapshots/'.length);
    await env.HH_KV.delete('snapshot:' + id);
    let index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    index = index.filter(e => e.id !== id);
    await env.HH_KV.put('snapshots-index', JSON.stringify(index));
    return json({ ok: true });
  }

  if (path === 'bases' && request.method === 'GET') {
    const bases = await env.HH_KV.get('bases');
    const rev = await getBasesRev(env);
    return json({ rev, bases: JSON.parse(bases || '[]') });
  }

  if (path === 'bases' && request.method === 'PUT') {
    const bodyText = await request.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch { payload = null; }
    const bases = Array.isArray(payload) ? payload : (payload?.bases || []);
    await env.HH_KV.put('bases', JSON.stringify(bases));
    const rev = await bumpBasesRev(env);
    return json({ ok: true, rev, bases });
  }

  if (path === 'geocode' && request.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return json({ error: 'Missing address' }, 400);
    const gmapsKey = env.GMAPS_KEY || '';
    if (!gmapsKey)
      return json({ lat: null, lng: null, source: 'none', note: 'Set GMAPS_KEY in Cloudflare env' });
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=it&key=${gmapsKey}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.results?.[0]) {
        const loc = d.results[0].geometry.location;
        const comps = d.results[0].address_components || [];
        const parsed = parseGeocodeComponents(comps);
        return json({
          lat: loc.lat, lng: loc.lng,
          formatted: d.results[0].formatted_address,
          town: parsed.town,
          commune: parsed.commune,
          prov: parsed.prov,
          source: 'gmaps',
        });
      }
      return json({ lat: null, lng: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ lat: null, lng: null, source: 'error', error: e.message });
    }
  }

  if (path === 'reverse-geocode' && request.method === 'GET') {
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!lat || !lng) return json({ error: 'Missing lat/lng' }, 400);
    const gmapsKey = env.GMAPS_KEY || '';
    if (!gmapsKey)
      return json({ lat: null, lng: null, source: 'none', note: 'Set GMAPS_KEY in Cloudflare env' });
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&region=it&key=${gmapsKey}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.results?.[0]) {
        const comps = d.results[0].address_components || [];
        const parsed = parseGeocodeComponents(comps);
        return json({
          lat: parseFloat(lat), lng: parseFloat(lng),
          formatted: d.results[0].formatted_address,
          town: parsed.town,
          commune: parsed.commune,
          prov: parsed.prov,
          source: 'gmaps',
        });
      }
      return json({ lat: null, lng: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ lat: null, lng: null, source: 'error', error: e.message });
    }
  }

  if (path === 'directions' && request.method === 'GET') {
    const fromLat = url.searchParams.get('fromLat');
    const fromLng = url.searchParams.get('fromLng');
    const toLat = url.searchParams.get('toLat');
    const toLng = url.searchParams.get('toLng');
    if (!fromLat || !fromLng || !toLat || !toLng)
      return json({ error: 'Missing params' }, 400);
    const gmapsKey = env.GMAPS_KEY || '';
    if (!gmapsKey)
      return json({ points: null, minutes: null, source: 'none', note: 'Set GMAPS_KEY in Cloudflare env' });
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=driving&key=${gmapsKey}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.routes?.[0]?.overview_polyline?.points) {
        const leg = d.routes[0].legs?.[0];
        return json({
          points: decodePolyline(d.routes[0].overview_polyline.points),
          minutes: leg ? Math.round(leg.duration.value / 60) : null,
          distanceKm: leg ? Math.round(leg.distance.value / 100) / 10 : null,
          source: 'gmaps',
        });
      }
      return json({ points: null, minutes: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ points: null, minutes: null, source: 'error', error: e.message });
    }
  }

  if (path === 'elevation' && request.method === 'GET') {
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!lat || !lng) return json({ error: 'Missing params' }, 400);
    const gmapsKey = env.GMAPS_KEY || '';
    if (!gmapsKey)
      return json({ elevation: null, source: 'none', note: 'Set GMAPS_KEY in Cloudflare env' });
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${gmapsKey}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.results?.[0])
        return json({ elevation: d.results[0].elevation, source: 'gmaps' });
      return json({ elevation: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ elevation: null, source: 'error', error: e.message });
    }
  }

  if (path === 'drive-time' && request.method === 'GET') {
    const fromLat = url.searchParams.get('fromLat');
    const fromLng = url.searchParams.get('fromLng');
    const toLat   = url.searchParams.get('toLat');
    const toLng   = url.searchParams.get('toLng');
    if (!fromLat || !fromLng || !toLat || !toLng)
      return json({ error: 'Missing params' }, 400);
    const gmapsKey = env.GMAPS_KEY || '';
    if (!gmapsKey)
      return json({ minutes: null, source: 'none', note: 'Set GMAPS_KEY in Cloudflare env' });
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${fromLat},${fromLng}&destinations=${toLat},${toLng}&mode=driving&key=${gmapsKey}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.rows?.[0]?.elements?.[0]?.status === 'OK')
        return json({ minutes: Math.round(d.rows[0].elements[0].duration.value / 60), source: 'gmaps' });
      return json({ minutes: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ minutes: null, source: 'error', error: e.message });
    }
  }

  if (path === 'ifl-sync' && request.method === 'POST') {
    const { baseGrp, iflToken, properties } = await request.json();
    const iflIds = new Set(properties.map(p => String(p.id)));
    const priceMap = Object.fromEntries(properties.map(p => [String(p.id), p.price]));
    const ELIM = new Set(['Unavailable', 'Rejected', 'Deleted-Idealista']);
    const IFL_RESET_ELIM = new Set(['Unresponsive', 'Rejected', 'Deleted']);
    const dataRaw = await env.HH_KV.get('data');
    if (!dataRaw)
      return json({ ok: true, toAdd: properties, updated: [], markedDeleted: [], writeBackQueue: [] });
    const props = parseProps(dataRaw);
    const storedIds = new Set(props.map(p => String(p.id)));
    const toAdd = [], updated = [], markedDeleted = [], writeBackQueue = [];
    const now = Date.now();
    for (const sp of props) {
      const sid = String(sp.id);
      if ((sp.sourceIfl || 'none') !== iflToken) continue;
      const isElim = ELIM.has(sp.status);
      if (!isElim && !iflIds.has(sid)) {
        sp.status = 'Deleted-Idealista'; markedDeleted.push(sid);
        if (!sp._fts) sp._fts = {};
        sp._fts.status = now;
        sp._v = now;
      } else if (!isElim && iflIds.has(sid)) {
        const np = priceMap[sid];
        if (np !== undefined && np >= 30 && Math.abs((sp.price||0) - np) > 1) {
          sp.price = np; updated.push({id:sid,price:np});
          if (!sp._fts) sp._fts = {};
          sp._fts.price = now;
        }
        if (baseGrp && sp.grp !== baseGrp) {
          sp.grp = baseGrp; updated.push({id:sid,grp:baseGrp});
          if (!sp._fts) sp._fts = {};
          sp._fts.grp = now;
        }
        if (IFL_RESET_ELIM.has(sp.status)) {
          sp.status = 'Reset'; updated.push({id:sid,status:'Reset'});
          if (!sp._fts) sp._fts = {};
          sp._fts.status = now;
          sp._v = now;
        }
      } else if (isElim && iflIds.has(sid)) {
        writeBackQueue.push({ id: sid });
      }
    }
    for (const p of properties) if (!storedIds.has(String(p.id))) toAdd.push(p);
    let grpUpdated = false;
    for (const p of properties) {
      const sp = props.find(x => String(x.id) === String(p.id));
      if (sp && baseGrp && sp.grp !== baseGrp) { sp.grp = baseGrp; grpUpdated = true; }
    }
    if (markedDeleted.length || updated.length || grpUpdated) await saveDataProps(env, props);
    return json({ ok: true, toAdd, updated, markedDeleted, writeBackQueue });
  }

  return json({ error: 'Not found: ' + path }, 404);
}
