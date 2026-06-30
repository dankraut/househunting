// sync.js — House Hunt IFL Sync v1.6.8
// Handles Idealista Favorites List sync for all bases

// ── Helpers ────────────────────────────────────────────────────────────────
function getApiToken() {
  return new Promise(res => chrome.storage.local.get('apiToken', d => res(d.apiToken || '')));
}
function getSpaUrlFrag() {
  return new Promise(res => chrome.storage.local.get('spaUrl', d => res(d.spaUrl || 'househunt.pages.dev')));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) { reject(new Error('Tab gone')); return; }
        if (tab.status === 'complete') { resolve(); return; }
        if (Date.now() - start > timeout) { reject(new Error('Timeout')); return; }
        setTimeout(check, 300);
      });
    }
    check();
  });
}

// ── Scrape IFL page ─────────────────────────────────────────────────────────
function _scrapeIflPage() {
  window.scrollTo(0, document.body.scrollHeight);

  const results = [];
  const seen = new Set();

  const links = document.querySelectorAll('a[href*="/immobile/"]');
  for (const link of links) {
    const m = link.href.match(/\/immobile\/(\d+)/);
    if (!m || seen.has(m[1])) continue;
    const id = m[1];
    seen.add(id);

    let card = link.closest('article') ||
                link.closest('[class*="item-info"]') ||
                link.closest('[class*="list-item"]') ||
                link.parentElement;

    for (let i = 0; i < 4 && card && !card.querySelector('[class*="price"]'); i++) {
      card = card.parentElement;
    }

    const text = card ? card.textContent : link.textContent;

    // Detect discarded state on the favorites list page
    const isDiscarded = text.toLowerCase().includes('discarded this listing') ||
                        text.toLowerCase().includes('scartato') ||
                        !!card?.querySelector('a[href*="recover"]') ||
                        !!card?.querySelector('[class*="recover"]') ||
                        !!card?.querySelector('[data-action*="recover"]');

    let title = '';
    const titleEl = card && (card.querySelector('a.item-link, h2 a, h3 a, [class*="title"] a, [class*="name"] a') || link);
    if (titleEl) title = titleEl.textContent.trim().slice(0, 120);

    let price = 0;
    const priceEl = card && card.querySelector('[class*="price"], .price');
    if (priceEl) {
      const pm = priceEl.textContent.replace(/\./g,'').match(/(\d{3,})/);
      if (pm) price = Math.round(parseInt(pm[1]) / 1000);
    }

    const roomsM = text.match(/(\d+)\s*locali/i);
    const sizeM  = text.match(/(\d+)\s*m[²2]/i);

    let town = '';
    const ci = title.lastIndexOf(',');
    if (ci >= 0) town = title.slice(ci + 1).trim();

    results.push({ id, price, title, town,
      rooms: roomsM ? parseInt(roomsM[1]) : 0,
      size:  sizeM  ? parseInt(sizeM[1]) : 0,
      discarded: isDiscarded });
  }
  return results;
}

// ── Find & click IFL tab on favorites page ──────────────────────────────────
function _clickListTab(listName) {
  const nameLower = (listName || '').toLowerCase().slice(0, 10);
  const candidates = document.querySelectorAll(
    '[class*="tab"] button, [class*="tab"] a, [class*="list"] button, [class*="list"] a, button, .tab'
  );
  for (const el of candidates) {
    if (el.textContent.toLowerCase().includes(nameLower) && nameLower.length > 3) {
      el.click(); return 'clicked:' + el.textContent.trim().slice(0, 40);
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.children.length === 0 && node.textContent.toLowerCase().includes(nameLower) && nameLower.length > 3) {
      const clickable = node.closest('button, a, [role="tab"]');
      if (clickable) { clickable.click(); return 'fallback:' + node.textContent.trim().slice(0, 40); }
    }
  }
  return 'not-found';
}

// ── Write-back: add note + unfavorite for each eliminated property ───────────
function _processWriteBack(ids) {
  return new Promise(resolve => {
    const success = [], failed = [], notFound = [];
    let i = 0;

    function next() {
      if (i >= ids.length) { resolve({ success, failed, notFound }); return; }
      const id = ids[i++];

      const link = document.querySelector(`a[href*="/immobile/${id}/"]`);
      if (!link) { notFound.push(id); next(); return; }

      let card = link.closest('article') || link.closest('[class*="item"]') || link.parentElement;
      for (let j = 0; j < 4 && card; j++) {
        if (card.querySelector('[class*="nota"], [class*="note"]') ||
            [...(card.querySelectorAll('a, button'))].some(el => el.textContent.toLowerCase().includes('nota'))) break;
        card = card.parentElement;
      }
      if (!card) { notFound.push(id); next(); return; }

      const noteTrigger =
        card.querySelector('[class*="nota"], [href*="nota"]') ||
        [...card.querySelectorAll('a, button, span[role="button"]')]
          .find(el => el.textContent.toLowerCase().includes('nota') || el.textContent.toLowerCase().includes('note'));

      if (!noteTrigger) { failed.push({ id, reason: 'no-note-btn' }); next(); return; }

      noteTrigger.click();

      setTimeout(() => {
        const textarea = card.querySelector('textarea') || document.querySelector('[class*="nota"] textarea, [class*="note"] textarea');
        if (!textarea) { failed.push({ id, reason: 'no-textarea' }); tryUnfavorite(id, card, next); return; }

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        if (nativeSetter) nativeSetter.call(textarea, 'Eliminated in SPA');
        else textarea.value = 'Eliminated in SPA';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        setTimeout(() => {
          const saveBtn = card.querySelector('button[type="submit"]') ||
            [...card.querySelectorAll('button')].find(b => /salva|save|ok|conferma/i.test(b.textContent));
          if (saveBtn) saveBtn.click();
          setTimeout(() => tryUnfavorite(id, card, next, success, failed), 600);
        }, 400);
      }, 700);
    }

    function tryUnfavorite(id, card, cb, ok, fail) {
      const heartBtn =
        card.querySelector('[class*="heart"], [class*="favorite"], [class*="like"], button[aria-label*="preferit"]') ||
        [...(card.querySelectorAll('button, a'))].find(el => el.textContent.includes('♡') || el.textContent.includes('♥'));
      if (heartBtn) {
        heartBtn.click();
        if (ok) ok.push(id); else failed.push({ id, reason: 'note-saved-heart-clicked' });
      } else {
        if (fail) fail.push({ id, reason: 'no-heart-btn' });
      }
      setTimeout(cb, 800);
    }

    next();
  });
}

