/* ── State ─────────────────────────────────────────────────────────────────── */
let currentType = 'cards';
let priceChart  = null;
let suggestionOptions = [];
let activeSuggestionIndex = -1;
let suggestionDebounceTimer = null;
let suggestionFetchToken = 0;
let sourceHydrationToken = 0;
let detailChart = null;
let suggestionMode = 'filtered';
const SUGGESTION_DEBOUNCE_MS = 90;
const fullSuggestionCache = {
  cards: null,
  packs: null,
  boxes: null,
};
const fullSuggestionInFlight = {
  cards: null,
  packs: null,
  boxes: null,
};

/* ── DOM refs ─────────────────────────────────────────────────────────────── */
const searchForm    = document.getElementById('searchForm');
const searchInput   = document.getElementById('searchInput');
const boxDropdown   = document.getElementById('boxDropdown');
const suggestionsToggle = document.getElementById('suggestionsToggle');
const statusMsg     = document.getElementById('statusMsg');
const resultsSection = document.getElementById('resultsSection');
const resultsTitle  = document.getElementById('resultsTitle');
const resultsCount  = document.getElementById('resultsCount');
const resultsGrid   = document.getElementById('resultsGrid');
const chartSection  = document.getElementById('chartSection');
const chartTitle    = document.getElementById('chartTitle');
const chartSubtitle = document.getElementById('chartSubtitle');
const dealSection   = document.getElementById('dealSection');
const dealGrid      = document.getElementById('dealGrid');
const detailModal   = document.getElementById('detailModal');
const detailBackdrop = document.getElementById('detailBackdrop');
const detailClose   = document.getElementById('detailClose');
const detailTitle   = document.getElementById('detailTitle');
const detailSubtitle = document.getElementById('detailSubtitle');
const detailImage   = document.getElementById('detailImage');
const detailStats   = document.getElementById('detailStats');
const detailLinks   = document.getElementById('detailLinks');
const imageZoomModal = document.getElementById('imageZoomModal');
const imageZoomBackdrop = document.getElementById('imageZoomBackdrop');
const imageZoomClose = document.getElementById('imageZoomClose');
const imageZoomImg = document.getElementById('imageZoomImg');

if (detailModal) detailModal.hidden = true;
if (imageZoomModal) imageZoomModal.hidden = true;
prefetchTypeSuggestions(currentType);
prefetchAllSuggestions();

/* ── Tab switching ────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    currentType = btn.dataset.type;
    searchInput.placeholder = placeholderFor(currentType);
    searchInput.setAttribute('aria-expanded', 'false');
    hideSuggestionDropdown();
    prefetchTypeSuggestions(currentType);
    updateSuggestionDropdown();
    clearResults();
  });
});

function placeholderFor(type) {
  if (type === 'cards') return 'e.g. Charizard, Charizard #4, Pikachu 58/102…';
  if (type === 'packs') return 'e.g. Base Set, Scarlet & Violet, Obsidian Flames…';
  return 'e.g. Temporal Forces, Paldea Evolved…';
}

/* ── Form submit ──────────────────────────────────────────────────────────── */
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (activeSuggestionIndex >= 0 && suggestionOptions[activeSuggestionIndex]) {
    selectSuggestion(suggestionOptions[activeSuggestionIndex]);
  }
  const query = searchInput.value.trim();
  if (!query) return;
  hideSuggestionDropdown();
  await performSearch(query, currentType);
});

suggestionsToggle.addEventListener('click', async () => {
  const isOpen = !boxDropdown.hidden;
  if (isOpen && suggestionMode === 'full') {
    hideSuggestionDropdown();
    return;
  }

  suggestionMode = 'full';
  await updateSuggestionDropdown();
  searchInput.focus();
});

searchInput.addEventListener('input', () => {
  suggestionMode = 'filtered';

  // If suggestions are cached for this tab, filter instantly without debounce.
  if (fullSuggestionCache[currentType]) {
    updateSuggestionDropdown();
    return;
  }

  if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);
  suggestionDebounceTimer = setTimeout(() => {
    updateSuggestionDropdown();
  }, SUGGESTION_DEBOUNCE_MS);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) updateSuggestionDropdown();
});

