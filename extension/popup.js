// popup.js — House Hunt Chrome Extension v1.7.0
// MV3-compliant: no inline event handlers, all listeners via addEventListener

let extracted = null;
let currentTabId = null;
let _bases = [];

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-extract').addEventListener('click', doExtract);
  document.getElementById('btn-send').addEventListener('click', doSend);
  document.getElementById('spa-url-input').addEventListener('change', e => {
    chrome.storage.local.set({ spaUrl: e.target.value.trim() });
  });

  const { apiToken } = await chrome.storage.local.get('apiToken');
  const keyIndicator = document.getElementById('key-set-indicator');
  if (keyIndicator) keyIndicator.textContent = apiToken ? '● set' : 'not set';

  document.getElementById('sync-key-change-btn')?.addEventListener('click', () => {
    const form = document.getElementById('key-change-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  const keySaveBtn = document.getElementById('sync-key-save');
  if (keySaveBtn) keySaveBtn.addEventListener('click', async () => {
    const key = (document.getElementById('sync-key')?.value || '').trim();
    if (!key) return;
    await chrome.storage.local.set({ apiToken: key });
    const ind = document.getElementById('key-set-indicator');
    if (ind) ind.textContent = '● set';
    document.getElementById('key-change-form').style.display = 'none';
    document.getElementById('sync-key').value = '';
    keySaveBtn.textContent = 'Saved ✓';
    setTimeout(() => { keySaveBtn.textContent = 'Save'; }, 1500);
    initSyncTab();
  });

  document.getElementById('tab-extract-btn')?.addEventListener('click', () => switchTab('extract'));
  document.getElementById('tab-sync-btn')?.addEventListener('click', () => switchTab('sync'));
  document.getElementById('sync-modal-close')?.addEventListener('click', closeSyncModal);
  document.getElementById('sync-modal-x')?.addEventListener('click', closeSyncModal);
  initSyncTab();

  // Load bases for the extract-tab base selector
  try { _bases = await loadBases(); } catch(e) { _bases = []; }
  populateBaseSelector();

  const { spaUrl } = await chrome.storage.local.get('spaUrl');
  document.getElementById('spa-url-input').value = spaUrl || 'househunt.pages.dev';

  const allTabs = await chrome.tabs.query({});
  const tab = allTabs.find(t => t.url && /idealista\.it\/(en\/)?immobile\/\d+/.test(t.url));

  if (!tab) {
    document.getElementById('not-idealista').style.display = 'block';
    document.getElementById('main-ui').style.display = 'none';
    return;
  }

  currentTabId = tab.id;
  const m = tab.url.match(/immobile\/(\d+)/);
  if (m) setField('f-id', m[1]);
  setStatus('Listing found — click Extract.', 'idle');
});

// ── Extract ─────────────────────────────────────────────────────────────────────
async function doExtract() {
  const btn = document.getElementById('btn-extract');
  btn.disabled = true;
  setStatus('Extracting…', 'loading');

  const safetyTimer = setTimeout(() => {
    btn.disabled = false;
    setStatus('Timed out — reload the listing page and try again.', 'err');
  }, 15000);

  try {
    const allTabs = await chrome.tabs.query({});
    const tab = allTabs.find(t => t.url && /idealista\.it\/(en\/)?immobile\/\d+/.test(t.url));
    if (!tab) {
      clearTimeout(safetyTimer);
      setStatus('No Idealista listing tab open. Navigate to an idealista.it/immobile/… listing first.', 'err');
      btn.disabled = false;
      return;
    }
    currentTabId = tab.id;
    setStatus('Injecting extractor into page…', 'loading');

    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: extractFromPage,
    });
    clearTimeout(safetyTimer);

    const data = results?.[0]?.result;
    if (!data) {
      setStatus('Nothing returned — try reloading the listing page.', 'err');
      btn.disabled = false;
      return;
    }

    extracted = data;

    setField('f-id',     data.idealistaId || null);
    setField('f-name',   data.title       || null);
    setField('f-broker', data.broker      || null);
    setField('f-phone',  data.phone       || null);
    setField('f-loc',    data.location    || null);
    setField('f-town',   [data.town, data.prov ? `(${data.prov})` : null].filter(Boolean).join(' ') || null);
    setField('f-price',    data.price      ? formatPriceK(data.price)  : null);
    setField('f-rooms',    data.rooms      ? String(data.rooms)  : null);
    setField('f-size',     data.size       ? `${data.size} m²`  : null);
    setField('f-realtorUrl', data.realtorUrl || null);

    const found = [data.broker, data.phone, data.location, data.price, data.rooms, data.size, data.town, data.realtorUrl]
      .filter(Boolean).length;
    setStatus(
      found > 0
        ? `Extracted ${found} field${found > 1 ? 's' : ''}. Click Send to push to SPA.`
        : 'ID found. For phone: click "Vedi il telefono" on listing, then re-extract.',
      found > 0 ? 'ok' : 'loading'
    );
    document.getElementById('btn-send').style.display = 'block';
    if (_bases.length) {
      document.getElementById('base-selector-row').style.display = 'block';
    }

  } catch (err) {
    clearTimeout(safetyTimer);
    setStatus('Error: ' + (err.message||'unknown — check extension permissions'), 'err');
  }
  btn.disabled = false;
}

