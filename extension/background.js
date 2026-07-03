// background.js — House Hunt Extension service worker v1.8.20

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
      func: (payload) => { window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, '*'); },
      args: [data],
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, reason: err.message }));
  });

  return true;
});

// ── Auto-discard: SPA relay → Idealista ─────────────────────────────────────
// Receives {type:'HOUSEHUNT_DISCARD', idealistaId} from spa_relay.js content script.
// Queues the ID in storage; content.js on Idealista property pages reads the queue
// and auto-clicks Discard when the matching property page loads.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'HOUSEHUNT_DISCARD') return false;

  const { idealistaId } = msg;
  if (!idealistaId) { sendResponse({ ok: false, reason: 'no id' }); return false; }

  // Add to pending discard queue
  chrome.storage.local.get({ pendingDiscards: [] }, ({ pendingDiscards }) => {
    const id = String(idealistaId);
    if (!pendingDiscards.includes(id)) pendingDiscards.push(id);
    chrome.storage.local.set({ pendingDiscards }, () => {
      // Open the property page (background tab) so content.js can click Discard
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
        func: (payload) => window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, '*'),
        args: [pendingData],
      }).then(() => { chrome.storage.local.remove('pendingData'); sendResponse({ ok: true }); })
        .catch(e => sendResponse({ ok: false, reason: e.message }));
    });
  });
  return true;
});