searchInput.addEventListener('keydown', (e) => {
  if (boxDropdown.hidden || !suggestionOptions.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, suggestionOptions.length - 1);
    renderSuggestionDropdown();
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
    renderSuggestionDropdown();
    return;
  }

  if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
    e.preventDefault();
    selectSuggestion(suggestionOptions[activeSuggestionIndex]);
  }

  if (e.key === 'Escape') {
    hideSuggestionDropdown();
  }
});

document.addEventListener('click', (e) => {
  if (!searchForm.contains(e.target)) hideSuggestionDropdown();
});

if (detailBackdrop) detailBackdrop.addEventListener('click', closeDetailModal);
if (detailClose) detailClose.addEventListener('click', closeDetailModal);
if (detailImage) {
  detailImage.addEventListener('click', () => {
    if (!detailImage.src) return;
    openImageZoom(detailImage.src, detailImage.alt || 'Expanded image');
  });
}
if (imageZoomBackdrop) imageZoomBackdrop.addEventListener('click', closeImageZoom);
if (imageZoomClose) imageZoomClose.addEventListener('click', closeImageZoom);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && imageZoomModal && !imageZoomModal.hidden) {
    closeImageZoom();
    return;
  }
  if (e.key === 'Escape' && detailModal && !detailModal.hidden) closeDetailModal();
});

/* ── Core search ──────────────────────────────────────────────────────────── */
async function performSearch(query, type) {
  clearResults();
  showStatus('<span class="spinner"></span>Searching…', false);

  try {
    let data;
    if (type === 'cards') {
      const resp = await fetch(`/api/cards?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      data = await resp.json();
      renderCards(data.results || [], query);
    } else {
      // packs and boxes both search sets; boxes show multi-pack deals
      const resp = await fetch(`/api/sets?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      data = await resp.json();
      renderSets(data.results || [], query, type);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, true);
  }
}

/* ── Search autocomplete ──────────────────────────────────────────────────── */
async function updateSuggestionDropdown() {
  const query = searchInput.value.trim();
  if (!query && suggestionMode !== 'full') {
    hideSuggestionDropdown();
    return;
  }

  const token = ++suggestionFetchToken;
  const options = suggestionMode === 'full'
    ? await prefetchTypeSuggestions(currentType)
    : await getFastFilteredSuggestions(query, currentType);
  if (token !== suggestionFetchToken) return;

  suggestionOptions = options;
  activeSuggestionIndex = suggestionOptions.length ? 0 : -1;
  renderSuggestionDropdown();
}

async function getFastFilteredSuggestions(query, type) {
  const cached = fullSuggestionCache[type];
  if (cached && cached.length) {
    return filterOptions(cached, query, 10);
  }

  // Warm cache in the background so next keystrokes are instant.
  prefetchTypeSuggestions(type);
  return fetchSuggestionsRemote(query, type);
}

function filterOptions(options, query, max) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (options || []).slice(0, max);
  return (options || [])
    .filter((opt) => {
      const value = String(opt.value || '').toLowerCase();
      const hint = String(opt.hint || '').toLowerCase();
      return value.includes(q) || hint.includes(q);
    })
    .slice(0, max);
}

function prefetchTypeSuggestions(type) {
  if (fullSuggestionCache[type]) return Promise.resolve(fullSuggestionCache[type]);
  if (fullSuggestionInFlight[type]) return fullSuggestionInFlight[type];
  const p = fetchAllSuggestions(type).finally(() => {
    fullSuggestionInFlight[type] = null;
  });
  fullSuggestionInFlight[type] = p;
  return p;
}

function prefetchAllSuggestions() {
  const run = () => {
    prefetchTypeSuggestions('cards').catch(() => {});
    prefetchTypeSuggestions('packs').catch(() => {});
    prefetchTypeSuggestions('boxes').catch(() => {});
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 0);
  }
}