// ── Send to SPA ────────────────────────────────────────────────────────────────────
async function doSend() {
  if (!extracted) return;

  // Require base selection
  const grpSel = document.getElementById('f-base-sel');
  const grp = grpSel?.value || '';
  if (_bases.length && !grp) {
    setStatus('Please select a Base before sending.', 'err');
    return;
  }

  const spaFragment = document.getElementById('spa-url-input').value.trim() || 'househunt.pages.dev';
  chrome.storage.local.set({ spaUrl: spaFragment });
  setStatus('Looking for SPA tab…', 'loading');

  const allTabs = await chrome.tabs.query({});
  const spaTab = allTabs.find(t => t.url && t.url.includes(spaFragment));

  if (!spaTab) {
    setStatus(`Tab matching "${spaFragment}" not found. Open the SPA first.`, 'err');
    return;
  }

  const payload = { ...extracted, grp };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: spaTab.id },
      func: payload => { window.postMessage({ type: 'HOUSEHUNT_BROKER', ...payload }, '*'); },
      args: [payload],
    });
    setStatus('✓ Sent! Check the SPA tab.', 'ok');
    document.getElementById('btn-send').style.display = 'none';
    setTimeout(() => window.close(), 2000);
  } catch (err) {
    setStatus('Send failed: ' + err.message, 'err');
  }
}

// ── Sync result modal ──────────────────────────────────────────────────────────
function showSyncModal({ base, abbr, total, active, discarded, added, updated, markedDeleted, writeBackNote }) {
  const body = document.getElementById('sync-modal-body');
  const modal = document.getElementById('sync-modal');
  if (!body || !modal) return;
  body.textContent = [
    `Base: ${base} (${abbr})`,
    `Properties in IFL: ${total}${active != null ? ` (${active} active)` : ''}`,
    added ? `New in SPA: ${added}` : null,
    updated ? `Updated: ${updated}` : null,
    markedDeleted ? `Marked Deleted-Idealista: ${markedDeleted}` : null,
    discarded > 0 ? `Discarded on Idealista: ${discarded}` : null,
    writeBackNote || null,
  ].filter(Boolean).join('\n');
  modal.classList.add('visible');
}

function closeSyncModal() {
  document.getElementById('sync-modal')?.classList.remove('visible');
  const log = document.getElementById('sync-log');
  if (log) { log.style.display = 'none'; log.textContent = ''; }
}