// ── Main sync function ──────────────────────────────────────────────────────
async function syncBase(base, setStatus) {
  const token = await getApiToken();
  const apiBase = 'https://househunt.pages.dev/api';

  setStatus(`Syncing ${base.name} (${base.abbr}) — navigating to Idealista…`, 'loading');

  const allTabs = await new Promise(res => chrome.tabs.query({}, res));
  let idealistaTab = allTabs.find(t => t.url && t.url.includes('idealista.it') && (t.url.includes('/preferiti') || t.url.includes('/utente/')));

  if (idealistaTab) {
    const iflUrl = base.iflToken && /^\d+$/.test(String(base.iflToken))
      ? `https://www.idealista.it/en/utente/preferiti/?favoritesListId=${base.iflToken}`
      : 'https://www.idealista.it/en/utente/preferiti/';
    await new Promise(res => chrome.tabs.update(idealistaTab.id, { url: iflUrl, active: true }, res));
  } else {
    const iflUrl = base.iflToken && /^\d+$/.test(String(base.iflToken))
      ? `https://www.idealista.it/en/utente/preferiti/?favoritesListId=${base.iflToken}`
      : 'https://www.idealista.it/en/utente/preferiti/';
    idealistaTab = await new Promise(res => chrome.tabs.create({ url: iflUrl, active: true }, res));
  }

  try { await waitForTabLoad(idealistaTab.id); } catch (e) { setStatus('Page load timeout — is Idealista open?', 'err'); return; }
  await sleep(2000);

  if (base.iflName) {
    const [clickResult] = await chrome.scripting.executeScript({
      target: { tabId: idealistaTab.id },
      func: _clickListTab,
      args: [base.iflName]
    });
    setStatus('Finding list tab… ' + (clickResult.result || ''), 'loading');
    await sleep(1500);
  }

  setStatus(`Scraping ${base.name} IFL properties…`, 'loading');
  const [scrapeResult] = await chrome.scripting.executeScript({
    target: { tabId: idealistaTab.id },
    func: _scrapeIflPage
  });
  const properties = scrapeResult.result || [];

  if (!properties.length) {
    setStatus('No properties found on page. Make sure you are logged in and the right list is selected.', 'err');
    return;
  }

  const discardedOnIdealista = properties.filter(p => p.discarded);
  const activeProperties = properties.filter(p => !p.discarded);
  setStatus(`Found ${properties.length} properties (${discardedOnIdealista.length} discarded). Sending to SPA…`, 'loading');

  // Send ALL properties to SPA — IFL_ADD handler updates existing, adds new, marks missing as Deleted
  const spaFrag = await getSpaUrlFrag();
  const spaTab = allTabs.find(t => t.url && t.url.includes(spaFrag));

  if (!spaTab) {
    setStatus(`SPA tab not found (looking for URL containing "${spaFrag}"). Open the SPA first.`, 'err');
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: spaTab.id },
    func: payload => window.postMessage({ type: 'HOUSEHUNT_IFL_ADD', ...payload }, '*'),
    args: [{ props: properties, baseGrp: base.abbr, iflToken: base.iflToken }]
  });

  // Server sync (for write-back tracking)
  let syncResult = { toAdd: [], markedDeleted: [], updated: [], writeBackQueue: [] };
  try {
    const r = await fetch(apiBase + '/ifl-sync', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseGrp: base.abbr, iflToken: base.iflToken, properties })
    });
    if (r.ok) syncResult = await r.json();
  } catch (e) { /* non-fatal — SPA already updated */ }

  let writeBackNote = '';
  if (syncResult.writeBackQueue && syncResult.writeBackQueue.length > 0) {
    setStatus(`Writing back ${syncResult.writeBackQueue.length} eliminated items to Idealista…`, 'loading');
    const wbIds = syncResult.writeBackQueue.map(p => p.id);
    const [wbResult] = await chrome.scripting.executeScript({
      target: { tabId: idealistaTab.id },
      func: _processWriteBack,
      args: [wbIds]
    });
    const wb = wbResult.result || {};
    writeBackNote = `\nWrite-back: ${(wb.success||[]).length} ok · ${(wb.failed||[]).length} failed · ${(wb.notFound||[]).length} not found`;
  }

  showSyncModal({
    base: base.name,
    abbr: base.abbr,
    total: properties.length,
    discarded: discardedOnIdealista.length,
    writeBackNote
  });
}

// ── Load bases from server ──────────────────────────────────────────────────
async function loadBases() {
  const token = await getApiToken();
  try {
    const r = await fetch('https://househunt.pages.dev/api/bases', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (r.ok) return await r.json();
  } catch (e) {}
  return [];
}