async function fetchAllSuggestions(type) {
  if (fullSuggestionCache[type]) return fullSuggestionCache[type];
  if (fullSuggestionInFlight[type]) return fullSuggestionInFlight[type];

  try {
    const resp = await fetch(`/api/suggestions?type=${encodeURIComponent(type)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    fullSuggestionCache[type] = (data.options || []).slice(0, 200);
    return fullSuggestionCache[type];
  } catch (_err) {
    return [];
  }
}

async function fetchSuggestionsRemote(query, type) {
  try {
    if (type === 'cards') {
      const resp = await fetch(`/api/cards?q=${encodeURIComponent(query)}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return mapUniqueOptions(
        data.results,
        (card) => card.name,
        (card) => (card.set ? card.set.name : ''),
        10
      );
    }

    const resp = await fetch(`/api/sets?q=${encodeURIComponent(query)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return mapUniqueOptions(
      data.results,
      (set) => set.name,
      (set) => set.series || '',
      10
    );
  } catch (_err) {
    return [];
  }
}

function mapUniqueOptions(list, getValue, getHint, max) {
  const seen = new Set();
  const out = [];

  for (const item of list || []) {
    const value = (getValue(item) || '').trim();
    const hint = (getHint(item) || '').trim();
    if (!value) continue;
    const key = `${value}|${hint}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, hint });
    if (max && out.length >= max) break;
  }

  return out;
}

function renderSuggestionDropdown() {
  if (!suggestionOptions.length) {
    hideSuggestionDropdown();
    return;
  }

  boxDropdown.innerHTML = suggestionOptions.map((opt, index) => `
    <button
      type="button"
      class="box-option${index === activeSuggestionIndex ? ' active' : ''}"
      data-index="${index}"
      role="option"
      aria-selected="${index === activeSuggestionIndex ? 'true' : 'false'}"
    >
      <span class="box-option-name">${escHtml(opt.value)}</span>
      <span class="box-option-series">${escHtml(opt.hint)}</span>
    </button>
  `).join('');

  boxDropdown.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
  suggestionsToggle.classList.add('open');
  suggestionsToggle.setAttribute('aria-expanded', 'true');

  boxDropdown.querySelectorAll('.box-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx) || !suggestionOptions[idx]) return;
      selectSuggestion(suggestionOptions[idx]);
    });
  });
}

function selectSuggestion(option) {
  searchInput.value = option.value;
  hideSuggestionDropdown();
  searchInput.focus();
}

function hideSuggestionDropdown() {
  suggestionOptions = [];
  activeSuggestionIndex = -1;
  suggestionMode = 'filtered';
  boxDropdown.hidden = true;
  boxDropdown.innerHTML = '';
  searchInput.setAttribute('aria-expanded', 'false');
  suggestionsToggle.classList.remove('open');
  suggestionsToggle.setAttribute('aria-expanded', 'false');
}

/* ── Render cards ─────────────────────────────────────────────────────────── */
function renderCards(cards, query) {
  hideStatus();
  resultsGrid.classList.remove('sets-grid');
  resultsGrid.classList.add('cards-grid');

  if (!cards.length) {
    showStatus(`No cards found for "${query}". Try a different name.`, false);
    return;
  }

  resultsTitle.textContent = 'Card Results';
  resultsCount.textContent = `${cards.length} result${cards.length !== 1 ? 's' : ''} found`;

  cards.forEach((card) => {
    const el = buildCardEl(card);
    resultsGrid.appendChild(el);
  });

  showSection(resultsSection);
  buildCardChart(cards, query);
  buildDealSummary(cards);
}

function buildCardEl(card) {
  const variants = Object.keys(card.prices);
  const primaryVariant = variants.includes('holofoil')
    ? 'holofoil'
    : variants.includes('normal')
    ? 'normal'
    : variants[0];
  const p = primaryVariant ? card.prices[primaryVariant] : null;

  const deal = p && p.market ? getDealRating(p.low, p.market) : null;

  const div = document.createElement('div');
  div.className = 'result-card';
  div.setAttribute('tabindex', '0');
  bindOpenHandlers(div, () => openCardDetail(card));
  div.innerHTML = `
    <div class="card-image-wrap">
      ${card.image
        ? `<img src="${card.image}" alt="${escHtml(card.name)}" loading="lazy" />`
        : `<span class="no-image">🃏</span>`}
    </div>
    <div class="card-body">
      <div class="card-name">${escHtml(card.name)}</div>
      <div class="card-meta">${card.set ? escHtml(card.set.name) : ''}</div>
      <span class="card-rarity">${escHtml(card.rarity)}</span>
      <div class="price-block">
        ${p ? `
        <div class="price-row"><span class="price-label">Market (${escHtml(primaryVariant)})</span><span class="price-value market">${fmt(p.market)}</span></div>
        <div class="price-row"><span class="price-label">Low</span><span class="price-value">${fmt(p.low)}</span></div>
        <div class="price-row"><span class="price-label">Mid</span><span class="price-value">${fmt(p.mid)}</span></div>
        <div class="price-row"><span class="price-label">High</span><span class="price-value">${fmt(p.high)}</span></div>
        ` : `<div class="price-row"><span class="price-label">Price data unavailable</span></div>`}
      </div>
      ${deal ? dealBadgeHtml(deal) : ''}
      ${buildProductLinksHtml({
        title: card.name,
        typeLabel: 'card',
        primaryUrl: card.url || '',
      })}
    </div>
  `;
  return div;
}

