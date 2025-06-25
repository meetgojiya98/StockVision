require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
const PORT = 4000;

app.use(cors());
app.use(bodyParser.json());

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
if (!TWELVE_DATA_API_KEY) {
  console.error('Missing TWELVE_DATA_API_KEY in .env');
  process.exit(1);
}

// Simple in-memory cache to reduce API calls
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

async function fetchCandlesTwelveData(ticker, interval = '1day', outputsize = 30) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    ticker
  )}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_API_KEY}&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data API error: ${res.statusText}`);
  const json = await res.json();

  if (json.status === 'error') throw new Error(json.message || 'API error');

  if (!json.values || !Array.isArray(json.values))
    throw new Error('Invalid data from Twelve Data');

  return json.values.reverse();
}

app.post('/api/stock-candles-multi', async (req, res) => {
  const { tickers, days } = req.body;
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'Tickers (non-empty array) is required' });
  }
  if (!days || typeof days !== 'number' || days <= 0) {
    return res.status(400).json({ error: 'Days (positive number) is required' });
  }

  try {
    const results = {};
    for (const ticker of tickers) {
      const cacheKey = `twelve-candles-${ticker}-${days}`;
      let data = getCached(cacheKey);
      if (!data) {
        data = await fetchCandlesTwelveData(ticker, '1day', days);
        setCache(cacheKey, data, 5 * 60 * 1000); // cache 5 mins
      }
      results[ticker] = data.map((d) => ({
        date: d.datetime.split(' ')[0],
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
        volume: parseFloat(d.volume),
      }));
    }
    res.json({ data: results });
  } catch (err) {
    console.error('Error /api/stock-candles-multi:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch data from Twelve Data' });
  }
});

app.listen(PORT, () => {
  console.log(`StockVision backend listening on http://localhost:${PORT}`);
});
