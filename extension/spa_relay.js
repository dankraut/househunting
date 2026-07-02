// spa_relay.js — House Hunt SPA relay v1.8.18
// Listens for HOUSEHUNT_DISCARD postMessages from the SPA and relays to background.
(function () {
  window.addEventListener('message', (evt) => {
    if (!evt.data || evt.data.type !== 'HOUSEHUNT_DISCARD') return;
    chrome.runtime.sendMessage({ type: 'HOUSEHUNT_DISCARD', idealistaId: evt.data.idealistaId });
  });
})();