/* ── Render sets (packs / boxes) ──────────────────────────────────────────── */
function renderSets(sets, query, type) {
  hideStatus();
  resultsGrid.classList.remove('cards-grid');
  resultsGrid.classList.add('sets-grid');

  if (!sets.length) {
    showStatus(`No ${type} found for "${query}". Try a different name.`, false);
    return;
  }

  const isBox = type === 'boxes';
  resultsTitle.textContent = isBox ? 'Box Results' : 'Pack Results';
  resultsCount.textContent = `${sets.length} result${sets.length !== 1 ? 's' : ''} found`;

  sets.forEach((set) => {
    const el = buildSetEl(set, isBox);
    resultsGrid.appendChild(el);
  });

  hydrateSetSourcePrices();

  showSection(resultsSection);
  buildSetChart(sets, query, isBox);
  buildSetDealSummary(sets, isBox);
}

function buildSetEl(set, isBox) {
  const listedPrice = isBox ? estimateBoxPrice(set) : estimatePackPrice(set);
  const msrp        = isBox ? set.msrpBox : set.msrpPack;
  const deal        = getDealRating(listedPrice, msrp);

  const div = document.createElement('div');
  div.className = 'result-card';
  div.setAttribute('tabindex', '0');
  bindOpenHandlers(div, () => openSetDetail(set, isBox));
  div.innerHTML = `
    <div class="card-image-wrap">
      ${set.logo
        ? `<img src="${set.logo}" alt="${escHtml(set.name)} logo" loading="lazy" />`
        : `<span class="no-image">📦</span>`}
    </div>
    <div class="card-body">
      <div class="card-name">${escHtml(set.name)}</div>
      <div class="card-meta">${escHtml(set.series || '')} • ${set.totalCards} cards</div>
      <div class="card-meta">Released: ${set.releaseDate || 'N/A'}</div>
      <div class="price-block">
        <div class="price-row">
          <span class="price-label">${isBox ? 'Est. Box Price' : 'Est. Pack Price'}</span>
          <span class="price-value market">${listedPrice != null ? fmt(listedPrice) : 'N/A'}</span>
        </div>
        <div class="price-row">
          <span class="price-label">MSRP</span>
          <span class="price-value">${fmt(msrp)}</span>
        </div>
      </div>
      ${deal ? dealBadgeHtml(deal) : ''}
      ${buildSetSourcesHtml(set, isBox, listedPrice)}
    </div>
  `;
  return div;
}

