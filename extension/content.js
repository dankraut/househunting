// content.js — House Hunt Chrome Extension v1.8.19
// Runs on idealista.it/immobile/* and idealista.it/en/immobile/* pages

(function() {
  'use strict';
  if (document.getElementById('hh-extract-btn')) return;

  // ── Build floating button ──────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'hh-extract-btn';
  btn.innerHTML = '🏡 Send to Hunt';
  btn.style.cssText = [
    'position:fixed', 'bottom:80px', 'right:16px', 'z-index:2147483647',
    'background:#C0603A', 'color:#fff', 'border:none', 'border-radius:24px',
    'padding:10px 18px', 'font:600 13px system-ui,sans-serif', 'cursor:pointer',
    'box-shadow:0 4px 14px rgba(0,0,0,.35)', 'transition:background .15s',
    'white-space:nowrap', 'line-height:1'
  ].join(';');

  btn.onmouseenter = () => btn.style.background = '#9A4328';
  btn.onmouseleave = () => btn.style.background = '#C0603A';

  btn.addEventListener('click', handleClick);
  document.body.appendChild(btn);

  // ── Click handler ─────────────────────────────────────────────────────────
  function handleClick() {
    btn.textContent = '⏳ Extracting…';
    btn.disabled = true;

    const data = extractData();

    // Always send — even if only ID found, the SPA can use that
    chrome.storage.local.get(['spaUrl'], ({ spaUrl }) => {
      const fragment = (spaUrl && spaUrl.trim()) || 'househunt.pages.dev';

      // Send to background which will relay to SPA tab
      chrome.runtime.sendMessage(
        { type: 'SEND_TO_SPA', data, fragment },
        (response) => {
          if (chrome.runtime.lastError) {
            // Background inactive — store data and show instructions
            chrome.storage.local.set({ pendingData: data });
            showToast('⚠ Open the extension popup and click Send to complete transfer', '#E65100', 5000);
            btn.innerHTML = '🏡 Send to Hunt';
            btn.disabled = false;
            return;
          }
          if (response && response.ok) {
            const count = [data.broker, data.phone, data.location].filter(Boolean).length;
            showToast(`✓ Sent to House Hunt! ${count} field${count !== 1 ? 's' : ''} extracted`, '#2E7D32');
            btn.innerHTML = '✓ Sent!';
            setTimeout(() => { btn.innerHTML = '🏡 Send to Hunt'; btn.disabled = false; }, 3000);
          } else {
            const reason = (response && response.reason) || 'SPA tab not found';
            showToast(`Open househunt.pages.dev in a tab first (${reason})`, '#E65100', 5000);
            btn.innerHTML = '🏡 Send to Hunt';
            btn.disabled = false;
          }
        }
      );
    });
  }

  // ── Data extraction ─────────────────────────────────────────────────────────
  function extractData() {
    const result = {
      idealistaId: null, broker: null, phone: null, location: null,
      price: null, rooms: null, size: null, commune: null, town: null, prov: null, title: null, realtorUrl: null
    };
    const strip = s => s ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim() : s;

    // ID from URL
    const idMatch = location.pathname.match(/\/immobile\/(\d+)/);
    if (idMatch) result.idealistaId = idMatch[1];

    // ── Broker ─────────────────────────────────────────────────────────────
    const brokerSelectors = [
      '[class*="professional-name"]', '[class*="advertiser-name"]',
      '.professional-name', '.advertiser-name',
      '[data-testid="professional-name"]', '[class*="agency-name"]',
      '[class*="professional"] h2', '[class*="professional"] h3',
    ];
    for (const sel of brokerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = el.textContent.trim();
        if (txt.length > 2 && txt.length < 100) { result.broker = txt; break; }
      }
    }
    // Fallback: "Professionista" label
    if (!result.broker) {
      const bodyText = document.body.innerText;
      const pm = bodyText.match(/Professionista[\s\n]+([^\n]{3,80})/);
      if (pm) result.broker = pm[1].trim();
    }
    // Realtor URL + broker fallback via /pro/ /agency/ links
    for (const a of document.querySelectorAll('a[href*="/pro/"], a[href*="/agency/"]')) {
      const href = a.href;
      if (href && /idealista\.it\/(en\/)?(pro|agency)\//i.test(href)) {
        result.realtorUrl = href.split('?')[0];
        if (!result.broker) {
          const txt = a.textContent.trim();
          if (txt.length > 2 && txt.length < 100 && !txt.includes('http')) result.broker = txt;
        }
        break;
      }
    }

    // ── Phone ──────────────────────────────────────────────────────────────
    const telLink = document.querySelector('a[href^="tel:"]');
    if (telLink) {
      result.phone = (telLink.href.replace('tel:', '') || telLink.textContent).trim();
    }

    // ── GPS ──────────────────────────────────────────────────────────────────
    // JSON-LD
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const obj = JSON.parse(s.textContent);
        const geo = obj.geo || obj?.location?.geo;
        if (geo && geo.latitude && geo.longitude) {
          result.location = `${geo.latitude},${geo.longitude}`; break;
        }
      } catch(e) {}
    }
    // Meta tags
    if (!result.location) {
      const lat = document.querySelector('meta[property="place:location:latitude"]')?.content;
      const lng = document.querySelector('meta[property="place:location:longitude"]')?.content;
      if (lat && lng) result.location = `${lat},${lng}`;
    }
    // Inline scripts
    if (!result.location) {
      for (const s of document.querySelectorAll('script:not([src])')) {
        const t = s.textContent;
        let m = t.match(/"latitude"\s*:\s*([\d.]+).*?"longitude"\s*:\s*([\d.]+)/s);
        if (!m) m = t.match(/lat[itude]*["']?\s*[=:]\s*([\d.]+).*?lng|lon[gitude]*["']?\s*[=:]\s*([\d.]+)/s);
        if (m && m[1] && m[2]) { result.location = `${m[1]},${m[2]}`; break; }
      }
    }

    // ── Price ──────────────────────────────────────────────────────────────
    function parseItalianEuroAmount(raw) {
      if (!raw) return 0;
      const s = String(raw).trim();
      if (/\d\.\d{3}/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
      if (/,/.test(s)) return parseInt(s.replace(/,/g, ''), 10) || 0;
      return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
    }
    function parseItalianPrice(txt) {
      if (!txt) return null;
      const t = String(txt).replace(/\d+\s*m[²2]/gi, '');
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
    // Try price-specific elements first
    for (const sel of ['[class*="price-header"]','[class*="item-price"]','[class*="Price"]','.price','h2.price','[class*="price"]']) {
      const el = document.querySelector(sel);
      if (el && !/m[²2]|\/\s*m|sqm|mq/i.test(el.textContent)) {
        const p = parseItalianPrice(el.textContent);
        if (p) { result.price = p; break; }
      }
    }
    if (!result.price) {
      const p = parseItalianPrice(document.body.innerText);
      if (p) result.price = p;
    }

    // ── Rooms / size ───────────────────────────────────────────────────────────
    const bodyText = document.body.innerText;
    const roomM = bodyText.match(/(\d+)\s*(?:locali|rooms|vani|bagni)/i);
    if (roomM) result.rooms = parseInt(roomM[1]);
    const sizeM = bodyText.match(/(\d+)\s*m[²2]/i);
    if (sizeM) result.size = parseInt(sizeM[1]);

    // ── Commune / Town / province ──────────────────────────────────────────────
    // Idealista title-minor shows "Comune, Town" or just "Town"
    // Rule: if comma present → before = Comune, after = Town; no comma → all = Town
    function parseLocaleLine(txt) {
      const ci = txt.indexOf(',');
      if (ci >= 0) {
        return { commune: txt.slice(0, ci).trim(), town: txt.slice(ci + 1).trim() };
      }
      return { commune: null, town: txt.trim() };
    }

    const titleMinor = document.querySelector('.main-info__title-minor,[class*="title-minor"]');
    if (titleMinor) {
      const parsed = parseLocaleLine(titleMinor.textContent.trim());
      result.commune = parsed.commune;
      result.town = parsed.town;
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
        const parsed = parseLocaleLine(subtitle.textContent.trim());
        result.commune = result.commune || parsed.commune;
        result.town = parsed.town;
      }
    }
    const provM = bodyText.match(/\(([A-Z]{2})\)/);
    if (provM) result.prov = provM[1];

    result.title = document.querySelector('h1')?.textContent?.trim()
      || document.title.replace(/\s*(—|-|\|).*$/, '').split(',')[0].trim();

    if (result.broker) {
      result.broker = result.broker
        .replace(/^Professional advertiser\s*/i, '')
        .replace(/^Professionista\s*/i, '')
        .replace(/^Advertiser\s*/i, '')
        .replace(/^Inserzionista\s*/i, '')
        .trim();
      if (!result.broker) result.broker = null;
    }

    result.broker  = strip(result.broker);
    result.commune = strip(result.commune);
    result.town    = strip(result.town);
    result.prov    = strip(result.prov);
    result.title   = strip(result.title);

    if (result.location) result.gps = result.location;
    return result;
  }

  // ── Toast ────────────
// ── Auto-discard: check pending queue on page load ──────────────────────────
(function checkPendingDiscard() {
  const idMatch = location.pathname.match(/\/immobile\/(\d+)/);
  if (!idMatch) return;
  const pageId = idMatch[1];

  chrome.storage.local.get({ pendingDiscards: [] }, ({ pendingDiscards }) => {
    if (!pendingDiscards.includes(pageId)) return;

    // Wait for page to render, then click Discard
    const tryDiscard = (attempts = 0) => {
      const btn = [...document.querySelectorAll('button, a')]
        .find(el => /^discard$|^scarta$/i.test(el.textContent.trim()));
      if (btn) {
        btn.click();
        // Remove from queue
        chrome.storage.local.get({ pendingDiscards: [] }, ({ pendingDiscards: q }) => {
          chrome.storage.local.set({ pendingDiscards: q.filter(id => id !== pageId) });
        });
        showToast('✓ Discarded on Idealista', '#2E7D32', 3000);
      } else if (attempts < 12) {
        setTimeout(() => tryDiscard(attempts + 1), 800);
      }
    };

    setTimeout(() => tryDiscard(), 2000);
  });
})();
