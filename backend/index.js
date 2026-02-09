require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

if (!TWELVE_DATA_API_KEY) {
  console.warn("TWELVE_DATA_API_KEY is not configured. Market data endpoints will return errors.");
}

const cache = new Map();
const RANGE_CONFIG = {
  "1D": { interval: "5min", outputsize: 96 },
  "5D": { interval: "15min", outputsize: 130 },
  "1M": { interval: "1h", outputsize: 180 },
  "3M": { interval: "1day", outputsize: 90 },
  "6M": { interval: "1day", outputsize: 180 },
  "1Y": { interval: "1day", outputsize: 260 },
};

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function requireDataApiKey(res) {
  if (!TWELVE_DATA_API_KEY) {
    res.status(500).json({
      error: "TWELVE_DATA_API_KEY is not configured on the backend.",
    });
    return false;
  }
  return true;
}

function parseOpenAiJson(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildTwelveDataUrl(path, params = {}) {
  const query = new URLSearchParams({
    ...params,
    apikey: TWELVE_DATA_API_KEY,
    format: "JSON",
  });
  return `https://api.twelvedata.com/${path}?${query.toString()}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || response.statusText || "Request failed";
    throw new Error(message);
  }
  return payload;
}

async function fetchFromTwelveData(path, params) {
  const url = buildTwelveDataUrl(path, params);
  const payload = await fetchJson(url);
  if (payload?.status === "error") {
    throw new Error(payload.message || "Twelve Data request failed");
  }
  return payload;
}

function computeSma(values, period) {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, item) => acc + item, 0);
  return sum / period;
}

function computeStdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeRsi(closes, period = 14) {
  if (closes.length <= period) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function classifyTrend(lastClose, sma20, sma50) {
  if (!sma20 || !sma50) return "Neutral";
  if (lastClose > sma20 && sma20 > sma50) return "Bullish";
  if (lastClose < sma20 && sma20 < sma50) return "Bearish";
  return "Range-bound";
}

function classifyMomentum(rsi) {
  if (rsi >= 70) return "Overbought";
  if (rsi <= 30) return "Oversold";
  if (rsi >= 55) return "Positive";
  if (rsi <= 45) return "Negative";
  return "Neutral";
}

function deriveMetrics(candles) {
  if (!candles?.length) {
    return {
      lastClose: 0,
      changePct: 0,
      high: 0,
      low: 0,
      avgVolume: 0,
      volatility: 0,
      rsi14: 50,
      sma20: 0,
      sma50: 0,
      trend: "Neutral",
      momentum: "Neutral",
      support: 0,
      resistance: 0,
    };
  }

  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const lastClose = closes.at(-1) || 0;
  const prevClose = closes.at(-2) || lastClose || 1;
  const changePct = ((lastClose - prevClose) / prevClose) * 100;
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const avgVolume = volumes.reduce((acc, value) => acc + value, 0) / volumes.length;
  const dailyReturns = closes
    .slice(1)
    .map((close, index) => (close - closes[index]) / closes[index])
    .filter((value) => Number.isFinite(value));
  const volatility = computeStdDev(dailyReturns) * Math.sqrt(252) * 100;
  const rsi14 = computeRsi(closes, 14);
  const sma20 = computeSma(closes, 20);
  const sma50 = computeSma(closes, 50);
  const trend = classifyTrend(lastClose, sma20, sma50);
  const momentum = classifyMomentum(rsi14);
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));

  return {
    lastClose,
    changePct,
    high,
    low,
    avgVolume,
    volatility,
    rsi14,
    sma20,
    sma50,
    trend,
    momentum,
    support,
    resistance,
  };
}

function buildHeuristicInsight({ ticker, metrics, riskProfile, question }) {
  const direction = metrics.changePct >= 0 ? "upward" : "downward";
  const riskTone =
    riskProfile === "aggressive"
      ? "higher-beta continuation setups"
      : riskProfile === "conservative"
      ? "capital-preserving entries with tighter risk controls"
      : "balanced opportunities with controlled position sizing";

  const setups = [];
  if (metrics.trend === "Bullish" && metrics.rsi14 < 70) {
    setups.push(`Trend remains constructive above key moving averages for ${ticker}.`);
  }
  if (metrics.trend === "Bearish" && metrics.rsi14 > 30) {
    setups.push(`Weak structure suggests rallies may be sold near resistance.`);
  }
  setups.push(
    `Watch support around ${metrics.support.toFixed(2)} and resistance near ${metrics.resistance.toFixed(
      2
    )}.`
  );

  const risks = [
    `Annualized volatility is ${metrics.volatility.toFixed(
      2
    )}%, which can widen intraday ranges quickly.`,
    `Momentum currently reads ${metrics.momentum.toLowerCase()}, so reversals can be sharp.`,
  ];

  const catalysts = [
    "Macro data releases and rate expectations",
    "Sector rotation against mega-cap leadership",
    "Unexpected earnings guidance or revisions",
  ];

  const actionItems = [
    `Define invalidation below ${metrics.support.toFixed(2)} before entering a trade.`,
    "Size risk per trade first, then choose entry precision.",
    "Re-evaluate if price closes beyond the 20-day regime for two sessions.",
  ];

  return {
    summary: `${ticker} shows ${direction} pressure with a ${metrics.trend.toLowerCase()} trend profile. For a ${riskProfile} profile, focus on ${riskTone}.`,
    setups,
    risks,
    catalysts,
    actionItems,
    confidence: Math.max(35, Math.min(82, Math.round(55 + metrics.changePct))),
    answeredQuestion: question || "General strategy brief",
  };
}

async function buildOpenAiInsight({ ticker, candles, metrics, riskProfile, question }) {
  if (!OPENAI_API_KEY) return null;

  const trimmedCandles = candles.slice(-60).map((candle) => ({
    date: candle.date,
    close: candle.close,
    high: candle.high,
    low: candle.low,
    volume: candle.volume,
  }));

  const promptPayload = {
    ticker,
    riskProfile,
    question,
    metrics,
    candles: trimmedCandles,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a systematic market strategist. Return strict JSON with keys: summary (string), setups (string[]), risks (string[]), catalysts (string[]), actionItems (string[]), confidence (number 0-100), answeredQuestion (string). Keep claims tethered to provided data.",
        },
        {
          role: "user",
          content: JSON.stringify(promptPayload),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || "OpenAI request failed";
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  const parsed = parseOpenAiJson(content);
  if (!parsed) {
    return {
      summary: content || `${ticker} analysis generated, but structured format was unavailable.`,
      setups: [],
      risks: [],
      catalysts: [],
      actionItems: [],
      confidence: 55,
      answeredQuestion: question || "General strategy brief",
    };
  }

  return {
    summary: String(parsed.summary || ""),
    setups: Array.isArray(parsed.setups) ? parsed.setups.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map(String) : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
    confidence: toNumber(parsed.confidence),
    answeredQuestion: String(parsed.answeredQuestion || question || "General strategy brief"),
  };
}

function resolveRangeConfig(range, interval, outputsize) {
  if (interval && outputsize) {
    return { interval, outputsize: Number(outputsize), label: "custom" };
  }

  const selectedRange = String(range || "3M").toUpperCase();
  const fallback = RANGE_CONFIG[selectedRange] || RANGE_CONFIG["3M"];
  return {
    interval: fallback.interval,
    outputsize: fallback.outputsize,
    label: selectedRange,
  };
}

async function fetchCandles(symbol, interval, outputsize) {
  const payload = await fetchFromTwelveData("time_series", {
    symbol,
    interval,
    outputsize,
    order: "ASC",
  });

  if (!Array.isArray(payload?.values)) {
    throw new Error(`No candle data returned for ${symbol}.`);
  }

  return payload.values
    .slice()
    .map((value) => ({
      date: String(value.datetime).split(" ")[0],
      datetime: String(value.datetime),
      open: toNumber(value.open),
      high: toNumber(value.high),
      low: toNumber(value.low),
      close: toNumber(value.close),
      volume: toNumber(value.volume),
    }))
    .filter((item) => item.close > 0);
}

async function fetchQuote(symbol) {
  const payload = await fetchFromTwelveData("quote", { symbol });
  return {
    symbol,
    price: toNumber(payload.close || payload.price),
    change: toNumber(payload.change),
    percentChange: toNumber(payload.percent_change),
    open: toNumber(payload.open),
    high: toNumber(payload.high),
    low: toNumber(payload.low),
    previousClose: toNumber(payload.previous_close),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    services: {
      marketData: Boolean(TWELVE_DATA_API_KEY),
      ai: Boolean(OPENAI_API_KEY),
    },
  });
});

app.get("/api/symbol-search", async (req, res) => {
  const query = String(req.query.query || req.query.symbol || "").trim();
  if (query.length < 1) {
    return res.status(400).json({ error: "query is required" });
  }
  if (!requireDataApiKey(res)) return;

  const cacheKey = `symbol-search:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    const payload = await fetchFromTwelveData("symbol_search", {
      symbol: query,
      outputsize: 15,
    });
    const data = Array.isArray(payload.data)
      ? payload.data.map((item) => ({
          symbol: normalizeTicker(item.symbol),
          name: item.instrument_name || item.name || item.symbol,
          exchange: item.exchange || "Unknown",
          country: item.country || "Unknown",
          currency: item.currency || "USD",
          type: item.type || "Stock",
        }))
      : [];

    setCached(cacheKey, data, 10 * 60 * 1000);
    res.json({ data, cached: false });
  } catch (error) {
    console.error("symbol-search error", error);
    res.status(500).json({ error: error.message || "Failed to search symbols" });
  }
});