function buildSetSourcesHtml(set, isBox, listedPrice) {
  const query = `${set.name} pokemon ${isBox ? 'booster box' : 'booster pack'}`;
  const encoded = encodeURIComponent(query);
  const tcgSearch = `https://www.tcgplayer.com/search/all/product?q=${encoded}`;
  const tcgLink = set.url || tcgSearch;

  return `
    <div class="source-list" data-query="${escAttr(query)}" data-kind="${isBox ? 'box' : 'pack'}">
      ${sourceRowHtml('TCGPlayer', tcgLink, listedPrice != null ? fmt(listedPrice) : 'Not found', listedPrice != null)}
      ${sourceRowHtml('eBay', `https://www.ebay.com/sch/i.html?_nkw=${encoded}`, 'Checking...', false, 'ebay')}
      ${sourceRowHtml('Amazon', `https://www.amazon.com/s?k=${encoded}`, 'Checking...', false, 'amazon')}
      ${sourceRowHtml('Walmart', `https://www.walmart.com/search?q=${encoded}`, 'Checking...', false, 'walmart')}
      ${sourceRowHtml('Target', `https://www.target.com/s?searchTerm=${encoded}`, 'Search', false)}
      ${sourceRowHtml('Best Buy', `https://www.bestbuy.com/site/searchpage.jsp?st=${encoded}`, 'Search', false)}
      ${sourceRowHtml('Facebook Marketplace', `https://www.facebook.com/marketplace/search/?query=${encoded}`, 'Search', false)}
      ${sourceRowHtml('Mercari', `https://www.mercari.com/search/?keyword=${encoded}`, 'Search', false)}
      ${sourceRowHtml('Google Shopping', `https://www.google.com/search?tbm=shop&q=${encoded}`, 'Search', false)}
    </div>
  `;
}

function sourceRowHtml(label, url, priceText, found, key) {
  const keyAttr = key ? ` data-source-price="${key}"` : '';
  const statusCls = found ? 'found' : 'missing';
  return `
    <div class="source-row">
      <a class="card-link source-link" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">Find on ${escHtml(label)} →</a>
      <span class="source-price ${statusCls}"${keyAttr}>${escHtml(priceText)}</span>
    </div>
  `;
}

async function hydrateSetSourcePrices() {
  const token = ++sourceHydrationToken;
  const lists = Array.from(document.querySelectorAll('#resultsGrid .source-list')).slice(0, 6);
  const modalList = Array.from(document.querySelectorAll('#detailLinks .source-list'));
  const allLists = lists.concat(modalList);

  await Promise.all(allLists.map(async (listEl) => {
    const query = listEl.dataset.query;
    const kind = listEl.dataset.kind || 'pack';
    if (!query) return;

    try {
      const resp = await fetch(`/api/market-prices?name=${encodeURIComponent(query)}&kind=${encodeURIComponent(kind)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (token !== sourceHydrationToken) return;

      (data.sources || []).forEach((src) => {
        const key = String(src.label || '').toLowerCase();
        const priceEl = listEl.querySelector(`[data-source-price="${key}"]`);
        if (!priceEl) return;
        if (src.found && src.price != null) {
          priceEl.textContent = fmt(src.price);
          priceEl.classList.remove('missing');
          priceEl.classList.add('found');
        } else {
          priceEl.textContent = 'Not found';
          priceEl.classList.remove('found');
          priceEl.classList.add('missing');
        }
      });
    } catch (_err) {
      // leave placeholders when lookup fails
    }
  }));
}

function openCardDetail(card) {
  const variants = Object.keys(card.prices || {});
  const pv = variants.includes('holofoil') ? 'holofoil' : variants.includes('normal') ? 'normal' : variants[0];
  const p = pv ? card.prices[pv] : null;

  detailTitle.textContent = card.name;
  detailSubtitle.textContent = `${card.set ? card.set.name : 'Unknown Set'} • ${card.rarity || 'Unknown rarity'}${pv ? ` • ${pv}` : ''}`;
  detailImage.src = card.imageLarge || card.image || '';
  detailImage.alt = card.name || 'Pokemon card';

  const delta = p && p.low != null && p.market != null ? p.low - p.market : null;
  const spread = p && p.high != null && p.low != null ? p.high - p.low : null;

  detailStats.innerHTML = [
    statTileHtml('Current Price (Low)', fmt(p ? p.low : null)),
    statTileHtml('Market Price', fmt(p ? p.market : null)),
    statTileHtml('Mid Price', fmt(p ? p.mid : null)),
    statTileHtml('High Price', fmt(p ? p.high : null)),
    statTileHtml('Price Change vs Market', delta == null ? 'N/A' : `${delta >= 0 ? '+' : ''}${fmt(delta)}`),
    statTileHtml('Low-High Range', spread == null ? 'N/A' : fmt(spread)),
  ].join('');

  detailLinks.innerHTML = `
    <div class="source-list">
      ${buildProductLinksHtml({ title: card.name, typeLabel: 'card', primaryUrl: card.url || '' })}
    </div>
  `;

  renderDetailChart({
    labels: ['Low', 'Market', 'Mid', 'High'],
    values: [p ? p.low : null, p ? p.market : null, p ? p.mid : null, p ? p.high : null],
    title: 'Card Price Breakdown',
  });

  openDetailModal();
}