// ── Base selector ──────────────────────────────────────────────────────────────
function populateBaseSelector() {
  const sel = document.getElementById('f-base-sel');
  if (!sel) return;
  sel.innerHTML = _bases.map(b => `<option value="${b.abbr}">${b.name} (${b.abbr})</option>`).join('');
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(name) {
  ['extract','sync'].forEach(t => {
    const pane = document.getElementById('tab-' + t);
    const btn  = document.getElementById('tab-' + t + '-btn');
    if (pane) pane.classList.toggle('active', t === name);
    if (btn)  btn.classList.toggle('active', t === name);
  });
}

// ── Sync tab ─────────────────────────────────────────────────────────────────────
async function initSyncTab() {
  const el = document.getElementById('sync-bases-list');
  if (!el) return;
  el.textContent = 'Loading bases…';

  const { apiToken } = await chrome.storage.local.get('apiToken');
  if (!apiToken) {
    el.innerHTML = '<span style="color:#C0392B">Enter your server key above first.</span>';
    return;
  }

  let bases = [];
  try { bases = await loadBases(); } catch (e) {}

  const iflBases = bases.filter(b => b.iflToken);
  if (!iflBases.length) {
    el.innerHTML = '<span style="color:#9A9088">No bases with IFL linked.<br>Go to SPA → Settings to add a base with an Idealista Favorites List URL.</span>';
    return;
  }

  el._syncBases = iflBases;
  el.innerHTML = iflBases.map((b, idx) => `
    <div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #E8E0D2">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${b.name}</div>
        <div style="font-size:10px;color:#9A9088">IFL: ${b.iflToken}${b.iflName ? ' · ' + b.iflName : ''}</div>
      </div>
      <button class="btn secondary" style="padding:5px 8px;font-size:11px;width:auto" data-base-idx="${idx}">🔄 Sync</button>
    </div>`).join('');
  el.querySelectorAll('[data-base-idx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const base = el._syncBases[parseInt(btn.dataset.baseIdx)];
      if (base) await startSync(base);
    });
  });
}

async function startSync(base) {
  const log = document.getElementById('sync-log');
  if (log) log.style.display = 'block';

  function setStatus(msg, type) {
    if (log) {
      log.style.color = type === 'err' ? '#C0392B' : type === 'ok' ? '#2E7D32' : '#5A5248';
      log.textContent = msg;
    }
  }

  try {
    await syncBase(base, setStatus);
  } catch (e) {
    setStatus('Sync error: ' + e.message, 'err');
  }
}

