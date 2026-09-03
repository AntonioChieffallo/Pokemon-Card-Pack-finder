<script>
  const tabs = [
    { id: 'cards', label: 'Cards' },
    { id: 'packcards', label: 'Pack Cards' },
    { id: 'packs', label: 'Packs' },
    { id: 'boxes', label: 'Boxes' },
  ];

  let currentType = 'cards';
  let query = '';
  let loading = false;
  let error = '';
  let resultMeta = '';
  let results = [];

  let allSuggestions = [];
  let visibleSuggestions = [];
  let suggestionsOpen = false;
  let activeSuggestionIndex = -1;
  let suggestionNavigated = false;

  let selectedItem = null;
  let marketSources = [];
  let marketLoading = false;
  let marketError = '';
  let sourceFetchToken = 0;

  let alertEmail = '';
  let alertItemName = '';
  let alertItemType = 'cards';
  let alertIncludeEbay = true;
  let alertEbayDealRatio = 0.75;
  let alertSubmitting = false;
  let alertLoading = false;
  let alertSubscriptions = [];
  let alertSuccess = '';
  let alertError = '';

  function endpointFor(type) {
    if (type === 'cards') return '/api/cards';
    if (type === 'packcards') return '/api/pack-cards';
    return '/api/sets';
  }

  function placeholderFor(type) {
    if (type === 'cards') return 'Charizard, Pikachu #58, Mew 53/165';
    if (type === 'packcards') return 'Obsidian Flames, Base Set, 151';
    if (type === 'packs') return 'Scarlet and Violet';
    return 'Temporal Forces booster box';
  }

  function formatPrice(value) {
    if (value == null || Number.isNaN(Number(value))) return 'N/A';
    return `$${Number(value).toFixed(2)}`;
  }

  function shoppingKindFor(type) {
    if (type === 'cards' || type === 'packcards') return 'card';
    return type === 'boxes' ? 'box' : 'pack';
  }

  function shoppingQueryFor(item, type) {
    const base = item?.name || '';
    if (type === 'boxes') return `${base} pokemon booster box`;
    if (type === 'packs' || type === 'packcards') return `${base} pokemon booster pack`;
    return `${base} pokemon card`;
  }

  function defaultMarketSources(item, type) {
    const query = shoppingQueryFor(item, type);
    const encoded = encodeURIComponent(query);
    const tcgPrice = marketPriceFor(item);

    return [
      {
        label: 'TCGPlayer',
        url: item.url || `https://www.tcgplayer.com/search/all/product?q=${encoded}`,
        found: tcgPrice != null,
        price: tcgPrice,
      },
      {
        label: 'eBay',
        url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
        found: false,
        price: null,
      },
      {
        label: 'Amazon',
        url: `https://www.amazon.com/s?k=${encoded}`,
        found: false,
        price: null,
      },
      {
        label: 'Walmart',
        url: `https://www.walmart.com/search?q=${encoded}`,
        found: false,
        price: null,
      },
    ];
  }

  async function loadMarketSources(item, type) {
    const token = ++sourceFetchToken;
    marketLoading = true;
    marketError = '';

    const defaults = defaultMarketSources(item, type);
    marketSources = defaults;

    try {
      const kind = shoppingKindFor(type);
      const response = await fetch(
        `/api/market-prices?name=${encodeURIComponent(item.name)}&kind=${encodeURIComponent(kind)}`
      );

      if (!response.ok) {
        throw new Error(`Price lookup failed (${response.status})`);
      }

      const data = await response.json();
      if (token !== sourceFetchToken) return;

      const byLabel = new Map((data.sources || []).map((source) => [String(source.label || '').toLowerCase(), source]));

      marketSources = defaults.map((source) => {
        const remote = byLabel.get(source.label.toLowerCase());
        if (!remote) return source;
        return {
          ...source,
          url: remote.url || source.url,
          found: Boolean(remote.found && remote.price != null),
          price: remote.price != null ? Number(remote.price) : source.price,
        };
      });
    } catch (_err) {
      if (token !== sourceFetchToken) return;
      marketError = 'Could not load live marketplace prices right now.';
    } finally {
      if (token === sourceFetchToken) {
        marketLoading = false;
      }
    }
  }

  function marketPriceFor(item) {
    if (item.packPrice != null) return Number(item.packPrice);
    if (!item.prices) return null;

    const preferred = ['holofoil', 'normal', 'reverseHolofoil'];
    for (const key of preferred) {
      if (item.prices[key] && typeof item.prices[key].market === 'number') {
        return item.prices[key].market;
      }
    }

    const variants = Object.values(item.prices);
    for (const variant of variants) {
      if (variant && typeof variant.market === 'number') {
        return variant.market;
      }
    }

    return null;
  }

  function lowPriceFor(item) {
    if (!item.prices) return null;
    const variants = Object.values(item.prices);
    for (const variant of variants) {
      if (variant && typeof variant.low === 'number') return variant.low;
    }
    return null;
  }

  function badgeFor(item) {
    if (currentType === 'cards' || currentType === 'packcards') {
      const market = marketPriceFor(item);
      const low = lowPriceFor(item);
      if (market == null || low == null || market === 0) return null;
      return badgeFromRatio(low / market, 'market');
    }

    const listed = marketPriceFor(item);
    const msrp = currentType === 'boxes' ? item.msrpBox : item.msrpPack;
    if (listed == null || msrp == null || msrp === 0) return null;
    return badgeFromRatio(listed / msrp, 'msrp');
  }

  function badgeFromRatio(ratio, mode) {
    if (ratio <= 0.85) {
      return { label: 'Great Deal', className: 'deal-good', detail: `${Math.round(ratio * 100)}% of ${mode}` };
    }
    if (ratio <= 1.05) {
      return { label: 'Fair Price', className: 'deal-ok', detail: `${Math.round(ratio * 100)}% of ${mode}` };
    }
    return { label: 'Above Market', className: 'deal-warn', detail: `${Math.round(ratio * 100)}% of ${mode}` };
  }

  function normalizeAlertItemType(type) {
    if (type === 'cards' || type === 'packcards' || type === 'packs' || type === 'boxes') {
      return type;
    }
    return 'cards';
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function resetAlertNotices() {
    alertSuccess = '';
    alertError = '';
  }

  function prefillAlertFromItem(item, type = currentType) {
    if (!item || !item.name) return;
    alertItemName = item.name;
    alertItemType = normalizeAlertItemType(type);
    resetAlertNotices();
  }

  async function loadAlertSubscriptions() {
    const email = String(alertEmail || '').trim();
    if (!isValidEmail(email)) {
      alertError = 'Enter a valid email to load your subscriptions.';
      alertSuccess = '';
      return;
    }

    alertLoading = true;
    resetAlertNotices();
    try {
      const response = await fetch(`/api/alerts/subscriptions?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to load subscriptions (${response.status})`);
      }

      alertSubscriptions = data.subscriptions || [];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('pokemon-alert-email', email);
      }
    } catch (err) {
      alertError = err.message || 'Failed to load subscriptions.';
    } finally {
      alertLoading = false;
    }
  }

  async function onAlertSubscribe(event) {
    event.preventDefault();
    const email = String(alertEmail || '').trim();
    const itemName = String(alertItemName || '').trim();

    resetAlertNotices();

    if (!isValidEmail(email)) {
      alertError = 'Please enter a valid email address.';
      return;
    }

    if (!itemName) {
      alertError = 'Please enter a card, pack, or box name to watch.';
      return;
    }

    if (!Number.isFinite(Number(alertEbayDealRatio)) || Number(alertEbayDealRatio) <= 0 || Number(alertEbayDealRatio) > 2) {
      alertError = 'eBay deal ratio must be between 0 and 2.';
      return;
    }

    alertSubmitting = true;
    try {
      const response = await fetch('/api/alerts/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          itemName,
          itemType: normalizeAlertItemType(alertItemType),
          includeEbay: Boolean(alertIncludeEbay),
          ebayDealRatio: Number(alertEbayDealRatio),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Subscription failed (${response.status})`);
      }

      alertSuccess = data.message || 'Subscription created.';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('pokemon-alert-email', email);
      }
      await loadAlertSubscriptions();
    } catch (err) {
      alertError = err.message || 'Subscription failed.';
    } finally {
      alertSubmitting = false;
    }
  }

  async function removeAlertSubscription(id) {
    resetAlertNotices();
    try {
      const response = await fetch(`/api/alerts/subscriptions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to remove subscription (${response.status})`);
      }

      alertSubscriptions = alertSubscriptions.filter((sub) => sub.id !== id);
      alertSuccess = 'Subscription removed.';
    } catch (err) {
      alertError = err.message || 'Failed to remove subscription.';
    }
  }

  async function loadSuggestions(type) {
    try {
      const response = await fetch(`/api/suggestions?type=${encodeURIComponent(type)}`);
      if (!response.ok) {
        allSuggestions = [];
        visibleSuggestions = [];
        return;
      }

      const data = await response.json();
      allSuggestions = data.options || [];
      refreshVisibleSuggestions();
    } catch (_err) {
      allSuggestions = [];
      visibleSuggestions = [];
    }
  }

  function refreshVisibleSuggestions() {
    const q = query.trim().toLowerCase();
    const source = allSuggestions || [];

    if (!q) {
      visibleSuggestions = source;
      activeSuggestionIndex = visibleSuggestions.length ? 0 : -1;
      return;
    }

    visibleSuggestions = source.filter((option) => {
      const value = String(option.value || '').toLowerCase();
      const hint = String(option.hint || '').toLowerCase();
      return value.includes(q) || hint.includes(q);
    });

    activeSuggestionIndex = visibleSuggestions.length
      ? Math.min(Math.max(activeSuggestionIndex, 0), visibleSuggestions.length - 1)
      : -1;
  }

  function selectSuggestion(option) {
    query = option.value;
    suggestionsOpen = false;
    activeSuggestionIndex = -1;
    suggestionNavigated = false;
  }

  function openSuggestions() {
    suggestionsOpen = true;
    if (visibleSuggestions.length && activeSuggestionIndex < 0) activeSuggestionIndex = 0;
  }

  function onSuggestionKeydown(event) {
    if (!suggestionsOpen || !visibleSuggestions.length) {
      if (event.key === 'ArrowDown') {
        suggestionsOpen = true;
        activeSuggestionIndex = 0;
        suggestionNavigated = true;
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, visibleSuggestions.length - 1);
      suggestionNavigated = true;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      suggestionNavigated = true;
      return;
    }

    if (event.key === 'Enter' && suggestionNavigated && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectSuggestion(visibleSuggestions[activeSuggestionIndex]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      suggestionsOpen = false;
      activeSuggestionIndex = -1;
      suggestionNavigated = false;
    }
  }

  async function setTab(type) {
    currentType = type;
    query = '';
    error = '';
    resultMeta = '';
    results = [];
    suggestionsOpen = false;
    activeSuggestionIndex = -1;
    suggestionNavigated = false;
  }

  async function onSearch(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    loading = true;
    error = '';
    resultMeta = '';
    results = [];
    suggestionsOpen = false;
    activeSuggestionIndex = -1;

    try {
      const endpoint = endpointFor(currentType);
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(trimmed)}`);

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = await response.json();
      results = data.results || [];

      if (currentType === 'packcards' && data.setName) {
        resultMeta = `Showing cards from ${data.setName}`;
      }

      if (results.length === 0) {
        error = 'No results found. Try another search term.';
      }
    } catch (err) {
      error = err.message || 'Search failed';
    } finally {
      loading = false;
    }
  }

  function openDetails(item) {
    selectedItem = item;
    loadMarketSources(item, currentType);
    prefillAlertFromItem(item, currentType);
  }

  function closeDetails() {
    selectedItem = null;
    marketSources = [];
    marketError = '';
    marketLoading = false;
  }

  $: refreshVisibleSuggestions();
  $: if (currentType) {
    loadSuggestions(currentType);
  }

  $: chartData = results
    .slice(0, 8)
    .map((item) => {
      if (currentType === 'cards' || currentType === 'packcards') {
        return {
          label: item.name,
          leftLabel: 'Low',
          leftValue: lowPriceFor(item),
          rightLabel: 'Market',
          rightValue: marketPriceFor(item),
        };
      }

      const listed = marketPriceFor(item);
      const msrp = currentType === 'boxes' ? item.msrpBox : item.msrpPack;
      return {
        label: item.name,
        leftLabel: 'Listed',
        leftValue: listed,
        rightLabel: 'MSRP',
        rightValue: msrp,
      };
    })
    .filter((row) => row.leftValue != null || row.rightValue != null);

  $: chartMax = Math.max(
    1,
    ...chartData.map((row) => Math.max(Number(row.leftValue || 0), Number(row.rightValue || 0)))
  );

  $: if (typeof window !== 'undefined' && !alertEmail) {
    const savedEmail = window.localStorage.getItem('pokemon-alert-email');
    if (savedEmail) alertEmail = savedEmail;
  }
