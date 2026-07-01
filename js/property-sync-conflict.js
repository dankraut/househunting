/** @module property-sync-conflict — remote edit detection while detail modal is open */
import { PERSIST_FIELDS } from './config.js';

const DISPLAY_FIELDS = ['name', 'status', 'address', 'gps', 'price', 'rooms', 'size',
  'broker', 'brokerPhone', 'notes', 'userPlannedDate', 'userPlannedTime', 'schedDate', 'schedTime'];

export function createPropSyncConflict() {
  let _snapshot = null;
  let _remote = null;

  function snapshotProp(p) {
    if (!p) { _snapshot = null; return; }
    _snapshot = {
      id: p.id,
      _v: p._v || 0,
      _fts: { ...(p._fts || {}) },
      fields: {},
    };
    for (const f of PERSIST_FIELDS) _snapshot.fields[f] = p[f];
    _remote = null;
    hideBanner();
  }

  function detectConflict(serverProp) {
    if (!_snapshot || !serverProp || String(serverProp.id) !== String(_snapshot.id)) {
      return { changed: false, fields: [] };
    }
    const sTs = serverProp._fts || {};
    const snapTs = _snapshot._fts || {};
    const changed = [];
    for (const field of PERSIST_FIELDS) {
      const st = sTs[field] || 0;
      const lt = snapTs[field] || 0;
      if (st > lt && serverProp[field] !== _snapshot.fields[field]) {
        changed.push(field);
      }
    }
    if ((serverProp._v || 0) > (_snapshot._v || 0) && !changed.length) {
      for (const f of DISPLAY_FIELDS) {
        if (serverProp[f] !== _snapshot.fields[f]) changed.push(f);
      }
    }
    return { changed: changed.length > 0, fields: changed };
  }

  function noteRemoteUpdate(serverProp) {
    const c = detectConflict(serverProp);
    if (!c.changed) return false;
    _remote = serverProp;
    showBanner(c.fields);
    return true;
  }

  function getRemote() { return _remote; }

  function clear() {
    _snapshot = null;
    _remote = null;
    hideBanner();
  }

  function showBanner(fields) {
    const el = document.getElementById('dm-sync-conflict');
    if (!el) return;
    const who = localStorage.getItem('hh_user_name') ? 'Another user' : 'Someone else';
    const preview = fields.slice(0, 4).join(', ') + (fields.length > 4 ? '…' : '');
    el.innerHTML = `<span>${who} updated this property (${preview}).</span>
      <button type="button" class="io-btn" onclick="dmReloadFromServer()">Reload</button>
      <button type="button" class="io-btn" onclick="dmDismissSyncConflict()" style="margin-left:6px">Keep mine</button>`;
    el.style.display = 'flex';
  }

  function hideBanner() {
    const el = document.getElementById('dm-sync-conflict');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  function dismiss() {
    _remote = null;
    hideBanner();
  }

  return {
    snapshotProp,
    detectConflict,
    noteRemoteUpdate,
    getRemote,
    clear,
    dismiss,
    hideBanner,
  };
}
