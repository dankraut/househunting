/** @module location — GPS/town sync, geocoding, field loading & errors */
import { API_BASE } from './config.js';

export function createLocationModule(api) {
  let _locSyncing = false;
  let _locDebounce = null;

  function parseGPS(gps) {
    if (!gps || typeof gps !== 'string') return [null, null];
    const s = gps.trim();
    let m = s.match(/^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    const dms = s.match(/(\d+)[°]\s*(\d+)['′]?\s*([\d.]*)?["″]?\s*([NnSs])\s+(\d+)[°]\s*(\d+)['′]?\s*([\d.]*)?["″]?\s*([EeWw])/);
    if (dms) {
      let lat = parseInt(dms[1], 10) + parseInt(dms[2], 10) / 60 + parseFloat(dms[3] || 0) / 3600;
      if (dms[4].toUpperCase() === 'S') lat = -lat;
      let lng = parseInt(dms[5], 10) + parseInt(dms[6], 10) / 60 + parseFloat(dms[7] || 0) / 3600;
      if (dms[8].toUpperCase() === 'W') lng = -lng;
      return [lat, lng];
    }
    return [null, null];
  }

  function buildAddressFromParts(commune, town, prov) {
    const parts = [commune, town].filter(Boolean);
    let addr = parts.join(', ');
    if (prov) addr += (addr ? ', ' : '') + prov.toUpperCase();
    if (addr && !/italy/i.test(addr)) addr += ', Italy';
    return addr;
  }

  function getPropAddress(p) {
    if (p.address && p.address.trim()) return p.address.trim();
    return buildAddressFromParts(p.commune, p.town, p.prov);
  }

  function getPropGps(p) {
    return (p.gps && String(p.gps).trim()) ? String(p.gps).trim() : '';
  }

  function getBaseGps(b) {
    return (b && b.gps && String(b.gps).trim()) ? String(b.gps).trim() : '';
  }

  function clearEntityCoords(e) {
    if (!e) return;
    e.lat = null;
    e.lng = null;
  }

  function normalizeGpsString(raw) {
    const [lat, lng] = parseGPS(raw);
    if (lat == null || lng == null) return '';
    return `${Number(lat.toFixed(6))},${Number(lng.toFixed(6))}`;
  }

  function formatItalianLocation(geo) {
    if (!geo) return '';
    const town = geo.town || geo.commune || '';
    const prov = geo.prov ? String(geo.prov).toUpperCase() : '';
    if (town && prov) return `${town}, ${prov}, Italy`;
    if (geo.formatted) {
      let f = geo.formatted.trim();
      if (!/italy/i.test(f)) f += ', Italy';
      return f;
    }
    return '';
  }

  function applyGpsToEntity(entity, gpsStr) {
    const norm = normalizeGpsString(gpsStr);
    if (!norm) return false;
    entity.gps = norm;
    const [lat, lng] = parseGPS(norm);
    entity.lat = lat;
    entity.lng = lng;
    return true;
  }

  async function geocodeAddress(query) {
    if (!query || !query.trim()) return null;
    let q = query.trim();
    if (!/italy/i.test(q)) q += ', Italy';
    try {
      const { ok, data: d } = await api.geocode(q);
      if (ok && d?.lat != null && d?.lng != null) return d;
    } catch (e) {}
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=it`, { headers: { 'Accept-Language': 'en' } });
      if (r.ok) {
        const d = await r.json();
        if (d?.[0]) {
          const parts = (d[0].display_name || '').split(',').map(s => s.trim());
          return {
            lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon),
            formatted: d[0].display_name,
            town: parts[0] || '',
            prov: parts.length > 2 ? parts[parts.length - 3].slice(0, 2).toUpperCase() : '',
            source: 'nominatim',
          };
        }
      }
    } catch (e) {}
    return null;
  }

  async function reverseGeocode(lat, lng) {
    if (lat == null || lng == null) return null;
    try {
      const { ok, data: d } = await api.reverseGeocode(lat, lng);
      if (ok && d?.lat != null && d?.lng != null) return d;
    } catch (e) {}
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      if (r.ok) {
        const d = await r.json();
        const a = d.address || {};
        const town = a.village || a.town || a.city || a.municipality || a.hamlet || '';
        const prov = (a['ISO3166-2-lvl4'] || '').replace('IT-', '') || (a.county || '').slice(0, 2).toUpperCase();
        return {
          lat, lng,
          formatted: d.display_name,
          town,
          commune: a.municipality || town,
          prov,
          source: 'nominatim',
        };
      }
    } catch (e) {}
    return null;
  }

  async function syncEntityLocation(entity, { gps, address, isBase = false, mode = 'auto', overwriteAddress = true } = {}) {
    const gpsIn = gps !== undefined ? String(gps).trim() : (isBase ? getBaseGps(entity) : getPropGps(entity));
    let addrIn = address !== undefined ? String(address).trim() : (isBase ? (entity.address || '').trim() : getPropAddress(entity));

    const applyForward = async () => {
      if (!/italy/i.test(addrIn)) addrIn += ', Italy';
      entity.address = addrIn;
      const geo = await geocodeAddress(addrIn);
      if (!geo) return { ok: false, error: 'Could not find coordinates for that town' };
      entity.lat = geo.lat;
      entity.lng = geo.lng;
      entity.gps = normalizeGpsString(`${geo.lat},${geo.lng}`);
      const label = formatItalianLocation(geo);
      if (label) entity.address = label;
      if (!isBase) {
        if (geo.town) entity.town = geo.town;
        if (geo.commune) entity.commune = geo.commune;
        if (geo.prov) entity.prov = String(geo.prov).toUpperCase();
      }
      return { ok: true, source: 'geocode' };
    };

    const applyReverse = async () => {
      if (!applyGpsToEntity(entity, gpsIn)) {
        return { ok: false, error: 'Invalid GPS coordinates' };
      }
      // Only reverse-geocode and update the address when it is blank or the
      // caller has confirmed overwriting the existing address.
      const hasExistingAddress = !!(entity.address && entity.address.trim());
      if (!hasExistingAddress || overwriteAddress) {
        const rev = await reverseGeocode(entity.lat, entity.lng);
        if (rev) {
          const label = formatItalianLocation(rev);
          if (label) entity.address = label;
          if (!isBase) {
            if (rev.town) entity.town = rev.town;
            if (rev.commune) entity.commune = rev.commune;
            if (rev.prov) entity.prov = String(rev.prov).toUpperCase();
          }
        }
      }
      return { ok: true, source: 'gps' };
    };

    if (mode === 'address') {
      // GPS takes precedence — if GPS is already set, editing the address field
      // does not touch coordinates (Rules 4 & 5).
      if (gpsIn) return { ok: true, source: 'noop' };
      if (addrIn) return applyForward();
      entity.gps = '';
      clearEntityCoords(entity);
      return { ok: true, source: 'cleared' };
    }

    if (mode === 'gps') {
      if (gpsIn) return applyReverse();
      entity.gps = '';
      clearEntityCoords(entity);
      return { ok: true, source: 'cleared' };
    }

    if (gpsIn) return applyReverse();
    entity.gps = '';
    clearEntityCoords(entity);
    if (!addrIn) return { ok: true, source: 'cleared' };
    return applyForward();
  }

  async function resolvePropCoords(p) {
    const gps = getPropGps(p);
    if (gps) {
      const [lat, lng] = parseGPS(gps);
      if (lat != null && lng != null) {
        p.lat = lat;
        p.lng = lng;
        return { lat, lng };
      }
    }
    if (p.lat != null && p.lng != null) {
      return { lat: p.lat, lng: p.lng };
    }
    const addr = getPropAddress(p);
    if (!addr) {
      clearEntityCoords(p);
      return null;
    }
    const geo = await geocodeAddress(addr);
    if (geo) {
      p.lat = geo.lat;
      p.lng = geo.lng;
      return { lat: geo.lat, lng: geo.lng };
    }
    if (!gps) clearEntityCoords(p);
    return null;
  }

  async function resolveStayBaseCoords(base) {
    if (!base || base.baseType === 'transit') return null;
    const gps = getBaseGps(base);
    if (gps) {
      const [lat, lng] = parseGPS(gps);
      if (lat != null && lng != null) {
        base.lat = lat;
        base.lng = lng;
        return { lat, lng };
      }
    }
    const addr = (base.address || '').trim();
    if (!addr) {
      if (!gps) clearEntityCoords(base);
      return null;
    }
    const geo = await geocodeAddress(addr);
    if (geo) {
      base.lat = geo.lat;
      base.lng = geo.lng;
      return { lat: geo.lat, lng: geo.lng };
    }
    if (!gps) clearEntityCoords(base);
    return null;
  }

  function migratePropLocation(p) {
    if (!getPropGps(p) && p.location && String(p.location).trim()) {
      const norm = normalizeGpsString(p.location);
      if (norm) p.gps = norm;
      delete p.location;
    }
    if (!p.address || !p.address.trim()) {
      const built = buildAddressFromParts(p.commune, p.town, p.prov);
      if (built) p.address = built;
    }
    if (getPropGps(p)) {
      applyGpsToEntity(p, p.gps);
    } else if (p.lat != null && p.lng != null) {
      p.gps = normalizeGpsString(`${p.lat},${p.lng}`);
    } else {
      p.gps = '';
      clearEntityCoords(p);
    }
  }

  function migrateBaseLocation(b) {
    b.baseType = b.baseType || 'stay';
    if (b.baseType === 'stay') {
      if (getBaseGps(b)) {
        applyGpsToEntity(b, b.gps);
      } else {
        b.gps = '';
        clearEntityCoords(b);
      }
    }
    if (!b.fromBase) b.fromBase = '';
    if (!b.toBase) b.toBase = '';
  }

  // ─── Location field UI (loading + inline errors) ───────────────────────────
  const LOC_PREFIXES = {
    dm: { address: 'dm-address', gps: 'dm-gps', status: 'dm-loc-status', addrErr: 'dm-address-error', gpsErr: 'dm-gps-error' },
    base: { address: 'base-form-address', gps: 'base-form-gps', status: 'base-loc-status', addrErr: 'base-address-error', gpsErr: 'base-gps-error' },
    add: { address: 'add-address', gps: 'add-gps', status: 'add-loc-status', addrErr: 'add-address-error', gpsErr: 'add-gps-error' },
  };

  function setLocLoading(prefix, loading) {
    const ids = LOC_PREFIXES[prefix];
    if (!ids) return;
    for (const k of ['address', 'gps']) {
      const el = document.getElementById(ids[k]);
      if (el) el.classList.toggle('loc-loading', loading);
    }
    const st = document.getElementById(ids.status);
    if (st && loading) {
      st.textContent = 'Looking up location…';
      st.className = 'loc-status loc-status-loading';
    }
  }

  function setLocError(prefix, { address, gps, general } = {}) {
    const ids = LOC_PREFIXES[prefix];
    if (!ids) return;
    const setErr = (id, msg) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg || '';
      el.style.display = msg ? 'block' : 'none';
    };
    setErr(ids.addrErr, address);
    setErr(ids.gpsErr, gps);
    const st = document.getElementById(ids.status);
    if (st) {
      if (general) {
        st.textContent = general;
        st.className = 'loc-status loc-status-error';
      } else if (!address && !gps) {
        st.textContent = '';
        st.className = 'loc-status';
      }
    }
    for (const k of ['address', 'gps']) {
      const el = document.getElementById(ids[k]);
      if (el) el.classList.toggle('loc-field-error', !!(k === 'address' ? address : gps));
    }
  }

  function setLocSuccess(prefix, message) {
    const ids = LOC_PREFIXES[prefix];
    if (!ids) return;
    setLocError(prefix, {});
    const st = document.getElementById(ids.status);
    if (st && message) {
      st.textContent = message;
      st.className = 'loc-status loc-status-ok';
    }
  }

  function clearLocUi(prefix) {
    setLocLoading(prefix, false);
    setLocError(prefix, {});
    const ids = LOC_PREFIXES[prefix];
    if (ids?.status) {
      const st = document.getElementById(ids.status);
      if (st) { st.textContent = ''; st.className = 'loc-status'; }
    }
  }

  async function runLocSync(prefix, scratch, { gps, address, isBase, mode, overwriteAddress = true, onSuccess }) {
    if (_locSyncing) return { skipped: true };
    _locSyncing = true;
    setLocError(prefix, {});
    setLocLoading(prefix, true);
    try {
      const r = await syncEntityLocation(scratch, { gps, address, isBase, mode, overwriteAddress });
      if (!r.ok) {
        const err = r.error || 'Location lookup failed';
        if (mode === 'gps' || (mode === 'address' && !address)) {
          setLocError(prefix, { gps: mode === 'gps' ? err : undefined, address: mode === 'address' ? err : undefined, general: err });
        } else {
          setLocError(prefix, { address: err, general: err });
        }
        return r;
      }
      const ids = LOC_PREFIXES[prefix];
      if (ids) {
        const addrEl = document.getElementById(ids.address);
        const gpsEl = document.getElementById(ids.gps);
        if (addrEl) addrEl.value = scratch.address || '';
        if (gpsEl) gpsEl.value = scratch.gps || '';
      }
      const msg = r.source === 'gps' ? 'Town updated from GPS.' : r.source === 'geocode' ? 'GPS updated from town.' : '';
      setLocSuccess(prefix, msg);
      if (onSuccess) onSuccess(scratch, r);
      return r;
    } finally {
      setLocLoading(prefix, false);
      _locSyncing = false;
    }
  }

  function isLocSyncing() { return _locSyncing; }

  function debouncedLocBlur(prefix, fromField, handler) {
    if (_locDebounce) clearTimeout(_locDebounce);
    _locDebounce = setTimeout(() => handler(fromField), 400);
  }

  return {
    parseGPS,
    buildAddressFromParts,
    getPropAddress,
    getPropGps,
    getBaseGps,
    clearEntityCoords,
    normalizeGpsString,
    formatItalianLocation,
    applyGpsToEntity,
    geocodeAddress,
    reverseGeocode,
    syncEntityLocation,
    resolvePropCoords,
    resolveStayBaseCoords,
    migratePropLocation,
    migrateBaseLocation,
    setLocLoading,
    setLocError,
    setLocSuccess,
    clearLocUi,
    runLocSync,
    isLocSyncing,
    debouncedLocBlur,
    LOC_PREFIXES,
  };
}