function openSetDetail(set, isBox) {
  const listedPrice = isBox ? estimateBoxPrice(set) : estimatePackPrice(set);
  const msrp = isBox ? set.msrpBox : set.msrpPack;
  const change = listedPrice != null && msrp != null ? listedPrice - msrp : null;

  detailTitle.textContent = set.name;
  detailSubtitle.textContent = `${set.series || ''} • ${isBox ? 'Booster Box' : 'Booster Pack'} • ${set.totalCards} cards`;
  detailImage.src = set.logo || '';
  detailImage.alt = `${set.name} logo`;

  detailStats.innerHTML = [
    statTileHtml('Current Est. Price', fmt(listedPrice)),
    statTileHtml('Market / MSRP Ref', fmt(msrp)),
    statTileHtml('Price Change vs MSRP', change == null ? 'N/A' : `${change >= 0 ? '+' : ''}${fmt(change)}`),
    statTileHtml('Release Date', set.releaseDate || 'N/A'),
  ].join('');

  detailLinks.innerHTML = buildSetSourcesHtml(set, isBox, listedPrice);
  hydrateSetSourcePrices();

  renderDetailChart({
    labels: ['Current Est.', 'MSRP'],
    values: [listedPrice, msrp],
    title: `${isBox ? 'Box' : 'Pack'} Price vs MSRP`,
  });

  openDetailModal();
}

function statTileHtml(label, value) {
  return `
    <div class="detail-stat">
      <div class="detail-stat-label">${escHtml(label)}</div>
      <div class="detail-stat-value">${escHtml(value)}</div>
    </div>
  `;
}

function bindOpenHandlers(el, openFn) {
  el.addEventListener('click', openFn);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFn();
    }
  });
}

function renderDetailChart({ labels, values, title }) {
  const ctx = document.getElementById('detailChart').getContext('2d');
  if (detailChart) detailChart.destroy();

  detailChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: title,
          data: values,
          backgroundColor: ['rgba(46,204,113,.7)', 'rgba(247,208,44,.78)', 'rgba(59,76,202,.72)', 'rgba(231,76,60,.68)'],
          borderColor: ['#2ecc71', '#f7d02c', '#3b4cca', '#e74c3c'],
          borderWidth: 1,
        },
      ],
    },
    options: chartOptions('Price (USD)'),
  });
}

