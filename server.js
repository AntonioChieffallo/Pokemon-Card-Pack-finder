const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMON_TCG_API_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-Api-Key'] = API_KEY;
  return headers;
}

function uniqueOptions(list, getValue, getHint) {
  const seen = new Set();
  return (list || [])
    .map((item) => ({
      value: getValue(item) || '',
      hint: getHint(item) || '',
    }))
    .filter((opt) => {
      const key = `${opt.value.toLowerCase()}|${opt.hint.toLowerCase()}`;
      if (!opt.value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildNameQuery(raw) {
  const tokens = String(raw || '')
    .trim()
    .replace(/["\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-z0-9-]/gi, ''))
    .filter(Boolean)
    .slice(0, 6);

  if (!tokens.length) return '';
  return tokens.map((t) => `name:*${t}*`).join(' AND ');
}

function buildCardQuery(raw) {
  const input = String(raw || '').trim().replace(/["\\]/g, ' ');
  if (!input) return '';

  let number = null;
  const hashMatch = input.match(/#\s*([a-z0-9-]+)/i);
  if (hashMatch) number = hashMatch[1];

  if (!number) {
    const fracMatch = input.match(/\b([0-9]{1,4}[a-z]?)\s*\/\s*[0-9]{1,4}\b/i);
    if (fracMatch) number = fracMatch[1];
  }

  if (!number) {
    const trailingNumMatch = input.match(/^(.*[a-z].*)\s+([0-9]{1,4}[a-z]?)$/i);
    if (trailingNumMatch) number = trailingNumMatch[2];
  }

  if (!number) {
    const onlyNumMatch = input.match(/^#?\s*([0-9]{1,4}[a-z]?)$/i);
    if (onlyNumMatch) number = onlyNumMatch[1];
  }

  const stripped = input
    .replace(/#\s*[a-z0-9-]+/ig, ' ')
    .replace(/\b[0-9]{1,4}[a-z]?\s*\/\s*[0-9]{1,4}\b/ig, ' ')
    .replace(/\s+[0-9]{1,4}[a-z]?\s*$/i, ' ');

  const nameTokens = stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-z0-9-]/gi, ''))
    .filter(Boolean)
    .slice(0, 6);

  const clauses = [];
  if (nameTokens.length) clauses.push(...nameTokens.map((t) => `name:*${t}*`));
  if (number) clauses.push(`number:${number}`);

  return clauses.join(' AND ');
}

function parseDollarAmount(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\s+/g, ' ');
  const m = cleaned.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (!m) return null;
  const val = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(val) ? val : null;
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  return response.data;
}

async function scrapeEbayPrice(query) {
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let price = null;

    $('.s-item__price').each((_i, el) => {
      if (price != null) return;
      const p = parseDollarAmount($(el).text());
      if (p != null) price = p;
    });

    return { label: 'eBay', url, found: price != null, price };
  } catch (_err) {
    return { label: 'eBay', url, found: false, price: null };
  }
}

async function scrapeAmazonPrice(query) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let price = null;

    $('span.a-offscreen').each((_i, el) => {
      if (price != null) return;
      const p = parseDollarAmount($(el).text());
      if (p != null) price = p;
    });

    return { label: 'Amazon', url, found: price != null, price };
  } catch (_err) {
    return { label: 'Amazon', url, found: false, price: null };
  }
}

async function scrapeWalmartPrice(query) {
  const url = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let price = null;

    $('[itemprop="price"]').each((_i, el) => {
      if (price != null) return;
      const content = $(el).attr('content');
      const p = content ? Number(content) : null;
      if (p != null && Number.isFinite(p)) price = p;
    });

    if (price == null) {
      const m = html.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{2})?)"?/i);
      if (m) price = Number(m[1]);
    }

    return { label: 'Walmart', url, found: price != null, price: price != null ? +price.toFixed(2) : null };
  } catch (_err) {
    return { label: 'Walmart', url, found: false, price: null };
  }
}

// Search cards by name
app.get('/api/cards', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  const cardQuery = buildCardQuery(q);
  if (!cardQuery) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const response = await axios.get(`${POKEMON_TCG_API}/cards`, {
      headers: buildHeaders(),
      params: {
        q: cardQuery,
        orderBy: '-set.releaseDate',
        pageSize: 10,
        select: 'id,name,number,set,images,tcgplayer,rarity,supertype,subtypes',
      },
    });

    const cards = (response.data.data || []).map((card) => mapCard(card));

    res.json({ results: cards, total: response.data.totalCount || cards.length });
  } catch (err) {
    console.error('Cards API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch card data' });
  }
});

// Search cards for a set query (pack cards)
app.get('/api/pack-cards', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  const nameQuery = buildNameQuery(q);
  if (!nameQuery) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const setResponse = await axios.get(`${POKEMON_TCG_API}/sets`, {
      headers: buildHeaders(),
      params: {
        q: nameQuery,
        orderBy: '-releaseDate',
        pageSize: 15,
        select: 'id,name,series,releaseDate',
      },
    });

    const selectedSet = pickBestSetMatch(setResponse.data.data || [], q);
    if (!selectedSet) {
      return res.json({ results: [], total: 0, setName: null, setId: null, setSeries: null });
    }

    const cardsResponse = await axios.get(`${POKEMON_TCG_API}/cards`, {
      headers: buildHeaders(),
      params: {
        q: `set.id:${selectedSet.id}`,
        orderBy: 'number',
        pageSize: 200,
        select: 'id,name,number,set,images,tcgplayer,rarity,supertype,subtypes',
      },
    });

    const cards = (cardsResponse.data.data || []).map((card) => mapCard(card));
    return res.json({
      results: cards,
      total: cardsResponse.data.totalCount || cards.length,
      setName: selectedSet.name,
      setId: selectedSet.id,
      setSeries: selectedSet.series || null,
    });
  } catch (err) {
    console.error('Pack cards API error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch pack cards data' });
  }
});

