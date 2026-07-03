// sync.js — House Hunt IFL Sync v1.8.19
// Handles Idealista Favorites List sync for all bases

// ── Price parsing (Italian Idealista formats) ───────────────────────────────
function parseItalianEuroAmount(raw) {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (/\d\.\d{3}/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
  if (/,/.test(s)) return parseInt(s.replace(/,/g, ''), 10) || 0;
  return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
}

function parseIdealistaPrice(text) {
  if (!text) return 0;
  const t = String(text).replace(/\s+/g, ' ').trim();
  let best = 0;
  const euroPatterns = [/€\s*([\d][\d.\s,]*)/g, /([\d][\d.\s,]*)\s*€/g];
  for (const re of euroPatterns) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const euros = parseItalianEuroAmount(m[1]);
      if (euros >= 30000 && euros <= 20000000) {
        const k = Math.round(euros / 1000);
        if (k > best) best = k;
      }
    }
  }
  if (!best) {
    const dm = t.match(/(\d{1,3}(?:\.\d{3})+)/);
    if (dm) {
      const euros = parseItalianEuroAmount(dm[1]);
      if (euros >= 30000 && euros <= 20000000) best = Math.round(euros / 1000);
    }
  }
  return best;
}

function scrapePriceFromCard(card) {
  if (!card) return 0;
  const priceSelectors = [
    '[class*="item-price"]', '[class*="Item-price"]', '[data-testid*="price"]',
    '.price', 'span.price', '[class*="price"]'
  ];
  for (const sel of priceSelectors) {
    for (const el of card.querySelectorAll(sel)) {
      const txt = el.textContent || '';
      if (/m[²2]|\/\s*m|sqm|mq|mese|month|affitto|rent/i.test(txt)) continue;
      const p = parseIdealistaPrice(txt);
      if (p > 0) return p;
    }
  }
  const sansSize = (card.textContent || '').replace(/\d+\s*m[²2]/gi, '');
  return parseIdealistaPrice(sansSize);
}

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

// ── Scrape IFL page (MUST be self-contained — injected via executeScript) ─────
function _scrapeIflPage() {
  window.scrollTo(0, document.body.scrollHeight);

  function parseItalianEuroAmount(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    if (/\d\.\d{3}/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
    if (/,/.test(s)) return parseInt(s.replace(/,/g, ''), 10) || 0;
    return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  }
  function parseIdealistaPrice(text) {
    if (!text) return 0;
    const t = String(text).replace(/\s+/g, ' ').trim();
    let best = 0;
    for (const re of [/€\s*([\d][\d.\s,]*)/g, /([\d][\d.\s,]*)\s*€/g]) {
      let m;
      while ((m = re.exec(t)) !== null) {
        const euros = parseItalianEuroAmount(m[1]);
        if (euros >= 30000 && euros <= 20000000) {
          const k = Math.round(euros / 1000);
          if (k > best) best = k;
        }
      }
    }
    if (!best) {
      const dm = t.match(/(\d{1,3}(?:\.\d{3})+)/);
      if (dm) {
        const euros = parseItalianEuroAmount(dm[1]);
        if (euros >= 30000 && euros <= 20000000) best = Math.round(euros / 1000);
      }
    }
    return best;
  }
  function scrapePriceFromCard(card) {
    if (!card) return 0;
    for (const sel of ['[class*="item-price"]', '[class*="Item-price"]', '[data-testid*="price"]', '.price', 'span.price', '[class*="price"]']) {
      for (const el of card.querySelectorAll(sel)) {
        const txt = el.textContent || '';
        if (/m[²2]|\/\s*m|sqm|mq|mese|month|affitto|rent/i.test(txt)) continue;
        const p = parseIdealistaPrice(txt);
        if (p > 0) return p;
      }
    }
    const sansSize = (card.textContent || '').replace(/\d+\s*m[²2]/gi, '');
    return parseIdealistaPrice(sansSize);
  }

  function parseIflListingTitle(rawTitle, cardText) {
    let title = (rawTitle || '').trim();
    const text = cardText || title;
    const provM = text.match(/\(([A-Z]{2})\)/);
    const prov = provM ? provM[1] : '';
    if (provM && title.includes(provM[0])) title = title.replace(provM[0], '').trim();

    let commune = '', town = '', name = title;
    const ci = title.lastIndexOf(',');
    if (ci >= 0) {
      town = title.slice(ci + 1).trim();
      const locHead = title.slice(0, ci).trim();
      const inM = locHead.match(/^(.+?)\s+in\s+(.+)$/i);
      if (inM) {
        name = inM[1].trim();
        commune = inM[2].trim();
      } else {
        const ci2 = locHead.lastIndexOf(',');
        if (ci2 >= 0) {
          name = locHead.slice(0, ci2).trim();
          commune = locHead.slice(ci2 + 1).trim();
        } else {
          commune = locHead;
          name = '';
        }
      }
    }
    if (!name) name = (rawTitle || '').split(',')[0].trim();
    return { name, commune, town, prov };
  }

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
                link.closest('[class*="item"]') ||
                link.parentElement;

    for (let i = 0; i < 5 && card && !card.querySelector('[class*="price"], .price'); i++) {
      card = card.parentElement;
    }

    const text = card ? card.textContent : link.textContent;

    const isDiscarded = text.toLowerCase().includes('discarded this listing') ||
                        text.toLowerCase().includes('scartato') ||
                        !!card?.querySelector('a[href*="recover"]') ||
                        !!card?.querySelector('[class*="recover"]') ||
                        !!card?.querySelector('[data-action*="recover"]');

    let title = '';
    const titleEl = card && (card.querySelector('a.item-link, h2 a, h3 a, [class*="title"] a, [class*="name"] a') || link);
    if (titleEl) title = titleEl.textContent.trim().slice(0, 120);

    const price = scrapePriceFromCard(card);

    const roomsM = text.match(/(\d+)\s*locali/i);
    const sizeM  = text.match(/(\d+)\s*m[²2]/i);

    const parsed = parseIflListingTitle(title, text);

    results.push({ id, price, title: parsed.name || title, name: parsed.name || title,
      commune: parsed.commune, town: parsed.town || parsed.commune,
      prov: parsed.prov,
      rooms: roomsM ? parseInt(roomsM[1]) : 0,
      size:  sizeM  ? parseInt(sizeM[1]) : 0,
      discarded: isDiscarded });
  }
  return results;
}

