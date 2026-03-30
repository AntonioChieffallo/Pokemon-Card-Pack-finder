/**
 * Basic unit tests for server helper logic.
 * Run with: node tests/server.test.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ── extractCardPrices ───────────────────────────────────────────────────────
{
  console.log('\n[extractCardPrices]');

  // replicate the function inline for unit testing without starting the server
  function extractCardPrices(card) {
    if (!card.tcgplayer || !card.tcgplayer.prices) return {};
    const raw = card.tcgplayer.prices;
    const result = {};
    for (const variant of Object.keys(raw)) {
      const p = raw[variant];
      result[variant] = {
        low: p.low || null,
        mid: p.mid || null,
        high: p.high || null,
        market: p.market || null,
        directLow: p.directLow || null,
      };
    }
    return result;
  }

  const card = {
    tcgplayer: {
      prices: {
        holofoil: { low: 1.00, mid: 2.50, high: 5.00, market: 2.00 },
        normal:   { low: 0.50, mid: 1.00, high: 2.00, market: 0.75 },
      },
    },
  };

  const prices = extractCardPrices(card);
  assert(prices.holofoil !== undefined, 'holofoil variant present');
  assert(prices.holofoil.market === 2.00, 'holofoil market price correct');
  assert(prices.normal.low === 0.50, 'normal low price correct');
  assert(Object.keys(extractCardPrices({})).length === 0, 'empty card returns {}');
}

// ── mapSet helper ────────────────────────────────────────────────────────────
{
  console.log('\n[mapSet]');

  function mapSet(set) {
    const packPrice = set.tcgplayer && set.tcgplayer.prices && set.tcgplayer.prices.boosterPack
      ? set.tcgplayer.prices.boosterPack
      : null;
    const msrpPack = 4.99;
    const msrpBox  = 119.99;
    return {
      id: set.id,
      name: set.name,
      series: set.series,
      totalCards: set.total,
      releaseDate: set.releaseDate,
      logo: set.images ? set.images.logo : null,
      symbol: set.images ? set.images.symbol : null,
      url: set.tcgplayer ? set.tcgplayer.url : null,
      packPrice,
      msrpPack,
      msrpBox,
    };
  }

  const set = {
    id: 'sv3',
    name: 'Obsidian Flames',
    series: 'Scarlet & Violet',
    total: 230,
    releaseDate: '2023-08-11',
    images: { logo: 'https://images.pokemontcg.io/sv3/logo.png', symbol: 'https://images.pokemontcg.io/sv3/symbol.png' },
    tcgplayer: { url: 'https://www.tcgplayer.com/search/pokemon/obsidian-flames' },
  };

  const mapped = mapSet(set);
  assert(mapped.name === 'Obsidian Flames', 'set name preserved');
  assert(mapped.totalCards === 230, 'totalCards mapped from total');
  assert(mapped.msrpPack === 4.99, 'default MSRP pack set');
  assert(mapped.msrpBox  === 119.99, 'default MSRP box set');
  assert(mapped.packPrice === null, 'packPrice null when no TCGPlayer boosterPack data');
  assert(mapped.logo === 'https://images.pokemontcg.io/sv3/logo.png', 'logo mapped correctly');
}

// ── getDealRating logic (replicated from app.js) ─────────────────────────────
{
  console.log('\n[getDealRating]');

  function getDealRating(currentPrice, marketPrice) {
    if (currentPrice == null || marketPrice == null || marketPrice === 0) return null;
    const ratio = currentPrice / marketPrice;
    if (ratio <= 0.85)  return { label: '🔥 Great Deal',   cls: 'good',  pct: ratio };
    if (ratio <= 1.05)  return { label: '✅ Fair Price',    cls: 'ok',    pct: ratio };
    return               { label: '⚠️ Above Market',      cls: 'check', pct: ratio };
  }

  assert(getDealRating(null, 5) === null, 'null currentPrice returns null');
  assert(getDealRating(5, null) === null, 'null marketPrice returns null');
  assert(getDealRating(5, 0)   === null, 'zero marketPrice returns null');

  const great = getDealRating(0.80, 1.00);
  assert(great !== null && great.cls === 'good', 'price at 80% market = great deal');

  const fair = getDealRating(1.00, 1.00);
  assert(fair !== null && fair.cls === 'ok', 'price at market = fair');

  const high = getDealRating(1.20, 1.00);
  assert(high !== null && high.cls === 'check', 'price above market = check');
}

// ── escAttr (replicated from app.js) ─────────────────────────────────────────
{
  console.log('\n[escAttr URL validation]');

  function escAttr(str) {
    if (!str) return '#';
    const trimmed = String(str).trim();
    if (!/^https?:\/\//i.test(trimmed)) return '#';
    return trimmed.replace(/"/g, '&quot;');
  }

  assert(escAttr('https://tcgplayer.com') === 'https://tcgplayer.com', 'valid https URL passes');
  assert(escAttr('http://tcgplayer.com')  === 'http://tcgplayer.com',  'valid http URL passes');
  assert(escAttr('javascript:alert(1)')   === '#', 'javascript: URL blocked');
  assert(escAttr('data:text/html,<b>')    === '#', 'data: URL blocked');
  assert(escAttr(null)                    === '#', 'null URL returns #');
  assert(escAttr('')                      === '#', 'empty string returns #');
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