// Search sets (packs / boxes)
app.get('/api/sets', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  const nameQuery = buildNameQuery(q);
  if (!nameQuery) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const response = await axios.get(`${POKEMON_TCG_API}/sets`, {
      headers: buildHeaders(),
      params: {
        q: nameQuery,
        orderBy: '-releaseDate',
        pageSize: 8,
        select: 'id,name,series,total,releaseDate,images,tcgplayer',
      },
    });

    const sets = (response.data.data || []).map((set) => mapSet(set));
    res.json({ results: sets, total: response.data.totalCount || sets.length });
  } catch (err) {
    console.error('Sets API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch set data' });
  }
});

// Get price history / detail for a single card
app.get('/api/cards/:id', async (req, res) => {
  try {
    const response = await axios.get(`${POKEMON_TCG_API}/cards/${req.params.id}`, {
      headers: buildHeaders(),
    });
    const card = response.data.data;
    const prices = extractCardPrices(card);
    res.json({
      id: card.id,
      name: card.name,
      set: card.set ? { id: card.set.id, name: card.set.name } : null,
      rarity: card.rarity || 'Unknown',
      image: card.images ? card.images.large : null,
      url: card.tcgplayer ? card.tcgplayer.url : null,
      updatedAt: card.tcgplayer ? card.tcgplayer.updatedAt : null,
      prices,
    });
  } catch (err) {
    console.error('Card detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch card detail' });
  }
});

// Get all sets (for browsing packs/boxes)
app.get('/api/sets/all', async (req, res) => {
  try {
    const response = await axios.get(`${POKEMON_TCG_API}/sets`, {
      headers: buildHeaders(),
      params: {
        orderBy: '-releaseDate',
        pageSize: 50,
        select: 'id,name,series,total,releaseDate,images,tcgplayer',
      },
    });
    const sets = (response.data.data || []).map((set) => mapSet(set));
    res.json({ results: sets, total: response.data.totalCount || sets.length });
  } catch (err) {
    console.error('All sets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sets' });
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

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

function mapCard(card) {
  const prices = extractCardPrices(card);
  return {
    id: card.id,
    name: card.name,
    number: card.number || null,
    set: card.set ? { id: card.set.id, name: card.set.name, series: card.set.series } : null,
    rarity: card.rarity || 'Unknown',
    supertype: card.supertype || 'Pokémon',
    subtypes: card.subtypes || [],
    image: card.images ? card.images.small : null,
    imageLarge: card.images ? card.images.large : null,
    url: card.tcgplayer ? card.tcgplayer.url : null,
    updatedAt: card.tcgplayer ? card.tcgplayer.updatedAt : null,
    prices,
  };
}

function pickBestSetMatch(sets, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return sets && sets.length ? sets[0] : null;
  const exact = (sets || []).find((set) => String(set.name || '').toLowerCase() === q);
  if (exact) return exact;
  const startsWith = (sets || []).find((set) => String(set.name || '').toLowerCase().startsWith(q));
  if (startsWith) return startsWith;
  const contains = (sets || []).find((set) => String(set.name || '').toLowerCase().includes(q));
  if (contains) return contains;
  return sets && sets.length ? sets[0] : null;
}

function mapSet(set) {
  // Estimate booster pack price from TCGPlayer data when available
  const packPrice = set.tcgplayer && set.tcgplayer.prices && set.tcgplayer.prices.boosterPack
    ? set.tcgplayer.prices.boosterPack
    : null;

  // Typical retail references (approximate MSRP)
  const msrpPack = 4.99;
  const msrpBox = 119.99;

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

app.get('/api/suggestions', async (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  if (!['cards', 'packcards', 'packs', 'boxes'].includes(type)) {
    return res.status(400).json({ error: 'Query parameter "type" must be cards, packcards, packs, or boxes' });
  }

  try {
    if (type === 'cards') {
      const response = await axios.get(`${POKEMON_TCG_API}/cards`, {
        headers: buildHeaders(),
        params: {
          orderBy: '-set.releaseDate',
          pageSize: 120,
          select: 'name,set',
        },
      });

      const options = uniqueOptions(
        response.data.data,
        (card) => card.name,
        (card) => (card.set ? card.set.name : '')
      );

      return res.json({ options });
    }

    const response = await axios.get(`${POKEMON_TCG_API}/sets`, {
      headers: buildHeaders(),
      params: {
        orderBy: '-releaseDate',
        pageSize: 200,
        select: 'name,series',
      },
    });

    const options = uniqueOptions(
      response.data.data,
      (set) => set.name,
      (set) => set.series || ''
    );

    return res.json({ options });
  } catch (err) {
    console.error('Suggestions API error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

app.get('/api/market-prices', async (req, res) => {
  const name = String(req.query.name || '').trim();
  const kind = String(req.query.kind || 'pack').toLowerCase();
  if (!name) return res.status(400).json({ error: 'Query parameter "name" is required' });

  const suffix = kind === 'box' ? 'pokemon booster box' : 'pokemon booster pack';
  const query = `${name} ${suffix}`;

  const [ebay, amazon, walmart] = await Promise.all([
    scrapeEbayPrice(query),
    scrapeAmazonPrice(query),
    scrapeWalmartPrice(query),
  ]);

  res.json({ query, sources: [ebay, amazon, walmart] });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pokemon Card Pack Finder running on http://localhost:${PORT}`);
});

module.exports = app;
