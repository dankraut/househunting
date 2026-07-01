// House Hunt API — Cloudflare Pages Function v1.3
// Routes: GET/PUT /api/data, GET/POST /api/snapshots, POST /api/snapshots/restore,
//         DELETE /api/snapshots/:id, GET/PUT /api/bases, POST /api/ifl-sync,
//         GET /api/drive-time, GET /api/geocode, GET /api/directions, GET /api/elevation

const TOKEN = 'jmjk05DK';
const MAX_SNAPSHOTS = 20;

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

// Parse stored data (may be plain array or {props:[...]} for compat)
function parseProps(raw) {
  if (!raw) return [];
  const d = JSON.parse(raw);
  return Array.isArray(d) ? d : (d.props || []);
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

  if (path === 'data' && request.method === 'GET') {
    const data = await env.HH_KV.get('data');
    return json(data || '[]');
  }

  if (path === 'data' && request.method === 'PUT') {
    const body = await request.text();
    await env.HH_KV.put('data', body);
    return json({ ok: true });
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
    await env.HH_KV.put('data', raw);
    return json({ ok: true, data: parseProps(raw) });
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
    return json(bases || '[]');
  }

  if (path === 'bases' && request.method === 'PUT') {
    const body = await request.text();
    await env.HH_KV.put('bases', body);
    return json({ ok: true });
  }

  // GET /api/drive-time?fromLat=&fromLng=&toLat=&toLng=
  // Proxies Google Maps Distance Matrix. Set GMAPS_KEY in Cloudflare env vars.
  // Returns {minutes, source} or {minutes:null} so client falls back to OSRM.
  // GET /api/geocode?address=
  // Requires GMAPS_KEY with Geocoding API enabled.
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
        const prov = comps.find(c => c.types.includes('administrative_area_level_2'))?.short_name || '';
        return json({
          lat: loc.lat, lng: loc.lng,
          formatted: d.results[0].formatted_address,
          prov, source: 'gmaps',
        });
      }
      return json({ lat: null, lng: null, source: 'gmaps-error', gmStatus: d.status });
    } catch (e) {
      return json({ lat: null, lng: null, source: 'error', error: e.message });
    }
  }

  // GET /api/directions?fromLat=&fromLng=&toLat=&toLng=
  // Requires GMAPS_KEY with Directions API enabled.
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

  // GET /api/elevation?lat=&lng=
  // Requires GMAPS_KEY with Elevation API enabled.
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
    for (const sp of props) {
      const sid = String(sp.id);
      if ((sp.sourceIfl || 'none') !== iflToken) continue;
      const isElim = ELIM.has(sp.status);
      if (!isElim && !iflIds.has(sid)) {
        sp.status = 'Deleted-Idealista'; markedDeleted.push(sid);
      } else if (!isElim && iflIds.has(sid)) {
        const np = priceMap[sid];
        if (np !== undefined && np >= 30 && Math.abs((sp.price||0) - np) > 1) { sp.price = np; updated.push({id:sid,price:np}); }
        if (baseGrp && sp.grp !== baseGrp) { sp.grp = baseGrp; updated.push({id:sid,grp:baseGrp}); }
        if (IFL_RESET_ELIM.has(sp.status)) { sp.status = 'Reset'; updated.push({id:sid,status:'Reset'}); }
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
    if (markedDeleted.length || updated.length || grpUpdated) await env.HH_KV.put('data', JSON.stringify(props));
    return json({ ok: true, toAdd, updated, markedDeleted, writeBackQueue });
  }

  return json({ error: 'Not found: ' + path }, 404);
}