// ── Page scraper (injected into Idealista tab) ───────────────────────────
function extractFromPage() {
  const result = {
    idealistaId: null, broker: null, phone: null, location: null,
    price: null, rooms: null, size: null, town: null, prov: null, title: null, realtorUrl: null
  };
  const strip = s => s ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim() : s;

  const idMatch = location.pathname.match(/\/immobile\/(\d+)/);
  if (idMatch) result.idealistaId = idMatch[1];

  const selectors = [
    '[class*="professional-name"]', '[class*="advertiser-name"]',
    '.professional-name', '.advertiser-name',
    '[data-testid="professional-name"]', '[class*="agency-name"]',
    '.contact-info strong', '.advertiser h2', '.advertiser h3',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent.trim()) { result.broker = el.textContent.trim(); break; }
  }
  if (!result.broker) {
    const pm = document.body.innerText.match(/Professionista\s*[\n\r]+\s*([^\n\r]{3,60})/);
    if (pm) result.broker = pm[1].trim();
  }
  if (result.broker) {
    result.broker = result.broker
      .replace(/^Professional advertiser\s*/i, '')
      .replace(/^Professionista\s*/i, '')
      .replace(/^Advertiser\s*/i, '')
      .replace(/^Inserzionista\s*/i, '')
      .trim();
    if (!result.broker) result.broker = null;
  }
  for (const a of document.querySelectorAll('a[href*="/pro/"], a[href*="/agency/"]')) {
    const href = a.href;
    if (href && /idealista\.it\/(en\/)?(pro|agency)\//i.test(href)) {
      result.realtorUrl = href.split('?')[0];
      if (!result.broker) {
        const txt = a.textContent.trim();
        if (txt.length >= 3 && txt.length <= 80) result.broker = txt;
      }
      break;
    }
  }

  const tel = document.querySelector('a[href^="tel:"]');
  if (tel) result.phone = (tel.href.replace('tel:', '') || tel.textContent).trim();

  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const obj = JSON.parse(s.textContent);
      const geo = obj.geo || obj?.location?.geo;
      if (geo?.latitude && geo?.longitude) {
        result.location = `${geo.latitude},${geo.longitude}`; break;
      }
    } catch {}
  }
  if (!result.location) {
    const lat = document.querySelector('meta[property="place:location:latitude"]')?.content;
    const lng = document.querySelector('meta[property="place:location:longitude"]')?.content;
    if (lat && lng) result.location = `${lat},${lng}`;
  }
  if (!result.location) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/"latitude"\s*:\s*([\d.]+).*?"longitude"\s*:\s*([\d.]+)/s);
      if (m) { result.location = `${m[1]},${m[2]}`; break; }
    }
  }

  const priceEl = document.querySelector('[class*="price-header"],[class*="Price"],.price,h2.price,[class*="item-price"]');
  if (priceEl && !/m[²2]|\/\s*m|sqm|mq/i.test(priceEl.textContent)) {
    result.price = parseIdealistaPriceFromText(priceEl.textContent);
  }
  if (!result.price) result.price = parseIdealistaPriceFromText(document.body.innerText);

  function parseItalianEuroAmount(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    if (/\d\.\d{3}/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
    if (/,/.test(s)) return parseInt(s.replace(/,/g, ''), 10) || 0;
    return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  }
  function parseIdealistaPriceFromText(text) {
    if (!text) return null;
    const t = String(text).replace(/\d+\s*m[²2]/gi, '');
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
        if (euros >= 30000) best = Math.round(euros / 1000);
      }
    }
    return best > 0 ? best : null;
  }

  const bodyText = document.body.innerText;
  const roomM = bodyText.match(/(\d+)\s*(?:locali|rooms|vani)/i);
  if (roomM) result.rooms = parseInt(roomM[1]);
  const sizeM = bodyText.match(/(\d+)\s*m[²2]/i);
  if (sizeM) result.size = parseInt(sizeM[1]);

  const titleMinor = document.querySelector('.main-info__title-minor,[class*="title-minor"]');
  if (titleMinor) {
    const txt = titleMinor.textContent.trim();
    const ci = txt.lastIndexOf(',');
    result.town = ci >= 0 ? txt.slice(ci + 1).trim() : txt;
  }
  if (!result.town) {
    const breadcrumb = document.querySelector('[class*="breadcrumb"],[class*="Breadcrumb"]');
    if (breadcrumb) {
      const parts = breadcrumb.textContent.split(/[>\/\|]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) result.town = parts[parts.length - 1];
    }
  }
  if (!result.town) {
    const subtitle = document.querySelector('span[class*="location"],p[class*="location"],[class*="subtitle"]');
    if (subtitle) {
      const txt = subtitle.textContent.trim();
      const ci = txt.lastIndexOf(',');
      result.town = ci >= 0 ? txt.slice(ci + 1).trim() : txt;
    }
  }
  const provM = bodyText.match(/\(([A-Z]{2})\)/);
  if (provM) result.prov = provM[1];

  result.title = document.querySelector('h1')?.textContent?.trim()
    || document.title.replace(/\s*(—|-|\|).*$/, '').split(',')[0].trim();

  result.broker = strip(result.broker);
  result.town   = strip(result.town);
  result.prov   = strip(result.prov);
  result.title  = strip(result.title);

  if (result.location) result.gps = result.location;
  return result;
}

function formatPriceK(priceK) {
  if (!priceK) return null;
  return '€' + Math.round(priceK * 1000).toLocaleString('en-GB');
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────
function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value) {
    el.textContent = value;
    el.classList.remove('empty');
  } else {
    el.textContent = '—';
    el.classList.add('empty');
  }
}

function setStatus(text, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = 'status ' + (type || 'idle');
}