// ── Poll until listing links appear (injected helper — self-contained) ───────
function _countIflLinks() {
  return document.querySelectorAll('a[href*="/immobile/"]').length;
}

function _pageDiagnostics() {
  const url = location.href;
  const linkCount = document.querySelectorAll('a[href*="/immobile/"]').length;
  const bodySnippet = (document.body?.innerText || '').slice(0, 200).replace(/\s+/g, ' ').trim();
  const isLogin = /login|accedi|sign in/i.test(bodySnippet) || /login|accedi/i.test(url);
  return { url, linkCount, isLogin, bodySnippet };
}

function urlsRoughlyMatch(tabUrl, targetUrl) {
  try {
    const a = new URL(tabUrl);
    const b = new URL(targetUrl);
    return a.hostname === b.hostname &&
      a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') &&
      a.search === b.search;
  } catch (e) { return false; }
}

function buildIflUrl(base) {
  const tok = base.iflToken ? String(base.iflToken) : '';
  if (tok && /^\d+$/.test(tok)) {
    return `https://www.idealista.it/utente/preferiti/?favoritesListId=${tok}`;
  }
  if (tok) {
    return `https://www.idealista.it/join-favorites-list/${tok}`;
  }
  return 'https://www.idealista.it/utente/preferiti/';
}

async function waitForIflLinks(tabId, setStatus, maxMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: _countIflLinks
      });
      const n = r?.result || 0;
      if (n > 0) return n;
    } catch (e) { /* tab may still be loading */ }
    setStatus('Waiting for Idealista list to load…', 'loading');
    await sleep(1000);
  }
  return 0;
}

// ── Find & click IFL tab on favorites page (self-contained for executeScript) ─
function _clickListTab(listName) {
  const nameLower = (listName || '').toLowerCase().trim().slice(0, 12);
  if (nameLower.length < 4) return 'skipped:short-name';

  const roots = [
    document.querySelector('[class*="favorites"]'),
    document.querySelector('[class*="preferiti"]'),
    document.querySelector('main'),
    document.body
  ].filter(Boolean);

  for (const root of roots) {
    const tabs = root.querySelectorAll('[role="tab"], [class*="tab"] button, [class*="tab"] a, [class*="list"] button, [class*="list"] a');
    for (const el of tabs) {
      const txt = (el.textContent || '').toLowerCase().trim();
      if (txt.includes(nameLower)) {
        el.click();
        return 'clicked:' + el.textContent.trim().slice(0, 40);
      }
    }
  }
  return 'not-found';
}

