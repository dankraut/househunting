// spa_relay.js — relays extension messages into the SPA page context
(function () {
  function relayPostMessage(payload) {
    const detail = { type: payload.type, ...payload };
    // Inject into page context so inline SPA listeners receive the event reliably.
    const script = document.createElement('script');
    script.textContent = `window.postMessage(${JSON.stringify(detail)}, '*');`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  window.addEventListener('message', (evt) => {
    if (!evt.data || evt.data.type !== 'HOUSEHUNT_DISCARD') return;
    chrome.runtime.sendMessage({ type: 'HOUSEHUNT_DISCARD', idealistaId: evt.data.idealistaId });
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'RELAY_IFL_SYNC' && msg.payload) {
      try {
        relayPostMessage({ type: 'HOUSEHUNT_IFL_ADD', ...msg.payload });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, reason: e.message || String(e) });
      }
      return true;
    }
    if (msg.type === 'RELAY_BROKER' && msg.payload) {
      try {
        relayPostMessage({ type: 'HOUSEHUNT_BROKER', ...msg.payload });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, reason: e.message || String(e) });
      }
      return true;
    }
    return false;
  });
})();