app.post("/api/stock-candles-multi", async (req, res) => {
  const { tickers = [], range = "3M", interval, outputsize } = req.body || {};
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: "tickers must be a non-empty array" });
  }
  if (!requireDataApiKey(res)) return;

  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))].slice(0, 8);
  const rangeConfig = resolveRangeConfig(range, interval, outputsize);

  try {
    const data = {};
    for (const ticker of normalizedTickers) {
      const cacheKey = `candles:${ticker}:${rangeConfig.interval}:${rangeConfig.outputsize}`;
      let candles = getCached(cacheKey);
      if (!candles) {
        candles = await fetchCandles(ticker, rangeConfig.interval, rangeConfig.outputsize);
        setCached(cacheKey, candles, 4 * 60 * 1000);
      }
      data[ticker] = {
        candles,
        metrics: deriveMetrics(candles),
      };
    }

    res.json({
      meta: {
        interval: rangeConfig.interval,
        outputsize: rangeConfig.outputsize,
        range: rangeConfig.label,
      },
      data,
    });
  } catch (error) {
    console.error("stock-candles-multi error", error);
    res.status(500).json({ error: error.message || "Failed to fetch market data" });
  }
});

app.post("/api/quote-multi", async (req, res) => {
  const { tickers = [] } = req.body || {};
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: "tickers must be a non-empty array" });
  }
  if (!requireDataApiKey(res)) return;

  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))].slice(0, 20);

  try {
    const data = {};
    for (const ticker of normalizedTickers) {
      const cacheKey = `quote:${ticker}`;
      let quote = getCached(cacheKey);
      if (!quote) {
        quote = await fetchQuote(ticker);
        setCached(cacheKey, quote, 20 * 1000);
      }
      data[ticker] = quote;
    }
    res.json({ data });
  } catch (error) {
    console.error("quote-multi error", error);
    res.status(500).json({ error: error.message || "Failed to fetch quotes" });
  }
});

