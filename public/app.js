/* ── State ─────────────────────────────────────────────────────────────────── */
let currentType = 'cards';
let priceChart  = null;

/* ── DOM refs ─────────────────────────────────────────────────────────────── */
const searchForm    = document.getElementById('searchForm');
const searchInput   = document.getElementById('searchInput');
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
    clearResults();
  });
});

function placeholderFor(type) {
  if (type === 'cards') return 'e.g. Charizard, Pikachu, Mewtwo…';
  if (type === 'packs') return 'e.g. Base Set, Scarlet & Violet, Obsidian Flames…';
  return 'e.g. Temporal Forces, Paldea Evolved…';
}

/* ── Form submit ──────────────────────────────────────────────────────────── */
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  await performSearch(query, currentType);
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

/* ── Render cards ─────────────────────────────────────────────────────────── */
function renderCards(cards, query) {
  hideStatus();

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
  buildDealSummary(cards, 'card');
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
      ${card.url ? `<a class="card-link" href="${escAttr(card.url)}" target="_blank" rel="noopener noreferrer">View on TCGPlayer →</a>` : ''}
    </div>
  `;
  return div;
}

/* ── Render sets (packs / boxes) ──────────────────────────────────────────── */
function renderSets(sets, query, type) {
  hideStatus();

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
      ${set.url ? `<a class="card-link" href="${escAttr(set.url)}" target="_blank" rel="noopener noreferrer">View on TCGPlayer →</a>` : ''}
    </div>
  `;
  return div;
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