</script>

<main>
  <header class="hero">
    <h1>Pokemon Card Pack Finder</h1>
    <p>Autocomplete, deal badges, quick comparison chart, and detail drill-down.</p>
  </header>

  <section class="search-card">
    <div class="tabs">
      {#each tabs as tab}
        <button
          type="button"
          class:active={tab.id === currentType}
          on:click={() => setTab(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <form on:submit={onSearch}>
      <div class="input-wrap">
        <input
          type="search"
          bind:value={query}
          placeholder={placeholderFor(currentType)}
          on:focus={() => (suggestionsOpen = true)}
          on:input={() => {
            suggestionsOpen = true;
            suggestionNavigated = false;
          }}
          on:keydown={onSuggestionKeydown}
          required
        />
        <button
          type="button"
          class="suggestions-toggle"
          aria-label="Show available options"
          aria-expanded={suggestionsOpen}
          on:click={openSuggestions}
        >
          <span class="chevron" aria-hidden="true"></span>
        </button>

        {#if suggestionsOpen && visibleSuggestions.length > 0}
          <div class="suggestions">
            {#each visibleSuggestions as suggestion}
              <button
                type="button"
                class="suggestion"
                class:active={activeSuggestionIndex >= 0 && visibleSuggestions[activeSuggestionIndex] === suggestion}
                on:mousedown|preventDefault
                on:click={() => selectSuggestion(suggestion)}
              >
                <span>{suggestion.value}</span>
                <small>{suggestion.hint}</small>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button type="submit" disabled={loading}>
        {#if loading}Searching...{:else}Search{/if}
      </button>
    </form>
  </section>

  <section class="alerts-card">
    <div class="alerts-header">
      <h2>Email Restock Alerts</h2>
      <p>Get notified when items come back online. eBay can be restricted to good deals only.</p>
    </div>

    <form class="alerts-form" on:submit={onAlertSubscribe}>
      <div class="alerts-grid">
        <label>
          <span>Email</span>
          <input
            type="email"
            bind:value={alertEmail}
            placeholder="you@example.com"
            required
          />
        </label>

        <label>
          <span>Item Name</span>
          <input
            type="text"
            bind:value={alertItemName}
            placeholder="Charizard, Obsidian Flames, Temporal Forces"
            required
          />
        </label>

        <label>
          <span>Item Type</span>
          <select bind:value={alertItemType}>
            <option value="cards">Cards</option>
            <option value="packcards">Pack Cards</option>
            <option value="packs">Packs</option>
            <option value="boxes">Boxes</option>
          </select>
        </label>

        <label>
          <span>eBay Deal Ratio</span>
          <input type="number" bind:value={alertEbayDealRatio} min="0.1" max="2" step="0.05" />
        </label>
      </div>

      <label class="checkbox">
        <input type="checkbox" bind:checked={alertIncludeEbay} />
        <span>Include eBay offers (only if they qualify by deal ratio)</span>
      </label>

      <div class="alerts-actions">
        <button type="submit" disabled={alertSubmitting}>
          {#if alertSubmitting}Subscribing...{:else}Subscribe{/if}
        </button>
        <button type="button" class="secondary" disabled={alertLoading} on:click={loadAlertSubscriptions}>
          {#if alertLoading}Loading...{:else}Load My Alerts{/if}
        </button>
      </div>
    </form>

    {#if alertSuccess}
      <p class="status ok">{alertSuccess}</p>
    {/if}
    {#if alertError}
      <p class="status error">{alertError}</p>
    {/if}

    {#if alertSubscriptions.length > 0}
      <ul class="alert-list">
        {#each alertSubscriptions as sub}
          <li>
            <div>
              <strong>{sub.itemName}</strong>
              <p>{sub.itemType} - eBay {sub.includeEbay ? 'on' : 'off'}</p>
            </div>
            <button type="button" class="danger" on:click={() => removeAlertSubscription(sub.id)}>Unsubscribe</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if error}
    <p class="status error">{error}</p>
  {/if}

  {#if resultMeta}
    <p class="status">{resultMeta}</p>
  {/if}

  {#if chartData.length > 0}
    <section class="chart">
      <h2>Price Snapshot</h2>
      <div class="chart-grid">
        {#each chartData as row}
          <article class="bar-card">
            <h3>{row.label}</h3>
            <div class="bar-row">
              <span>{row.leftLabel}</span>
              <div class="bar-track"><i style={`width:${Math.max(4, (Number(row.leftValue || 0) / chartMax) * 100)}%`}></i></div>
              <strong>{formatPrice(row.leftValue)}</strong>
            </div>
            <div class="bar-row">
              <span>{row.rightLabel}</span>
              <div class="bar-track alt"><i style={`width:${Math.max(4, (Number(row.rightValue || 0) / chartMax) * 100)}%`}></i></div>
              <strong>{formatPrice(row.rightValue)}</strong>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if results.length > 0}
    <section class="results">
      <h2>Results ({results.length})</h2>

      <div class="grid">
        {#each results as item}
          {@const deal = badgeFor(item)}
          <button type="button" class="card" on:click={() => openDetails(item)}>
            {#if item.image}
              <img src={item.image} alt={item.name} loading="lazy" />
            {:else if item.logo}
              <img src={item.logo} alt={item.name} loading="lazy" />
            {/if}
            <div class="content">
              <h3>{item.name}</h3>
              <p>{item.set?.name || item.series || 'Unknown Series'}</p>

              {#if currentType === 'cards' || currentType === 'packcards'}
                <p>Low: {formatPrice(lowPriceFor(item))}</p>
                <p>Market: {formatPrice(marketPriceFor(item))}</p>
              {:else}
                <p>Listed: {formatPrice(marketPriceFor(item))}</p>
                <p>MSRP: {formatPrice(currentType === 'boxes' ? item.msrpBox : item.msrpPack)}</p>
              {/if}

              {#if deal}
                <span class={`deal ${deal.className}`}>{deal.label} - {deal.detail}</span>
              {/if}

              {#if item.url}
                <p class="buy-inline">Buy on TCGPlayer: {formatPrice(marketPriceFor(item))}</p>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if selectedItem}
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-backdrop" type="button" aria-label="Close details" on:click={closeDetails}></button>
      <section class="modal-panel" role="document">
        <button class="close" type="button" on:click={closeDetails}>x</button>
        <h2>{selectedItem.name}</h2>
        <p>{selectedItem.set?.name || selectedItem.series || 'Unknown Series'}</p>

        {#if selectedItem.imageLarge || selectedItem.image || selectedItem.logo}
          <img class="detail-image" src={selectedItem.imageLarge || selectedItem.image || selectedItem.logo} alt={selectedItem.name} />
        {/if}

        <div class="detail-grid">
          <div>
            <small>Low</small>
            <strong>{formatPrice(lowPriceFor(selectedItem))}</strong>
          </div>
          <div>
            <small>Market / Listed</small>
            <strong>{formatPrice(marketPriceFor(selectedItem))}</strong>
          </div>
          <div>
            <small>MSRP Pack</small>
            <strong>{formatPrice(selectedItem.msrpPack)}</strong>
          </div>
          <div>
            <small>MSRP Box</small>
            <strong>{formatPrice(selectedItem.msrpBox)}</strong>
          </div>
        </div>

        <h3 class="source-title">Where to Buy</h3>
        {#if marketLoading}
          <p class="source-status">Checking live prices...</p>
        {/if}
        {#if marketError}
          <p class="source-status error">{marketError}</p>
        {/if}
        <ul class="source-list">
          {#each marketSources as source}
            <li>
              <a class="out-link" href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
              <span class:price-missing={!source.found}>{source.found ? formatPrice(source.price) : 'Price unavailable'}</span>
            </li>
          {/each}
        </ul>

        <div class="modal-alerts">
          <h3 class="source-title">Track this Item</h3>
          <p>Use the Email Restock Alerts section above. This item is prefilled for you.</p>
        </div>
      </section>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
    background:
      radial-gradient(circle at 20% 10%, rgba(250, 204, 21, 0.2), transparent 35%),
      radial-gradient(circle at 85% 0%, rgba(249, 115, 22, 0.28), transparent 30%),
      linear-gradient(180deg, #0a1220, #111827 50%, #151a2f);
    color: #edf2f7;
    min-height: 100vh;
  }

  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: 1rem;
  }

  .hero {
    text-align: center;
    padding: 2rem 0 1.1rem;
  }

  .hero h1 {
    margin: 0;
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    letter-spacing: 0.03em;
  }

  .hero p {
    opacity: 0.88;
  }

  .search-card,
  .alerts-card,
  .chart,
  .results {
    background: rgba(15, 23, 42, 0.88);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 14px;
    padding: 1rem;
    backdrop-filter: blur(2px);
  }

  .search-card {
    position: relative;
    z-index: 2;
  }

  .alerts-card {
    position: relative;
    z-index: 1;
  }

  .chart,
  .alerts-card,
  .results {
    margin-top: 1rem;
  }

  .alerts-header h2 {
    margin: 0;
  }

  .alerts-header p {
    margin: 0.3rem 0 0.8rem;
    color: #cbd5e1;
    font-size: 0.92rem;
  }

  .alerts-form {
    display: grid;
    gap: 0.7rem;
  }

  .alerts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.6rem;
  }

  .alerts-grid label,
  .alerts-form label {
    display: grid;
    gap: 0.35rem;
  }

  .alerts-grid span,
  .alerts-form span {
    font-size: 0.82rem;
    color: #cbd5e1;
  }

  select {
    width: 100%;
    border: 1px solid #4a5568;
    border-radius: 10px;
    background: #0b1220;
    color: #e2e8f0;
    padding: 0.7rem 0.9rem;
    box-sizing: border-box;
  }

  .checkbox {
    display: flex !important;
    align-items: center;
    gap: 0.45rem;
  }

  .checkbox input {
    width: auto;
    margin: 0;
  }

  .alerts-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .secondary {
    border: 1px solid rgba(148, 163, 184, 0.5);
    background: rgba(15, 23, 42, 0.8);
    color: #e2e8f0;
    font-weight: 600;
    padding: 0.72rem 1rem;
    border-radius: 10px;
    cursor: pointer;
  }

  .status.ok {
    color: #86efac;
  }

  .alert-list {
    list-style: none;
    margin: 0.8rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .alert-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.7rem;
    background: rgba(30, 41, 59, 0.62);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
  }

  .alert-list li strong {
    display: block;
  }

  .alert-list li p {
    margin: 0.15rem 0 0;
    color: #cbd5e1;
    font-size: 0.84rem;
  }

  .danger {
    border: 1px solid rgba(248, 113, 113, 0.55);
    background: rgba(127, 29, 29, 0.35);
    color: #fecaca;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    cursor: pointer;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .modal-alerts {
    margin-top: 0.9rem;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    padding-top: 0.7rem;
    color: #cbd5e1;
    font-size: 0.88rem;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.8rem;
  }

  .tabs button {
    border: 1px solid #4a5568;
    background: #111827;
    color: #e2e8f0;
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
  }

  .tabs button.active {
    background: #f6ad55;
    color: #1a202c;
    border-color: #f6ad55;
    font-weight: 700;
  }

  form {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }

  .input-wrap {
    position: relative;
    flex: 1;
  }

  input {
    width: 100%;
    border: 1px solid #4a5568;
    border-radius: 10px;
    background: #0b1220;
    color: #e2e8f0;
    padding: 0.7rem 0.9rem;
    box-sizing: border-box;
    padding-right: 2.8rem;
  }

  .suggestions-toggle {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #cbd5e1;
    cursor: pointer;
  }

  .suggestions-toggle:hover,
  .suggestions-toggle[aria-expanded='true'] {
    background: rgba(148, 163, 184, 0.14);
  }

  .chevron {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg) translateY(-2px);
    transition: transform 120ms ease;
  }

  .suggestions-toggle[aria-expanded='true'] .chevron {
    transform: rotate(225deg) translate(-1px, -1px);
  }

  .suggestions {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 0.35rem);
    z-index: 20;
    border: 1px solid #334155;
    border-radius: 10px;
    background: #0a1020;
    overflow: hidden;
    max-height: min(24rem, 60vh);
    overflow-y: auto;
  }

  .suggestion {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    border: none;
    background: transparent;
    color: #e2e8f0;
    text-align: left;
    cursor: pointer;
  }

  .suggestion:hover {
    background: rgba(148, 163, 184, 0.14);
  }

  .suggestion.active {
    background: rgba(250, 204, 21, 0.2);
  }

  .suggestion small {
    color: #94a3b8;
  }

  button[type='submit'] {
    border: none;
    background: linear-gradient(135deg, #f97316, #facc15);
    color: #111827;
    font-weight: 700;
    padding: 0.72rem 1rem;
    border-radius: 10px;
    cursor: pointer;
  }

  .status {
    margin-top: 1rem;
    opacity: 0.95;
  }

  .status.error {
    color: #fecaca;
  }

  .chart-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.7rem;
  }

  .bar-card {
    background: rgba(2, 6, 23, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    padding: 0.7rem;
  }

  .bar-card h3 {
    margin: 0 0 0.4rem;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 50px 1fr auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.3rem;
  }

  .bar-row span {
    color: #cbd5e1;
    font-size: 0.8rem;
  }

  .bar-track {
    height: 10px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.18);
  }

  .bar-track i {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #facc15, #fb923c);
  }

  .bar-track.alt i {
    background: linear-gradient(90deg, #60a5fa, #22d3ee);
  }

  .bar-row strong {
    font-size: 0.82rem;
  }

  .grid {
    display: grid;
    gap: 0.8rem;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .card {
    border: none;
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    color: inherit;
    text-align: left;
    padding: 0;
  }

  .card:focus {
    outline: 2px solid #facc15;
    outline-offset: 2px;
  }

  .card img {
    width: 100%;
    height: 220px;
    object-fit: contain;
    background: #0b1220;
  }

  .content {
    padding: 0.8rem;
  }

  .content h3 {
    margin: 0 0 0.4rem;
    font-size: 1rem;
  }

  .content p {
    margin: 0.24rem 0;
    font-size: 0.9rem;
    color: #cbd5e1;
  }

  .buy-inline {
    margin-top: 0.45rem;
    color: #7dd3fc;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .deal {
    display: inline-block;
    margin-top: 0.45rem;
    font-size: 0.78rem;
    border-radius: 999px;
    padding: 0.2rem 0.65rem;
    border: 1px solid transparent;
    font-weight: 700;
  }

  .deal-good {
    color: #86efac;
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.48);
  }

  .deal-ok {
    color: #fde68a;
    background: rgba(234, 179, 8, 0.2);
    border-color: rgba(234, 179, 8, 0.48);
  }

  .deal-warn {
    color: #fecaca;
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.48);
  }

  .modal {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1rem;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: rgba(2, 6, 23, 0.75);
    cursor: pointer;
  }

  .modal-panel {
    z-index: 1;
    width: min(720px, 100%);
    max-height: 90vh;
    overflow: auto;
    background: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 12px;
    padding: 1rem;
    position: relative;
  }

  .close {
    position: absolute;
    top: 0.55rem;
    right: 0.55rem;
    border: none;
    border-radius: 999px;
    width: 1.8rem;
    height: 1.8rem;
    cursor: pointer;
    background: rgba(148, 163, 184, 0.22);
    color: #fff;
    font-weight: 700;
  }

  .detail-image {
    width: 100%;
    max-height: 420px;
    object-fit: contain;
    background: #020617;
    border-radius: 10px;
    margin: 0.55rem 0;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.6rem;
  }

  .detail-grid div {
    background: rgba(30, 41, 59, 0.82);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 0.55rem;
  }

  .detail-grid small {
    color: #a8bbd1;
    display: block;
  }

  .detail-grid strong {
    display: block;
    margin-top: 0.2rem;
  }

  .out-link {
    display: inline-block;
    color: #7dd3fc;
    text-decoration: none;
  }

  .out-link:hover {
    text-decoration: underline;
  }

  .source-title {
    margin-top: 0.9rem;
    margin-bottom: 0.4rem;
    font-size: 1rem;
  }

  .source-status {
    margin: 0.2rem 0 0.45rem;
    color: #cbd5e1;
  }

  .source-status.error {
    color: #fecaca;
  }

  .source-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }

  .source-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    background: rgba(30, 41, 59, 0.62);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 0.45rem 0.55rem;
  }

  .source-list li span {
    font-weight: 700;
    color: #86efac;
    font-size: 0.86rem;
    white-space: nowrap;
  }

  .source-list li span.price-missing {
    color: #cbd5e1;
    font-weight: 500;
  }

  @media (max-width: 640px) {
    form {
      flex-direction: column;
    }

    button[type='submit'] {
      width: 100%;
    }
  }
</style>
