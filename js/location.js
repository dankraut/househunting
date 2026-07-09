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

  function isCoordinateGps(gps) {
    const [lat, lng] = parseGPS(gps);
    return lat != null && lng != null;
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

  function getPropCalcGps(p) {
    return (p.calcGps && String(p.calcGps).trim()) ? String(p.calcGps).trim() : '';
  }

  function clearPropCalcGps(p) {
    if (!p) return;
    p.calcGps = '';
  }

  function getPropTownQuery(p) {
    if (!p) return '';
    const built = buildAddressFromParts(p.commune, p.town, p.prov);
    return built || (p.town ? `${p.town}${p.prov ? ', ' + p.prov : ''}, Italy` : '');
  }

  function formatPropTownDisplay(p) {
    if (!p) return '';
    const town = (p.town || p.commune || '').trim();
    const prov = (p.prov || '').trim().toUpperCase();
    if (town && prov) return `${town}, ${prov}`;
    if (town) return town;
    const addr = (p.address || '').trim();
    if (addr) return addr.replace(/,?\s*Italy\s*$/i, '').trim();
    return '';
  }

  function applyTownTextToProp(p, raw) {
    if (!p || !raw || !String(raw).trim()) return;
    const sansItaly = String(raw).trim().replace(/,?\s*Italy\s*$/i, '').trim();
    const parts = sansItaly.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    if (parts.length >= 2 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) {
      p.prov = parts[parts.length - 1];
      p.town = parts[parts.length - 2];
      if (parts.length >= 3) p.commune = parts[parts.length - 3];
    } else {
      p.town = parts[parts.length - 1];
      if (parts.length >= 2) p.commune = parts[parts.length - 2];
    }
    const label = formatPropTownDisplay(p);
    if (label) p.address = label + ', Italy';
  }

  async function syncCalcGpsFromTown(p) {
    const q = getPropTownQuery(p);
    if (!q) {
      clearPropCalcGps(p);
      if (!getPropGps(p)) clearEntityCoords(p);
      return { ok: true, source: 'cleared' };
    }
    const geo = await geocodeAddress(q);
    if (!geo) return { ok: false, error: 'Could not find coordinates for that town' };
    p.calcGps = normalizeGpsString(`${geo.lat},${geo.lng}`);
    p.lat = geo.lat;
    p.lng = geo.lng;
    if (geo.town) p.town = geo.town;
    if (geo.commune) p.commune = geo.commune;
    if (geo.prov) p.prov = String(geo.prov).toUpperCase();
    const label = formatItalianLocation(geo);
    if (label) p.address = label;
    return { ok: true, source: 'calc-gps' };
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

  function extractTownQuery(raw) {
    if (!raw || !raw.trim()) return null;
    const s = raw.trim().replace(/,?\s*Italy\s*$/i, '').trim();
    const parts = s.split(',').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    const provInline = last.match(/^(.+?)\s+([A-Z]{2})$/);
    if (provInline) return `${provInline[1].trim()}, ${provInline[2]}, Italy`;
    if (/^[A-Z]{2}$/.test(last) && parts.length >= 2) {
      return `${parts[parts.length - 2]}, ${last}, Italy`;
    }
    if (parts.length >= 2) return `${last}, Italy`;
    const singleProv = parts[0].match(/^(.+?)\s+([A-Z]{2})$/);
    if (singleProv) return `${singleProv[1].trim()}, ${singleProv[2]}, Italy`;
    return `${parts[0]}, Italy`;
  }

  async function geocodeOneQuery(q) {
    if (!q || !q.trim()) return null;
    let query = q.trim();
    if (!/italy/i.test(query)) query += ', Italy';
    try {
      const { ok, data: d } = await api.geocode(query);
      if (ok && d?.lat != null && d?.lng != null) return d;
    } catch (e) {}
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=it`, { headers: { 'Accept-Language': 'en' } });
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

  async function geocodeAddress(query) {
    if (!query || !query.trim()) return null;
    let q = query.trim();
    if (!/italy/i.test(q)) q += ', Italy';
    const geo = await geocodeOneQuery(q);
    if (geo) return geo;
    const townQ = extractTownQuery(query);
    if (townQ && townQ.toLowerCase() !== q.toLowerCase()) {
      const townGeo = await geocodeOneQuery(townQ);
      if (townGeo) return { ...townGeo, townFallback: true };
    }
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

  /** Pick sync mode: GPS field accepts coordinates or address/town text. */
  function resolveLocSyncMode({ gps, address, fromField } = {}) {
    const gpsStr = gps && String(gps).trim();
    const addrStr = address && String(address).trim();
    const hasGps = !!gpsStr;
    const hasAddr = !!addrStr;
    if (fromField === 'gps') return hasGps ? 'gps' : 'auto';
    if (fromField === 'address') return 'address';
    if (hasGps) return 'gps';
    return hasAddr ? 'address' : 'auto';
  }

  function applyAddressText(entity, addr, isBase) {
    if (!addr) return;
    entity.address = addr;
    if (isBase) return;
    const provM = addr.match(/,\s*([A-Z]{2})\b/);
    if (provM) entity.prov = provM[1];
    const sansItaly = addr.replace(/,?\s*Italy\s*$/i, '').trim();
    const parts = sansItaly.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      entity.town = parts[parts.length - 1];
      if (parts.length >= 3) entity.commune = parts[parts.length - 2];
    } else if (parts.length === 1) {
      entity.town = parts[0];
    }
  }

  async function syncEntityLocation(entity, {
    gps, address, isBase = false, mode = 'auto', overwriteTown = false,
  } = {}) {
    const gpsIn = gps !== undefined ? String(gps).trim() : (isBase ? getBaseGps(entity) : getPropGps(entity));
    let addrIn = address !== undefined ? String(address).trim() : (isBase ? (entity.address || '').trim() : formatPropTownDisplay(entity));

    const applyForward = async () => {
      if (!isBase) applyTownTextToProp(entity, addrIn);
      const q = isBase ? (addrIn && !/italy/i.test(addrIn) ? addrIn + ', Italy' : addrIn) : getPropTownQuery(entity);
      if (!q) {
        if (!isBase) {
          clearPropCalcGps(entity);
          if (!getPropGps(entity)) clearEntityCoords(entity);
        } else {
          entity.gps = '';
          clearEntityCoords(entity);
        }
        return { ok: true, source: 'cleared' };
      }
      if (isBase) {
        if (!/italy/i.test(addrIn)) addrIn += ', Italy';
        entity.address = addrIn;
        const geo = await geocodeAddress(addrIn);
        if (!geo) return { ok: false, error: 'Could not find coordinates for that town' };
        entity.lat = geo.lat;
        entity.lng = geo.lng;
        entity.gps = normalizeGpsString(`${geo.lat},${geo.lng}`);
        const label = formatItalianLocation(geo);
        if (label) entity.address = label;
        return { ok: true, source: geo.townFallback ? 'geocode-town-fallback' : 'geocode' };
      }
      return syncCalcGpsFromTown(entity);
    };

    const applyGpsText = async () => {
      const geo = await geocodeAddress(gpsIn);
      if (!geo) return { ok: false, error: 'Could not find coordinates for that location' };
      entity.lat = geo.lat;
      entity.lng = geo.lng;
      entity.gps = normalizeGpsString(`${geo.lat},${geo.lng}`);
      clearPropCalcGps(entity);
      if (!isBase) entity.gpsPinExact = true;
      const label = formatItalianLocation(geo);
      if (label) entity.address = label;
      if (!isBase) {
        if (geo.town) entity.town = geo.town;
        if (geo.commune) entity.commune = geo.commune;
        if (geo.prov) entity.prov = String(geo.prov).toUpperCase();
      }
      return { ok: true, source: geo.townFallback ? 'geocode-town-fallback' : 'geocode' };
    };

    const applyReverse = async () => {
      if (isCoordinateGps(gpsIn)) {
        if (!applyGpsToEntity(entity, gpsIn)) {
          return { ok: false, error: 'Invalid GPS coordinates' };
        }
        if (!isBase) {
          clearPropCalcGps(entity);
          entity.gpsPinExact = true;
        }
        if (addrIn && !overwriteTown && !isBase) {
          applyTownTextToProp(entity, addrIn);
          return { ok: true, source: 'gps' };
        }
        const rev = await reverseGeocode(entity.lat, entity.lng);
        if (rev) {
          const label = formatItalianLocation(rev);
          if (label) entity.address = label;
          if (!isBase) {
            if (rev.town) entity.town = rev.town;
            if (rev.commune) entity.commune = rev.commune;
            if (rev.prov) entity.prov = String(rev.prov).toUpperCase();
          }
        } else if (addrIn && !isBase) {
          applyTownTextToProp(entity, addrIn);
        } else if (addrIn && isBase) {
          applyAddressText(entity, addrIn, isBase);
        }
        return { ok: true, source: 'gps' };
      }
      return isBase ? applyGpsText() : applyGpsText();
    };

    const applyAddressOnly = () => {
      if (addrIn) {
        if (isBase) applyAddressText(entity, addrIn, isBase);
        else applyTownTextToProp(entity, addrIn);
      }
      return { ok: true, source: 'gps' };
    };

    if (mode === 'address') {
      if (!isBase && gpsIn) return applyAddressOnly();
      if (addrIn) return applyForward();
      if (!isBase) {
        clearPropCalcGps(entity);
        if (!getPropGps(entity)) clearEntityCoords(entity);
        return { ok: true, source: 'cleared' };
      }
      entity.gps = '';
      clearEntityCoords(entity);
      return { ok: true, source: 'cleared' };
    }

    if (mode === 'gps') {
      if (gpsIn) return applyReverse();
      if (!isBase) {
        entity.gps = '';
        entity.gpsPinExact = false;
        return syncCalcGpsFromTown(entity);
      }
      entity.gps = '';
      clearEntityCoords(entity);
      return { ok: true, source: 'cleared' };
    }

    if (gpsIn) return applyReverse();
    if (addrIn) return applyForward();
    if (!isBase) {
      clearPropCalcGps(entity);
      entity.gps = '';
      entity.gpsPinExact = false;
      clearEntityCoords(entity);
      return { ok: true, source: 'cleared' };
    }
    entity.gps = '';
    clearEntityCoords(entity);
    return { ok: true, source: 'cleared' };
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
      const geo = await geocodeAddress(gps);
      if (geo) {
        p.lat = geo.lat;
        p.lng = geo.lng;
        p.gps = normalizeGpsString(`${geo.lat},${geo.lng}`);
        clearPropCalcGps(p);
        return { lat: geo.lat, lng: geo.lng };
      }
    }
    const calc = getPropCalcGps(p);
    if (calc) {
      const [lat, lng] = parseGPS(calc);
      if (lat != null && lng != null) {
        p.lat = lat;
        p.lng = lng;
        return { lat, lng };
      }
    }
    if (p.lat != null && p.lng != null) {
      return { lat: p.lat, lng: p.lng };
    }
    const townQ = getPropTownQuery(p);
    if (!townQ) {
      clearEntityCoords(p);
      return null;
    }
    const r = await syncCalcGpsFromTown(p);
    if (r.ok && p.lat != null && p.lng != null) {
      return { lat: p.lat, lng: p.lng };
    }
    if (!gps && !calc) clearEntityCoords(p);
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
      const geo = await geocodeAddress(gps);
      if (geo) {
        base.lat = geo.lat;
        base.lng = geo.lng;
        base.gps = normalizeGpsString(`${geo.lat},${geo.lng}`);
        return { lat: geo.lat, lng: geo.lng };
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
    if (!p.calcGps) p.calcGps = '';
    if (!p.address || !p.address.trim()) {
      const built = buildAddressFromParts(p.commune, p.town, p.prov);
      if (built) p.address = built;
    }
    if (getPropGps(p)) {
      applyGpsToEntity(p, p.gps);
      if (p.gpsPinExact !== false) p.gpsPinExact = true;
    } else if (getPropCalcGps(p)) {
      const [lat, lng] = parseGPS(p.calcGps);
      if (lat != null && lng != null) {
        p.lat = lat;
        p.lng = lng;
      }
    } else if (p.lat != null && p.lng != null) {
      p.calcGps = normalizeGpsString(`${p.lat},${p.lng}`);
      p.gps = '';
    } else {
      p.gps = '';
      p.gpsPinExact = false;
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

  async function runLocSync(prefix, scratch, {
    gps, address, isBase, mode, overwriteTown, onSuccess, fromField,
  } = {}) {
    if (_locSyncing) return { skipped: true };
    _locSyncing = true;
    setLocError(prefix, {});
    setLocLoading(prefix, true);
    try {
      const syncMode = mode || resolveLocSyncMode({ gps, address, fromField });
      const townOverwrite = overwriteTown;
      const r = await syncEntityLocation(scratch, {
        gps, address, isBase, mode: syncMode, overwriteTown: !!townOverwrite,
      });
      if (!r.ok) {
        const err = r.error || 'Location lookup failed';
        if (syncMode === 'gps' || (syncMode === 'address' && !address)) {
          setLocError(prefix, { gps: syncMode === 'gps' ? err : undefined, address: syncMode === 'address' ? err : undefined, general: err });
        } else {
          setLocError(prefix, { address: err, general: err });
        }
        return r;
      }
      const ids = LOC_PREFIXES[prefix];
      if (ids) {
        const addrEl = document.getElementById(ids.address);
        const gpsEl = document.getElementById(ids.gps);
        if (addrEl) addrEl.value = isBase ? (scratch.address || address || '') : formatPropTownDisplay(scratch);
        if (gpsEl) gpsEl.value = scratch.gps || getPropGps(scratch) || '';
      }
      let msg = '';
      if (r.source === 'gps' && townOverwrite) msg = 'Town updated from GPS.';
      else if (r.source === 'geocode-town-fallback') msg = 'Street not found — coordinates set to town center.';
      else if (r.source === 'geocode') msg = syncMode === 'gps' ? 'GPS set as exact property location.' : 'Map pin updated from town.';
      else if (r.source === 'calc-gps') msg = 'Map pin calculated from town.';
      else if (r.source === 'gps' && syncMode === 'address') msg = 'Town updated (GPS unchanged).';
      else if (r.source === 'cleared') msg = 'GPS cleared — town pin restored.';
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
    isCoordinateGps,
    buildAddressFromParts,
    getPropAddress,
    getPropGps,
    getPropCalcGps,
    clearPropCalcGps,
    getPropTownQuery,
    formatPropTownDisplay,
    applyTownTextToProp,
    syncCalcGpsFromTown,
    getBaseGps,
    clearEntityCoords,
    normalizeGpsString,
    formatItalianLocation,
    applyGpsToEntity,
    geocodeAddress,
    reverseGeocode,
    resolveLocSyncMode,
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