// ── Main sync function ──────────────────────────────────────────────────────
async function syncBase(base, setStatus) {
  const token = await getApiToken();
  const apiBase = 'https://househunt.pages.dev/api';

  setStatus(`Syncing ${base.name} (${base.abbr}) — navigating to Idealista…`, 'loading');

  const allTabs = await new Promise(res => chrome.tabs.query({}, res));
  const iflUrl = buildIflUrl(base);
  let idealistaTab = allTabs.find(t => t.url && t.url.includes('idealista.it') && (t.url.includes('/preferiti') || t.url.includes('/utente/') || t.url.includes('join-favorites-list')));

  const needsNav = !idealistaTab || !idealistaTab.url || !urlsRoughlyMatch(idealistaTab.url, iflUrl);
  if (idealistaTab && needsNav) {
    await new Promise(res => chrome.tabs.update(idealistaTab.id, { url: iflUrl, active: true }, res));
  } else if (!idealistaTab) {
    idealistaTab = await new Promise(res => chrome.tabs.create({ url: iflUrl, active: true }, res));
  } else {
    await new Promise(res => chrome.tabs.update(idealistaTab.id, { active: true }, res));
  }

  try { await waitForTabLoad(idealistaTab.id); } catch (e) { setStatus('Page load timeout — is Idealista open?', 'err'); return; }
  await sleep(1500);

  const linkCount = await waitForIflLinks(idealistaTab.id, setStatus);
  if (!linkCount && base.iflName) {
    const [clickResult] = await chrome.scripting.executeScript({
      target: { tabId: idealistaTab.id },
      func: _clickListTab,
      args: [base.iflName]
    });
    setStatus('Finding list tab… ' + (clickResult?.result || ''), 'loading');
    await sleep(2000);
    await waitForIflLinks(idealistaTab.id, setStatus, 15000);
  }

  setStatus(`Scraping ${base.name} IFL properties…`, 'loading');
  let properties = [];
  try {
    const [scrapeResult] = await chrome.scripting.executeScript({
      target: { tabId: idealistaTab.id },
      func: _scrapeIflPage
    });
    properties = scrapeResult?.result || [];
  } catch (e) {
    setStatus('Scrape failed: ' + (e.message || 'script error'), 'err');
    return;
  }

  if (!properties.length) {
    let diag = {};
    try {
      const [d] = await chrome.scripting.executeScript({
        target: { tabId: idealistaTab.id },
        func: _pageDiagnostics
      });
      diag = d?.result || {};
    } catch (e) {}
    if (diag.isLogin) {
      setStatus('Idealista login required — sign in on the favorites page, then sync again.', 'err');
    } else {
      setStatus(`No properties found (${diag.linkCount ?? 0} links on page). Check IFL URL/token and list selection.`, 'err');
    }
    return;
  }

  const discardedOnIdealista = properties.filter(p => p.discarded);
  const activeProperties = properties.filter(p => !p.discarded);
  setStatus(`Found ${properties.length} properties (${discardedOnIdealista.length} discarded). Sending to SPA…`, 'loading');

  // Send ALL properties to SPA — IFL is source of truth; SPA updated to match
  const spaFrag = await getSpaUrlFrag();
  const spaTab = allTabs.find(t => t.url && t.url.includes(spaFrag));

  if (!spaTab) {
    setStatus(`SPA tab not found (looking for URL containing "${spaFrag}"). Open the SPA first.`, 'err');
    return;
  }

  const syncPayload = {
    props: properties,
    baseGrp: base.abbr,
    baseName: base.name,
    iflToken: base.iflToken,
    discardedCount: discardedOnIdealista.length,
    serverResult: null
  };

  // Server sync (KV store mirrors SPA IFL rules)
  let syncResult = { toAdd: [], markedDeleted: [], updated: [] };
  try {
    const r = await fetch(apiBase + '/ifl-sync', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseGrp: base.abbr, iflToken: base.iflToken, properties })
    });
    if (r.ok) syncResult = await r.json();
  } catch (e) { /* non-fatal — SPA update follows */ }

  syncPayload.serverResult = syncResult;
  await chrome.scripting.executeScript({
    target: { tabId: spaTab.id },
    func: payload => window.postMessage({ type: 'HOUSEHUNT_IFL_ADD', ...payload }, '*'),
    args: [syncPayload]
  });

  setStatus(`Sync complete for ${base.name}.`, 'ok');
  showSyncModal({
    base: base.name,
    abbr: base.abbr,
    total: properties.length,
    active: activeProperties.length,
    discarded: discardedOnIdealista.length,
    added: (syncResult.toAdd || []).length,
    updated: (syncResult.updated || []).length,
    markedDeleted: (syncResult.markedDeleted || []).length
  });
}

// ── Load bases from server ──────────────────────────────────────────────────
async function loadBases() {
  const token = await getApiToken();
  try {
    const r = await fetch('https://househunt.pages.dev/api/bases', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (r.ok) {
      const d = await r.json();
      return Array.isArray(d) ? d : (d.bases || []);
    }
  } catch (e) {}
  return [];
}
