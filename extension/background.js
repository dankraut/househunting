// background.js — House Hunt Extension service worker
// Stays alive long enough to relay messages from content → SPA tab

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SEND_TO_SPA') return false;

  const { data, fragment } = msg;
  const spaFragment = (fragment && fragment.trim()) || 'househunt.pages.dev';

  chrome.tabs.query({}, (tabs) => {
    // Find SPA tab — match by URL fragment
    const spaTab = tabs.find(t =>
      t.url && t.url.includes(spaFragment) && !t.url.includes('idealista')
    );

    if (!spaTab) {
      sendResponse({ ok: false, reason: `No tab matching "${spaFragment}" found` });
      return;
    }

    // Inject postMessage into the SPA tab
    chrome.scripting.executeScript({
      target: { tabId: spaTab.id },
      func: (payload) => {
        window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, '*');
      },
      args: [data],
    }).then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, reason: err.message });
    });
  });

  return true; // keep channel open for async response
});

// Also handle popup's pending data send
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SEND_PENDING') return false;
  // Retrieve stored pending data and send it
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
      }).then(() => {
        chrome.storage.local.remove('pendingData');
        sendResponse({ ok: true });
      }).catch(e => sendResponse({ ok: false, reason: e.message }));
    });
  });
  return true;
});