app.get("/api/market-pulse", async (req, res) => {
  if (!requireDataApiKey(res)) return;

  const fromQuery = String(req.query.tickers || "")
    .split(",")
    .map((item) => normalizeTicker(item))
    .filter(Boolean);
  const universe =
    fromQuery.length > 0
      ? fromQuery.slice(0, 12)
      : ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "TSLA"];

  try {
    const output = [];
    for (const ticker of universe) {
      const cacheKey = `pulse:${ticker}`;
      let quote = getCached(cacheKey);
      if (!quote) {
        quote = await fetchQuote(ticker);
        setCached(cacheKey, quote, 30 * 1000);
      }
      output.push(quote);
    }
    res.json({ data: output });
  } catch (error) {
    console.error("market-pulse error", error);
    res.status(500).json({ error: error.message || "Failed to fetch market pulse" });
  }
});

app.post("/api/ai/insight", async (req, res) => {
  const { ticker, candles = [], metrics, riskProfile = "balanced", question = "" } = req.body || {};
  const symbol = normalizeTicker(ticker);

  if (!symbol) {
    return res.status(400).json({ error: "ticker is required" });
  }

  const usableCandles = Array.isArray(candles) ? candles : [];
  const usableMetrics =
    metrics && typeof metrics === "object" ? metrics : deriveMetrics(usableCandles);

  try {
    let insight = null;
    let engine = "heuristic";
    if (OPENAI_API_KEY) {
      insight = await buildOpenAiInsight({
        ticker: symbol,
        candles: usableCandles,
        metrics: usableMetrics,
        riskProfile,
        question,
      });
      if (insight) engine = "openai";
    }

    if (!insight) {
      insight = buildHeuristicInsight({
        ticker: symbol,
        metrics: usableMetrics,
        riskProfile,
        question,
      });
    }

    res.json({
      data: insight,
      meta: {
        engine,
        model: engine === "openai" ? OPENAI_MODEL : "heuristic-v1",
      },
    });
  } catch (error) {
    console.error("ai-insight error", error);
    const fallback = buildHeuristicInsight({
      ticker: symbol,
      metrics: usableMetrics,
      riskProfile,
      question,
    });
    res.status(200).json({
      data: fallback,
      meta: {
        engine: "heuristic-fallback",
        reason: error.message,
      },
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.listen(PORT, () => {
  console.log(`StockVision backend listening on http://localhost:${PORT}`);
});