function openDetailModal() {
  if (!detailModal) return;
  detailModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetailModal() {
  if (!detailModal) return;
  detailModal.hidden = true;
  document.body.style.overflow = '';
  closeImageZoom();
  if (detailChart) {
    detailChart.destroy();
    detailChart = null;
  }
}

function openImageZoom(src, alt) {
  if (!imageZoomModal || !imageZoomImg) return;
  imageZoomImg.src = src;
  imageZoomImg.alt = alt || 'Expanded image';
  imageZoomModal.hidden = false;
}

function closeImageZoom() {
  if (!imageZoomModal || !imageZoomImg) return;
  imageZoomModal.hidden = true;
  imageZoomImg.src = '';
}

function buildProductLinksHtml({ title, typeLabel, primaryUrl }) {
  const query = `${title} pokemon ${typeLabel}`;
  const encoded = encodeURIComponent(query);

  const links = [];
  if (primaryUrl) {
    links.push(`<a class="card-link" href="${escAttr(primaryUrl)}" target="_blank" rel="noopener noreferrer">View on TCGPlayer →</a>`);
  } else {
    links.push(`<a class="card-link" href="https://www.tcgplayer.com/search/all/product?q=${encoded}" target="_blank" rel="noopener noreferrer">Find on TCGPlayer →</a>`);
  }

  const linkMap = [
    { label: 'Find on eBay', href: `https://www.ebay.com/sch/i.html?_nkw=${encoded}` },
    { label: 'Find on Amazon', href: `https://www.amazon.com/s?k=${encoded}` },
    { label: 'Find on Walmart', href: `https://www.walmart.com/search?q=${encoded}` },
    { label: 'Find on Target', href: `https://www.target.com/s?searchTerm=${encoded}` },
    { label: 'Find on Best Buy', href: `https://www.bestbuy.com/site/searchpage.jsp?st=${encoded}` },
    { label: 'Find on Facebook Marketplace', href: `https://www.facebook.com/marketplace/search/?query=${encoded}` },
    { label: 'Find on Mercari', href: `https://www.mercari.com/search/?keyword=${encoded}` },
    { label: 'Find with Google Shopping', href: `https://www.google.com/search?tbm=shop&q=${encoded}` },
    { label: 'Find with Google Web', href: `https://www.google.com/search?q=${encoded}` },
  ];

  linkMap.forEach((item) => {
    links.push(`<a class="card-link" href="${escAttr(item.href)}" target="_blank" rel="noopener noreferrer">${item.label} →</a>`);
  });

  return links.join('');
}

/* ── Price estimation helpers ─────────────────────────────────────────────── */
function estimatePackPrice(set) {
  if (set.packPrice && set.packPrice.market) return set.packPrice.market;
  // Reasonable secondary-market pack estimate based on set age
  if (!set.releaseDate) return null;
  const ageYears = (Date.now() - new Date(set.releaseDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
  if (ageYears < 1)   return 4.99;
  if (ageYears < 3)   return 7.50;
  if (ageYears < 6)   return 15.00;
  return 30.00;
}

function estimateBoxPrice(set) {
  const packPrice = estimatePackPrice(set);
  if (packPrice == null) return null;
  return +(packPrice * 36).toFixed(2);
}

/* ── Deal rating ──────────────────────────────────────────────────────────── */
function getDealRating(currentPrice, marketPrice) {
  if (currentPrice == null || marketPrice == null || marketPrice === 0) return null;
  const ratio = currentPrice / marketPrice;
  if (ratio <= 0.85)  return { label: '🔥 Great Deal',  cls: 'good',  pct: ratio };
  if (ratio <= 1.05)  return { label: '✅ Fair Price',   cls: 'ok',    pct: ratio };
  return               { label: '⚠️ Above Market',     cls: 'check', pct: ratio };
}

function dealBadgeHtml(deal) {
  if (!deal) return '';
  const pctStr = deal.pct != null ? ` (${Math.round(deal.pct * 100)}% of market)` : '';
  return `<span class="deal-badge ${deal.cls}">${deal.label}${pctStr}</span>`;
}

/* ── Charts ───────────────────────────────────────────────────────────────── */
function buildCardChart(cards, query) {
  // Use the primary variant market / low / high prices
  const labels = [];
  const marketData = [];
  const lowData    = [];
  const highData   = [];

  cards.forEach((card) => {
    const variants = Object.keys(card.prices);
    if (!variants.length) return;
    const pv = variants.includes('holofoil') ? 'holofoil' : variants.includes('normal') ? 'normal' : variants[0];
    const p  = card.prices[pv];
    if (!p || (p.market == null && p.low == null)) return;
    labels.push(card.name.length > 18 ? card.name.slice(0, 16) + '…' : card.name);
    marketData.push(p.market);
    lowData.push(p.low);
    highData.push(p.high);
  });

  if (!labels.length) return;

  chartTitle.textContent    = `Price Comparison – "${query}" Cards`;
  chartSubtitle.textContent = 'TCGPlayer market, low, and high prices (USD)';
  renderChart(labels, marketData, lowData, highData);
}

function buildSetChart(sets, query, isBox) {
  const labels      = [];
  const listedData  = [];
  const msrpData    = [];

  sets.forEach((set) => {
    const listed = isBox ? estimateBoxPrice(set) : estimatePackPrice(set);
    const msrp   = isBox ? set.msrpBox : set.msrpPack;
    if (listed == null) return;
    labels.push(set.name.length > 18 ? set.name.slice(0, 16) + '…' : set.name);
    listedData.push(listed);
    msrpData.push(msrp);
  });

  if (!labels.length) return;

  chartTitle.textContent    = `Price Comparison – "${query}" ${isBox ? 'Boxes' : 'Packs'}`;
  chartSubtitle.textContent = 'Estimated secondary market price vs MSRP (USD)';

  const ctx = document.getElementById('priceChart').getContext('2d');
  if (priceChart) priceChart.destroy();

  priceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: isBox ? 'Est. Box Price' : 'Est. Pack Price',
          data: listedData,
          backgroundColor: 'rgba(227,53,13,.75)',
          borderColor: '#e3350d',
          borderWidth: 1,
        },
        {
          label: 'MSRP',
          data: msrpData,
          backgroundColor: 'rgba(247,208,44,.75)',
          borderColor: '#f7d02c',
          borderWidth: 1,
        },
      ],
    },
    options: chartOptions('Price (USD)'),
  });

  showSection(chartSection);
}

function renderChart(labels, marketData, lowData, highData) {
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (priceChart) priceChart.destroy();

  priceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Market Price',
          data: marketData,
          backgroundColor: 'rgba(247,208,44,.8)',
          borderColor: '#f7d02c',
          borderWidth: 1,
        },
        {
          label: 'Low Price',
          data: lowData,
          backgroundColor: 'rgba(46,204,113,.7)',
          borderColor: '#2ecc71',
          borderWidth: 1,
        },
        {
          label: 'High Price',
          data: highData,
          backgroundColor: 'rgba(231,76,60,.6)',
          borderColor: '#e74c3c',
          borderWidth: 1,
        },
      ],
    },
    options: chartOptions('Price (USD)'),
  });

  showSection(chartSection);
}

function chartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#e0e0e0', font: { size: 13 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? '$' + ctx.parsed.y.toFixed(2) : 'N/A'}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#9ea3b0', font: { size: 11 } },
        grid:  { color: 'rgba(255,255,255,.06)' },
      },
      y: {
        title: { display: true, text: yLabel, color: '#9ea3b0' },
        ticks: {
          color: '#9ea3b0',
          callback: (v) => '$' + v.toFixed(2),
        },
        grid: { color: 'rgba(255,255,255,.06)' },
        beginAtZero: true,
      },
    },
  };
}

/* ── Deal summaries ───────────────────────────────────────────────────────── */
function buildDealSummary(cards) {
  const items = [];
  cards.forEach((card) => {
    const variants = Object.keys(card.prices);
    if (!variants.length) return;
    const pv = variants.includes('holofoil') ? 'holofoil' : variants.includes('normal') ? 'normal' : variants[0];
    const p  = card.prices[pv];
    if (!p || p.low == null || p.market == null) return;
    const deal = getDealRating(p.low, p.market);
    if (!deal) return;
    items.push({
      name: card.name,
      detail: `${card.set ? card.set.name : ''} • ${card.rarity}`,
      deal,
      low: p.low,
      market: p.market,
    });
  });

  if (!items.length) return;

  items.sort((a, b) => a.deal.pct - b.deal.pct); // best deals first

  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'deal-item';
    div.innerHTML = `
      <div class="deal-item-name">${escHtml(item.name)}</div>
      <div class="deal-item-detail">${escHtml(item.detail)}</div>
      <div class="deal-item-detail">Low: ${fmt(item.low)} | Market: ${fmt(item.market)}</div>
      <div class="deal-item-score ${item.deal.cls}">${item.deal.label} (${Math.round(item.deal.pct * 100)}% of market)</div>
    `;
    dealGrid.appendChild(div);
  });

  showSection(dealSection);
}

function buildSetDealSummary(sets, isBox) {
  const items = [];
  sets.forEach((set) => {
    const listed = isBox ? estimateBoxPrice(set) : estimatePackPrice(set);
    const msrp   = isBox ? set.msrpBox : set.msrpPack;
    if (listed == null || msrp == null) return;
    const deal = getDealRating(listed, msrp);
    if (!deal) return;
    items.push({ name: set.name, detail: `${set.series || ''} • ${set.totalCards} cards`, deal, listed, msrp });
  });

  if (!items.length) return;

  items.sort((a, b) => a.deal.pct - b.deal.pct);

  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'deal-item';
    div.innerHTML = `
      <div class="deal-item-name">${escHtml(item.name)}</div>
      <div class="deal-item-detail">${escHtml(item.detail)}</div>
      <div class="deal-item-detail">Est: ${fmt(item.listed)} | MSRP: ${fmt(item.msrp)}</div>
      <div class="deal-item-score ${item.deal.cls}">${item.deal.label} (${Math.round(item.deal.pct * 100)}% of MSRP)</div>
    `;
    dealGrid.appendChild(div);
  });

  showSection(dealSection);
}

/* ── Utility ──────────────────────────────────────────────────────────────── */
function fmt(val) {
  if (val == null) return 'N/A';
  return '$' + Number(val).toFixed(2);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  // Only allow http/https URLs
  if (!str) return '#';
  const trimmed = String(str).trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  return trimmed.replace(/"/g, '&quot;');
}

function showStatus(html, isError) {
  statusMsg.innerHTML = html;
  statusMsg.className = 'status-msg' + (isError ? ' error' : '');
  statusMsg.hidden = false;
}
function hideStatus() { statusMsg.hidden = true; }

function showSection(el) { el.hidden = false; }

function clearResults() {
  hideStatus();
  resultsGrid.innerHTML = '';
  dealGrid.innerHTML    = '';
  resultsSection.hidden = true;
  chartSection.hidden   = true;
  dealSection.hidden    = true;
  if (priceChart) { priceChart.destroy(); priceChart = null; }
}
