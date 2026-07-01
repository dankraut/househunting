/** @module api-client — House Hunt REST API wrapper */
import { API_BASE } from './config.js';

export function createApiClient(getToken) {
  function headers(json = true) {
    const h = { Authorization: 'Bearer ' + (getToken() || '') };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function request(path, { method = 'GET', body, json = true } = {}) {
    const opts = { method, headers: headers(json) };
    if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    const r = await fetch(`${API_BASE}${path}`, opts);
    let data = null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { data = await r.json(); } catch (e) { data = null; }
    }
    return { ok: r.ok, status: r.status, data };
  }

  return {
    headers,
    base: API_BASE,

    getSync(serverRev, basesRev) {
      return request(`/sync?rev=${serverRev}&basesRev=${basesRev}`);
    },
    getData() { return request('/data'); },
    putData(payload) { return request('/data', { method: 'PUT', body: payload }); },
    getBases() { return request('/bases'); },
    putBases(bases) { return request('/bases', { method: 'PUT', body: bases }); },

    geocode(address) {
      return request(`/geocode?address=${encodeURIComponent(address)}`);
    },
    reverseGeocode(lat, lng) {
      return request(`/reverse-geocode?lat=${lat}&lng=${lng}`);
    },
    directions(fromLat, fromLng, toLat, toLng) {
      return request(`/directions?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`);
    },
    elevation(lat, lng) {
      return request(`/elevation?lat=${lat}&lng=${lng}`);
    },
    driveTime(fromLat, fromLng, toLat, toLng) {
      return request(`/drive-time?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`);
    },

    acquireLock(payload) { return request('/lock', { method: 'POST', body: payload }); },
    releaseLock(payload) { return request('/lock', { method: 'DELETE', body: payload }); },

    listSnapshots() { return request('/snapshots'); },
    createSnapshot(payload) { return request('/snapshots', { method: 'POST', body: payload }); },
    restoreSnapshot(id) { return request('/snapshots/restore', { method: 'POST', body: { id } }); },
    deleteSnapshot(id) { return request(`/snapshots/${id}`, { method: 'DELETE' }); },

    iflSync(payload) { return request('/ifl-sync', { method: 'POST', body: payload }); },
  };
}
