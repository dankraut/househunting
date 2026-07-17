// background.js — House Hunt Extension service worker
importScripts('sync.js');

function setIflSyncStatus(text, type) {
  chrome.storage.local.set({ iflSyncStatus: { text, type, ts: Date.now() } });
}

async function runIflSyncJob(base) {
  const setStatus = (text, type) => setIflSyncStatus(text, type);
  try {
    await syncBase(base, setStatus);
  } catch (e) {
    setStatus('Sync error: ' + (e?.message || String(e)), 'err');
  }
}

// ── IFL sync (runs in service worker so popup can close) ─────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_IFL_SYNC') {
    if (!msg.base?.abbr) {
      sendResponse({ ok: false, reason: 'missing base' });
      return false;
    }
    setIflSyncStatus(`Syncing ${msg.base.name} (${msg.base.abbr})…`, 'loading');
    runIflSyncJob(msg.base);
    sendResponse({ ok: true, started: true });
    return false;
  }
  return false;
});

// ── Relay content.js → SPA (SEND_TO_SPA) ────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SEND_TO_SPA') return false;

  const { data, fragment } = msg;
  const spaFragment = (fragment && fragment.trim()) || 'househunt.pages.dev';

  chrome.tabs.query({}, (tabs) => {
    const spaTab = tabs.find(t =>
      t.url && t.url.includes(spaFragment) && !t.url.includes('idealista')
    );
    if (!spaTab) {
      sendResponse({ ok: false, reason: `No tab matching "${spaFragment}" found` });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: spaTab.id },
      world: 'MAIN',
      func: (payload) => { window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, window.location.origin); },
      args: [data],
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, reason: err.message }));
  });

  return true;
});

// ── Auto-discard: SPA relay → Idealista ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'HOUSEHUNT_DISCARD') return false;

  const { idealistaId } = msg;
  if (!idealistaId) { sendResponse({ ok: false, reason: 'no id' }); return false; }

  chrome.storage.local.get({ pendingDiscards: [] }, ({ pendingDiscards }) => {
    const id = String(idealistaId);
    if (!pendingDiscards.includes(id)) pendingDiscards.push(id);
    chrome.storage.local.set({ pendingDiscards }, () => {
      const url = `https://www.idealista.it/en/immobile/${id}/`;
      chrome.tabs.create({ url, active: false }, () => sendResponse({ ok: true }));
    });
  });

  return true;
});

// ── Pending data send (legacy) ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SEND_PENDING') return false;
  chrome.storage.local.get(['pendingData', 'spaUrl'], ({ pendingData, spaUrl }) => {
    if (!pendingData) { sendResponse({ ok: false, reason: 'No pending data' }); return; }
    const fragment = (spaUrl && spaUrl.trim()) || 'househunt.pages.dev';
    chrome.tabs.query({}, (tabs) => {
      const spaTab = tabs.find(t => t.url && t.url.includes(fragment) && !t.url.includes('idealista'));
      if (!spaTab) { sendResponse({ ok: false, reason: 'SPA tab not found' }); return; }
      chrome.scripting.executeScript({
        target: { tabId: spaTab.id },
        world: 'MAIN',
        func: (payload) => { window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, window.location.origin); },
        args: [pendingData],
      }).then(() => { chrome.storage.local.remove('pendingData'); sendResponse({ ok: true }); })
        .catch(e => sendResponse({ ok: false, reason: e.message }));
    });
  });
  return true;
});
