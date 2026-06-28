// House Hunt API — Cloudflare Pages Function
// Handles: GET/PUT /api/data, GET/POST /api/snapshots, POST /api/snapshots/restore, DELETE /api/snapshots/:id

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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!authOk(request, url)) return json({ error: 'Unauthorized' }, 401);

  // Strip /api/ prefix to get the sub-path
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // ── GET /api/data ──────────────────────────────────────────────────────────
  if (path === 'data' && request.method === 'GET') {
    const data = await env.HH_KV.get('data');
    return json(data || 'null');
  }

  // ── PUT /api/data ──────────────────────────────────────────────────────────
  if (path === 'data' && request.method === 'PUT') {
    const body = await request.text();
    await env.HH_KV.put('data', body);
    return json({ ok: true });
  }

  // ── GET /api/snapshots ─────────────────────────────────────────────────────
  if (path === 'snapshots' && request.method === 'GET') {
    const index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    return json(index);
  }

  // ── POST /api/snapshots ────────────────────────────────────────────────────
  if (path === 'snapshots' && request.method === 'POST') {
    const { label, data } = await request.json();
    const id = Date.now().toString();
    let index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    let count = 0;
    try { count = JSON.parse(data)?.props?.length || 0; } catch {}
    index.unshift({ id, label: label || '', ts: new Date().toISOString(), count });
    // Prune oldest beyond MAX_SNAPSHOTS
    const removed = index.splice(MAX_SNAPSHOTS);
    for (const r of removed) await env.HH_KV.delete('snapshot:' + r.id);
    await env.HH_KV.put('snapshots-index', JSON.stringify(index));
    await env.HH_KV.put('snapshot:' + id, data);
    return json({ ok: true, id });
  }

  // ── POST /api/snapshots/restore ────────────────────────────────────────────
  if (path === 'snapshots/restore' && request.method === 'POST') {
    const { id } = await request.json();
    const data = await env.HH_KV.get('snapshot:' + id);
    if (!data) return json({ error: 'Snapshot not found' }, 404);
    await env.HH_KV.put('data', data);
    return json({ ok: true });
  }

  // ── DELETE /api/snapshots/:id ──────────────────────────────────────────────
  if (path.startsWith('snapshots/') && request.method === 'DELETE') {
    const id = path.slice('snapshots/'.length);
    await env.HH_KV.delete('snapshot:' + id);
    let index = JSON.parse((await env.HH_KV.get('snapshots-index')) || '[]');
    index = index.filter(e => e.id !== id);
    await env.HH_KV.put('snapshots-index', JSON.stringify(index));
    return json({ ok: true });
  }


  // ── GET /api/bases ──────────────────────────────────────────────────────────
  if (path === 'bases' && request.method === 'GET') {
    const bases = await env.HH_KV.get('bases');
    return json(bases || '[]');
  }

  // ── PUT /api/bases ──────────────────────────────────────────────────────────
  if (path === 'bases' && request.method === 'PUT') {
    const body = await request.text();
    await env.HH_KV.put('bases', body);
    return json({ ok: true });
  }

  // ── POST /api/ifl-sync ──────────────────────────────────────────────────────
  // body: {baseGrp, iflToken, properties: [{id, price, title?, rooms?, size?, town?}]}
  // Returns: {toAdd, updated, markedDeleted, writeBackQueue}
  if (path === 'ifl-sync' && request.method === 'POST') {
    const { baseGrp, iflToken, properties } = await request.json();
    const iflIds = new Set(properties.map(p => String(p.id)));
    const priceMap = Object.fromEntries(properties.map(p => [String(p.id), p.price]));

    const ELIM = new Set(['Unavailable', 'Rejected', 'Deleted-Idealista']);

    const dataRaw = await env.HH_KV.get('data');
    if (!dataRaw) {
      return json({ ok: true, toAdd: properties, updated: [], markedDeleted: [], writeBackQueue: [] });
    }

    const data = JSON.parse(dataRaw);
    const storedIds = new Set(data.props.map(p => String(p.id)));
    const toAdd = [];
    const updated = [];
    const markedDeleted = [];
    const writeBackQueue = [];

    for (const sp of data.props) {
      const sid = String(sp.id);
      if ((sp.sourceIfl || 'none') !== iflToken) continue;
      const isElim = sp.deleted || ELIM.has(sp.status);

      if (!isElim && !iflIds.has(sid)) {
        sp.status = 'Deleted-Idealista';
        markedDeleted.push(sid);
      } else if (!isElim && iflIds.has(sid)) {
        const newPrice = priceMap[sid];
        if (newPrice !== undefined && Math.abs((sp.price || 0) - newPrice) > 1) {
          sp.price = newPrice;
          updated.push({ id: sid, price: newPrice });
        }
      } else if (isElim && iflIds.has(sid)) {
        writeBackQueue.push({ id: sid });
      }
    }

    for (const p of properties) {
      if (!storedIds.has(String(p.id))) toAdd.push(p);
    }

    if (markedDeleted.length || updated.length) {
      await env.HH_KV.put('data', JSON.stringify(data));
    }

    return json({ ok: true, toAdd, updated, markedDeleted, writeBackQueue });
  }

  return json({ error: 'Not found' }, 404);
}
