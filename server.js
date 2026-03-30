const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

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

// Search cards by name
app.get('/api/cards', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const response = await axios.get(`${POKEMON_TCG_API}/cards`, {
      headers: buildHeaders(),
      params: {
        q: `name:"${q}"`,
        orderBy: '-set.releaseDate',
        pageSize: 20,
        select: 'id,name,set,images,tcgplayer,rarity,supertype,subtypes',
      },
    });

    const cards = (response.data.data || []).map((card) => {
      const prices = extractCardPrices(card);
      return {
        id: card.id,
        name: card.name,
        set: card.set ? { id: card.set.id, name: card.set.name, series: card.set.series } : null,
        rarity: card.rarity || 'Unknown',
        supertype: card.supertype || 'Pokémon',
        subtypes: card.subtypes || [],
        image: card.images ? card.images.small : null,
        url: card.tcgplayer ? card.tcgplayer.url : null,
        updatedAt: card.tcgplayer ? card.tcgplayer.updatedAt : null,
        prices,
      };
    });

    res.json({ results: cards, total: response.data.totalCount || cards.length });
  } catch (err) {
    console.error('Cards API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch card data' });
  }
});

// Search sets (packs / boxes)
app.get('/api/sets', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const response = await axios.get(`${POKEMON_TCG_API}/sets`, {
      headers: buildHeaders(),
      params: {
        q: `name:"${q}"`,
        orderBy: '-releaseDate',
        pageSize: 20,
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pokemon Card Pack Finder running on http://localhost:${PORT}`);
});

module.exports = app;
