require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MARKET_DATA_PROVIDER = process.env.MARKET_DATA_PROVIDER || "yahoo-finance";
const YAHOO_BASE_URL = "https://query1.finance.yahoo.com";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const cache = new Map();
const RANGE_CONFIG = {
  "1D": { interval: "5m", range: "1d", outputsize: 96 },
  "5D": { interval: "15m", range: "5d", outputsize: 130 },
  "1M": { interval: "60m", range: "1mo", outputsize: 180 },
  "3M": { interval: "1d", range: "3mo", outputsize: 90 },
  "6M": { interval: "1d", range: "6mo", outputsize: 180 },
  "1Y": { interval: "1d", range: "1y", outputsize: 260 },
};
const RANGE_TO_DAYS = {
  "1d": 2,
  "5d": 7,
  "1mo": 35,
  "3mo": 100,
  "6mo": 200,
  "1y": 370,
  "2y": 740,
  "5y": 1900,
  "10y": 3800,
  ytd: 380,
  max: 10000,
};
const VALID_QUOTE_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY"]);

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function parseOpenAiJson(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildYahooUrl(path, params = {}) {
  const url = new URL(`${YAHOO_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "StockVision/1.0",
      Accept: "application/json, text/plain, */*",
    },
  });
  const contentType = response.headers.get("content-type") || "";
  let payload;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text();
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload?.chart?.error?.description ||
      payload?.error?.description ||
      payload?.error?.message ||
      payload?.message ||
      response.statusText ||
      "Market data request failed";
    throw new Error(message);
  }

  return payload;
}

function intervalToMinutes(interval) {
  const input = String(interval || "").trim();
  if (input.endsWith("m")) return toNumber(input.slice(0, -1));
  if (input.endsWith("h")) return toNumber(input.slice(0, -1)) * 60;
  if (input.endsWith("d")) return toNumber(input.slice(0, -1)) * 60 * 24;
  if (input.endsWith("wk")) return toNumber(input.replace("wk", "")) * 60 * 24 * 7;
  return 60 * 24;
}

function mapOutputsizeToRange(interval, outputsize) {
  const minutes = intervalToMinutes(interval);
  const totalDays = (minutes * Math.max(1, Number(outputsize) || 1)) / (60 * 24);
  if (totalDays <= 1.2) return "1d";
  if (totalDays <= 5.5) return "5d";
  if (totalDays <= 30) return "1mo";
  if (totalDays <= 90) return "3mo";
  if (totalDays <= 180) return "6mo";
  if (totalDays <= 365) return "1y";
  if (totalDays <= 730) return "2y";
  return "5y";
}

function rangeToOutputsize(range, interval) {
  const days = RANGE_TO_DAYS[range] || 100;
  const minutes = intervalToMinutes(interval);
  const bars = Math.floor((days * 24 * 60) / Math.max(1, minutes));
  return Math.max(20, Math.min(3000, bars));
}

function resolveRangeConfig(range, interval, outputsize) {
  if (interval && outputsize) {
    const rangeFromOutput = mapOutputsizeToRange(interval, outputsize);
    return {
      interval,
      range: rangeFromOutput,
      outputsize: Number(outputsize),
      label: "custom",
    };
  }

  const selectedRange = String(range || "3M").toUpperCase();
  const fallback = RANGE_CONFIG[selectedRange] || RANGE_CONFIG["3M"];
  return {
    interval: fallback.interval,
    range: fallback.range,
    outputsize: fallback.outputsize,
    label: selectedRange,
  };
}

function formatTimestampToCandleDate(unixTs) {
  const date = new Date(unixTs * 1000);
  const iso = date.toISOString();
  return {
    date: iso.slice(0, 10),
    datetime: iso.slice(0, 19).replace("T", " "),
  };
}

function trimCandlesByRange(candles, range) {
  const days = RANGE_TO_DAYS[range] || 365;
  const from = Date.now() - days * 24 * 60 * 60 * 1000;
  return candles.filter((candle) => Date.parse(candle.date) >= from);
}

async function fetchYahooChart(symbol, interval, range) {
  const url = buildYahooUrl(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    interval,
    range,
    includePrePost: "false",
    events: "div,splits",
  });
  const payload = await fetchJson(url);
  const error = payload?.chart?.error;
  if (error) {
    throw new Error(error.description || error.message || `Chart request failed for ${symbol}`);
  }

  const result = payload?.chart?.result?.[0];
  if (!result || !Array.isArray(result.timestamp)) {
    throw new Error(`No chart data returned for ${symbol}`);
  }

  const quote = result?.indicators?.quote?.[0] || {};
  const candles = [];

  result.timestamp.forEach((timestamp, index) => {
    const close = toNumber(quote.close?.[index]);
    const open = toNumber(quote.open?.[index]);
    const high = toNumber(quote.high?.[index]);
    const low = toNumber(quote.low?.[index]);
    if (!close || !open || !high || !low) return;
    const { date, datetime } = formatTimestampToCandleDate(timestamp);
    candles.push({
      date,
      datetime,
      open,
      high,
      low,
      close,
      volume: toNumber(quote.volume?.[index]),
    });
  });

  if (!candles.length) {
    throw new Error(`Chart returned empty candles for ${symbol}`);
  }

  return candles;
}

function mapToStooqSymbol(symbol) {
  const normalized = String(symbol || "").trim().toLowerCase();
  if (normalized.includes(".")) return normalized;
  if (/^[a-z0-9-]{1,8}$/.test(normalized)) return `${normalized}.us`;
  return normalized;
}

async function fetchStooqDaily(symbol, range) {
  const stooqSymbol = mapToStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "StockVision/1.0",
      Accept: "text/csv, text/plain, */*",
    },
  });
  const text = await response.text();
  if (!response.ok || /No data/i.test(text)) {
    throw new Error(`No fallback data available for ${symbol}`);
  }

  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) {
    throw new Error(`No fallback rows for ${symbol}`);
  }

  const candles = lines
    .slice(1)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        date: String(date || ""),
        datetime: `${String(date || "")} 00:00:00`,
        open: toNumber(open),
        high: toNumber(high),
        low: toNumber(low),
        close: toNumber(close),
        volume: toNumber(volume),
      };
    })
    .filter((item) => item.close > 0)
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));

  return trimCandlesByRange(candles, range);
}

async function fetchCandles(symbol, interval, range) {
  try {
    return await fetchYahooChart(symbol, interval, range);
  } catch (primaryError) {
    if (interval === "1d") {
      try {
        return await fetchStooqDaily(symbol, range);
      } catch {
        throw primaryError;
      }
    }
    throw primaryError;
  }
}

function buildEmptyQuote(symbol) {
  return {
    symbol,
    price: 0,
    change: 0,
    percentChange: 0,
    open: 0,
    high: 0,
    low: 0,
    previousClose: 0,
    volume: 0,
    currency: "USD",
    exchange: "Unknown",
  };
}

function parseQuoteFromChart(symbol, payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return buildEmptyQuote(symbol);

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).map(toNumber).filter((value) => value > 0);
  const opens = (quote.open || []).map(toNumber).filter((value) => value > 0);
  const highs = (quote.high || []).map(toNumber).filter((value) => value > 0);
  const lows = (quote.low || []).map(toNumber).filter((value) => value > 0);
  const volumes = (quote.volume || []).map(toNumber).filter((value) => value >= 0);

  const price =
    closes.at(-1) ||
    toNumber(meta.regularMarketPrice) ||
    toNumber(meta.currentTradingPeriod?.regular?.close) ||
    0;
  const previousClose =
    toNumber(meta.previousClose) ||
    toNumber(meta.chartPreviousClose) ||
    closes[0] ||
    price ||
    0;
  const change = price - previousClose;
  const percentChange = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    price,
    change,
    percentChange,
    open: opens[0] || toNumber(meta.regularMarketOpen) || previousClose,
    high: highs.length ? Math.max(...highs) : toNumber(meta.regularMarketDayHigh) || price,
    low: lows.length ? Math.min(...lows) : toNumber(meta.regularMarketDayLow) || price,
    previousClose,
    volume: volumes.reduce((sum, value) => sum + value, 0),
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || "Unknown",
  };
}

async function fetchQuoteForSymbol(symbol) {
  const url = buildYahooUrl(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    interval: "5m",
    range: "1d",
    includePrePost: "false",
  });
  const payload = await fetchJson(url);
  const error = payload?.chart?.error;
  if (error) {
    throw new Error(error.description || error.message || `Quote unavailable for ${symbol}`);
  }
  return parseQuoteFromChart(symbol, payload);
}

async function fetchQuoteMap(symbols) {
  const uniqueSymbols = [...new Set(symbols.map(normalizeTicker).filter(Boolean))];
  if (!uniqueSymbols.length) return {};

  const results = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        const quote = await fetchQuoteForSymbol(symbol);
        return [symbol, quote];
      } catch (error) {
        return [symbol, buildEmptyQuote(symbol)];
      }
    })
  );

  return Object.fromEntries(results);
}

async function searchSymbolsYahoo(query) {
  const url = buildYahooUrl("/v1/finance/search", {
    q: query,
    quotesCount: 20,
    newsCount: 0,
    enableFuzzyQuery: "true",
  });
  const payload = await fetchJson(url);
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];

  return quotes
    .filter((item) => item.symbol)
    .filter((item) => !item.symbol.includes("="))
    .filter((item) => {
      if (!item.quoteType) return true;
      return VALID_QUOTE_TYPES.has(String(item.quoteType).toUpperCase());
    })
    .slice(0, 15)
    .map((item) => ({
      symbol: normalizeTicker(item.symbol),
      name: item.shortname || item.longname || item.symbol,
      exchange: item.exchDisp || item.exchange || "Unknown",
      country: item.region || "Unknown",
      currency: item.currency || "USD",
      type: item.quoteType || "Unknown",
    }));
}

async function fetchYahooNews(query, count = 10) {
  const url = buildYahooUrl("/v1/finance/search", {
    q: query,
    quotesCount: 0,
    newsCount: count,
    enableFuzzyQuery: "true",
  });
  const payload = await fetchJson(url);
  return Array.isArray(payload?.news) ? payload.news : [];
}

function normalizeNewsItem(item, sourceQuery) {
  const publishedUnix = toNumber(item?.providerPublishTime || item?.providerPublishTimeUtc);
  return {
    id: String(item?.uuid || `${sourceQuery}-${item?.title || "headline"}`),
    title: String(item?.title || "Untitled"),
    publisher: String(item?.publisher || "Unknown"),
    link: String(item?.link || ""),
    sourceQuery,
    relatedTickers: Array.isArray(item?.relatedTickers)
      ? item.relatedTickers.map(normalizeTicker).filter(Boolean)
      : [],
    publishedAt: publishedUnix
      ? new Date(publishedUnix * 1000).toISOString()
      : new Date().toISOString(),
    publishedUnix,
    thumbnail: item?.thumbnail?.resolutions?.[0]?.url || null,
  };
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

function computeAtr(candles, period = 14) {
  if (!candles?.length) return 0;
  const trValues = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const prevClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
  });

  const lookback = trValues.length >= period ? trValues.slice(-period) : trValues;
  return average(lookback);
}

function computePerformance(closes, lookback) {
  if (closes.length <= lookback) return 0;
  const reference = closes[closes.length - lookback - 1];
  const latest = closes.at(-1);
  if (!reference) return 0;
  return ((latest - reference) / reference) * 100;
}

function computeMaxDrawdown(closes) {
  if (!closes.length) return 0;
  let peak = closes[0];
  let maxDrawdown = 0;
  closes.forEach((close) => {
    if (close > peak) peak = close;
    const drawdown = ((close - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  });
  return Math.abs(maxDrawdown);
}

function classifyVolumeTrend(volumes) {
  if (volumes.length < 20) return "Stable";
  const recent = average(volumes.slice(-10));
  const prior = average(volumes.slice(-20, -10));
  if (!prior) return "Stable";
  const shift = (recent - prior) / prior;
  if (shift > 0.15) return "Increasing";
  if (shift < -0.15) return "Declining";
  return "Stable";
}

function classifyRiskLevel(volatility, maxDrawdown, atrPct) {
  if (volatility > 45 || maxDrawdown > 30 || atrPct > 5) return "High";
  if (volatility > 28 || maxDrawdown > 18 || atrPct > 3) return "Medium";
  return "Low";
}

function buildSignalScore({
  trend,
  momentum,
  performance20,
  volatility,
  distanceToResistancePct,
  distanceToSupportPct,
  volumeTrend,
}) {
  let score = 50;

  if (trend === "Bullish") score += 12;
  if (trend === "Bearish") score -= 12;

  if (momentum === "Positive") score += 8;
  if (momentum === "Negative") score -= 8;
  if (momentum === "Oversold") score += 5;
  if (momentum === "Overbought") score -= 5;

  score += clamp(performance20 * 0.7, -14, 14);
  score -= clamp((volatility - 25) * 0.4, 0, 14);

  if (distanceToResistancePct < 2) score -= 6;
  if (distanceToSupportPct < 2) score += 4;

  if (volumeTrend === "Increasing") score += 4;
  if (volumeTrend === "Declining") score -= 4;

  return Math.round(clamp(score, 0, 100));
}

function buildSignalFlags({
  trend,
  momentum,
  performance5,
  performance20,
  atrPct,
  distanceToResistancePct,
  distanceToSupportPct,
  volumeTrend,
}) {
  const flags = [];

  if (trend === "Bullish") flags.push("Trend aligned up");
  if (trend === "Bearish") flags.push("Trend pressure down");

  if (momentum === "Overbought") flags.push("RSI overbought");
  if (momentum === "Oversold") flags.push("RSI oversold");

  if (performance20 > 10) flags.push("Strong 1M relative strength");
  if (performance20 < -10) flags.push("Weak 1M performance");

  if (performance5 > 4) flags.push("Short-term acceleration");
  if (performance5 < -4) flags.push("Short-term pullback");

  if (distanceToResistancePct < 2) flags.push("Trading near resistance");
  if (distanceToSupportPct < 2) flags.push("Trading near support");

  if (atrPct > 3) flags.push("High ATR regime");
  if (volumeTrend === "Increasing") flags.push("Volume expansion");

  return flags.slice(0, 6);
}

function computeCorrelation(seriesA, seriesB) {
  const minLength = Math.min(seriesA.length, seriesB.length);
  if (minLength < 8) return 0;

  const a = seriesA.slice(-Math.min(minLength, 90));
  const b = seriesB.slice(-Math.min(minLength, 90));

  const meanA = average(a);
  const meanB = average(b);
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denominator = Math.sqrt(denomA * denomB);
  if (!denominator) return 0;
  return numerator / denominator;
}

function buildCorrelationMatrix(dataByTicker) {
  const tickers = Object.keys(dataByTicker);
  const returnsMap = {};

  tickers.forEach((ticker) => {
    const closes = (dataByTicker[ticker] || []).map((candle) => candle.close);
    returnsMap[ticker] = closes
      .slice(1)
      .map((close, index) => (close - closes[index]) / closes[index])
      .filter((value) => Number.isFinite(value));
  });

  const matrix = {};
  tickers.forEach((left, leftIndex) => {
    matrix[left] = matrix[left] || {};
    for (let rightIndex = leftIndex; rightIndex < tickers.length; rightIndex += 1) {
      const right = tickers[rightIndex];
      const corr = left === right ? 1 : computeCorrelation(returnsMap[left], returnsMap[right]);
      const rounded = Number(corr.toFixed(2));
      matrix[left][right] = rounded;
      matrix[right] = matrix[right] || {};
      matrix[right][left] = rounded;
    }
  });

  return matrix;
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
      atr14: 0,
      atrPct: 0,
      performance5: 0,
      performance20: 0,
      maxDrawdown: 0,
      volumeTrend: "Stable",
      distanceToSupportPct: 0,
      distanceToResistancePct: 0,
      riskLevel: "Low",
      signalScore: 50,
      signalFlags: [],
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
  const avgVolume = average(volumes);
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
  const atr14 = computeAtr(candles, 14);
  const atrPct = lastClose ? (atr14 / lastClose) * 100 : 0;
  const performance5 = computePerformance(closes, 5);
  const performance20 = computePerformance(closes, 20);
  const maxDrawdown = computeMaxDrawdown(closes);
  const volumeTrend = classifyVolumeTrend(volumes);
  const distanceToSupportPct = lastClose ? ((lastClose - support) / lastClose) * 100 : 0;
  const distanceToResistancePct = lastClose ? ((resistance - lastClose) / lastClose) * 100 : 0;
  const signalScore = buildSignalScore({
    trend,
    momentum,
    performance20,
    volatility,
    distanceToResistancePct,
    distanceToSupportPct,
    volumeTrend,
  });
  const riskLevel = classifyRiskLevel(volatility, maxDrawdown, atrPct);
  const signalFlags = buildSignalFlags({
    trend,
    momentum,
    performance5,
    performance20,
    atrPct,
    distanceToResistancePct,
    distanceToSupportPct,
    volumeTrend,
  });

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
    atr14,
    atrPct,
    performance5,
    performance20,
    maxDrawdown,
    volumeTrend,
    distanceToSupportPct,
    distanceToResistancePct,
    riskLevel,
    signalScore,
    signalFlags,
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

  const tacticalLevels =
    metrics.trend === "Bearish"
      ? {
          entryZone: `${(metrics.resistance * 0.98).toFixed(2)} - ${metrics.resistance.toFixed(2)}`,
          invalidation: (metrics.resistance * 1.03).toFixed(2),
          firstTarget: (metrics.support * 1.01).toFixed(2),
        }
      : {
          entryZone: `${metrics.support.toFixed(2)} - ${(metrics.support * 1.02).toFixed(2)}`,
          invalidation: (metrics.support * 0.97).toFixed(2),
          firstTarget: (metrics.resistance * 0.99).toFixed(2),
        };

  return {
    summary: `${ticker} shows ${direction} pressure with a ${metrics.trend.toLowerCase()} trend profile. For a ${riskProfile} profile, focus on ${riskTone}.`,
    setups,
    risks,
    catalysts,
    actionItems,
    confidence: clamp(Math.round(metrics.signalScore + metrics.performance5), 30, 88),
    tacticalLevels,
    answeredQuestion: question || "General strategy brief",
  };
}

async function buildOpenAiInsight({ ticker, candles, metrics, riskProfile, question, context }) {
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
    context: context || null,
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
            "You are a systematic market strategist. Return strict JSON with keys: summary (string), setups (string[]), risks (string[]), catalysts (string[]), actionItems (string[]), confidence (number 0-100), tacticalLevels ({entryZone, invalidation, firstTarget}), answeredQuestion (string). Keep claims tethered to provided data.",
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
      tacticalLevels: {
        entryZone: "Data unavailable",
        invalidation: "Data unavailable",
        firstTarget: "Data unavailable",
      },
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
    tacticalLevels: {
      entryZone: String(parsed?.tacticalLevels?.entryZone || "N/A"),
      invalidation: String(parsed?.tacticalLevels?.invalidation || "N/A"),
      firstTarget: String(parsed?.tacticalLevels?.firstTarget || "N/A"),
    },
    answeredQuestion: String(parsed.answeredQuestion || question || "General strategy brief"),
  };
}

function buildSmaSeries(closes, period) {
  let rolling = 0;
  return closes.map((value, index) => {
    rolling += value;
    if (index >= period) rolling -= closes[index - period];
    if (index < period - 1) return null;
    return rolling / period;
  });
}

function calculateCurveMaxDrawdown(curve) {
  if (!curve.length) return 0;
  let peak = curve[0].value;
  let maxDrawdown = 0;
  curve.forEach((point) => {
    if (point.value > peak) peak = point.value;
    const drawdown = ((point.value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  });
  return Math.abs(maxDrawdown);
}

function runSmaCrossoverBacktest({
  candles,
  fastPeriod,
  slowPeriod,
  initialCapital,
  feeBps,
}) {
  const closes = candles.map((candle) => candle.close);
  const fastSeries = buildSmaSeries(closes, fastPeriod);
  const slowSeries = buildSmaSeries(closes, slowPeriod);
  const feeRate = Math.max(0, feeBps) / 10000;

  let cash = initialCapital;
  let shares = 0;
  let inPosition = false;
  let entryValue = 0;

  const trades = [];
  const equityCurve = [];

  for (let index = 1; index < candles.length; index += 1) {
    const close = closes[index];
    const date = candles[index].date;
    const prevFast = fastSeries[index - 1];
    const prevSlow = slowSeries[index - 1];
    const fast = fastSeries[index];
    const slow = slowSeries[index];
    const canSignal =
      prevFast !== null &&
      prevSlow !== null &&
      fast !== null &&
      slow !== null;

    if (canSignal && !inPosition && prevFast <= prevSlow && fast > slow) {
      const fee = cash * feeRate;
      const spendable = Math.max(0, cash - fee);
      shares = spendable / close;
      cash = 0;
      inPosition = true;
      entryValue = spendable + fee;
      trades.push({
        type: "BUY",
        date,
        price: Number(close.toFixed(2)),
        shares: Number(shares.toFixed(4)),
        fee: Number(fee.toFixed(2)),
      });
    } else if (canSignal && inPosition && prevFast >= prevSlow && fast < slow) {
      const gross = shares * close;
      const fee = gross * feeRate;
      const net = gross - fee;
      const pnl = net - entryValue;
      cash = net;
      shares = 0;
      inPosition = false;
      trades.push({
        type: "SELL",
        date,
        price: Number(close.toFixed(2)),
        fee: Number(fee.toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
      });
    }

    const equity = cash + shares * close;
    equityCurve.push({
      date,
      value: Number(equity.toFixed(2)),
      close: Number(close.toFixed(2)),
    });
  }

  const finalValue = equityCurve.at(-1)?.value || initialCapital;
  const firstClose = closes[0] || 1;
  const lastClose = closes.at(-1) || firstClose;
  const buyHoldReturnPct = ((lastClose - firstClose) / firstClose) * 100;
  const totalReturnPct = ((finalValue - initialCapital) / initialCapital) * 100;
  const closedTrades = trades.filter((trade) => trade.type === "SELL");
  const wins = closedTrades.filter((trade) => trade.pnl > 0).length;
  const losses = closedTrades.filter((trade) => trade.pnl <= 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;
  const maxDrawdown = calculateCurveMaxDrawdown(equityCurve);

  const days =
    (Date.parse(candles.at(-1)?.date || "") - Date.parse(candles[0]?.date || "")) /
    (24 * 60 * 60 * 1000);
  const years = days > 0 ? days / 365 : 0;
  const cagrPct =
    years > 0 ? (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100 : totalReturnPct;

  return {
    summary: {
      initialCapital: Number(initialCapital.toFixed(2)),
      finalValue: Number(finalValue.toFixed(2)),
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      buyHoldReturnPct: Number(buyHoldReturnPct.toFixed(2)),
      alphaPct: Number((totalReturnPct - buyHoldReturnPct).toFixed(2)),
      maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
      trades: closedTrades.length,
      wins,
      losses,
      winRatePct: Number(winRate.toFixed(2)),
      cagrPct: Number(cagrPct.toFixed(2)),
      inPosition,
    },
    equityCurve: equityCurve.slice(-260),
    trades: trades.slice(-100),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    services: {
      marketData: true,
      marketDataProvider: MARKET_DATA_PROVIDER,
      ai: Boolean(OPENAI_API_KEY),
    },
  });
});

app.get("/api/symbol-search", async (req, res) => {
  const query = String(req.query.query || req.query.symbol || "").trim();
  if (query.length < 1) {
    return res.status(400).json({ error: "query is required" });
  }

  const cacheKey = `symbol-search:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    const data = await searchSymbolsYahoo(query);
    setCached(cacheKey, data, 10 * 60 * 1000);
    res.json({ data, cached: false, provider: MARKET_DATA_PROVIDER });
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

  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))].slice(0, 8);
  const rangeConfig = resolveRangeConfig(range, interval, outputsize);

  try {
    const data = {};
    const errors = {};

    for (const ticker of normalizedTickers) {
      const cacheKey = `candles:${ticker}:${rangeConfig.interval}:${rangeConfig.range}`;
      let candles = getCached(cacheKey);
      if (!candles) {
        try {
          candles = await fetchCandles(ticker, rangeConfig.interval, rangeConfig.range);
          setCached(cacheKey, candles, 4 * 60 * 1000);
        } catch (tickerError) {
          errors[ticker] = tickerError.message;
          continue;
        }
      }

      data[ticker] = {
        candles,
        metrics: deriveMetrics(candles),
      };
    }

    const availableTickers = Object.keys(data);
    if (availableTickers.length === 0) {
      return res.status(502).json({
        error: "Failed to fetch data for requested tickers.",
        details: errors,
      });
    }

    const leaderboard = Object.entries(data)
      .map(([ticker, payload]) => ({
        ticker,
        score: payload.metrics.signalScore,
        riskLevel: payload.metrics.riskLevel,
        trend: payload.metrics.trend,
        momentum: payload.metrics.momentum,
        changePct: Number(payload.metrics.changePct.toFixed(2)),
        performance20: Number(payload.metrics.performance20.toFixed(2)),
      }))
      .sort((left, right) => right.score - left.score);

    const correlations = buildCorrelationMatrix(
      Object.fromEntries(Object.entries(data).map(([ticker, payload]) => [ticker, payload.candles]))
    );

    res.json({
      meta: {
        interval: rangeConfig.interval,
        outputsize:
          rangeConfig.outputsize ||
          rangeToOutputsize(rangeConfig.range, rangeConfig.interval),
        range: rangeConfig.label,
        provider: MARKET_DATA_PROVIDER,
        leaderboard,
        correlations,
        partial: availableTickers.length !== normalizedTickers.length,
        errors,
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

  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))].slice(0, 40);

  try {
    const data = {};
    const missing = [];

    normalizedTickers.forEach((ticker) => {
      const cached = getCached(`quote:${ticker}`);
      if (cached) data[ticker] = cached;
      else missing.push(ticker);
    });

    if (missing.length) {
      const fetched = await fetchQuoteMap(missing);
      Object.entries(fetched).forEach(([ticker, quote]) => {
        data[ticker] = quote;
        setCached(`quote:${ticker}`, quote, 20 * 1000);
      });
    }

    res.json({ data, provider: MARKET_DATA_PROVIDER });
  } catch (error) {
    console.error("quote-multi error", error);
    res.status(500).json({ error: error.message || "Failed to fetch quotes" });
  }
});

app.get("/api/market-pulse", async (req, res) => {
  const fromQuery = String(req.query.tickers || "")
    .split(",")
    .map((item) => normalizeTicker(item))
    .filter(Boolean);
  const universe =
    fromQuery.length > 0
      ? fromQuery.slice(0, 20)
      : ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "TSLA"];

  try {
    const quoteMap = await fetchQuoteMap(universe);
    const output = universe
      .map((ticker) => quoteMap[ticker])
      .filter(Boolean);

    const advancers = output.filter((item) => item.percentChange > 0).length;
    const decliners = output.filter((item) => item.percentChange < 0).length;
    const unchanged = output.length - advancers - decliners;
    const avgMove =
      output.reduce((sum, item) => sum + item.percentChange, 0) / (output.length || 1);
    const sorted = output
      .slice()
      .sort((left, right) => right.percentChange - left.percentChange);

    const summary = {
      advancers,
      decliners,
      unchanged,
      avgMove: Number(avgMove.toFixed(2)),
      breadth:
        decliners === 0
          ? "Positive breadth"
          : advancers / decliners > 1.2
          ? "Positive breadth"
          : advancers / decliners < 0.8
          ? "Negative breadth"
          : "Balanced breadth",
      leaders: sorted.slice(0, 3).map((item) => ({
        symbol: item.symbol,
        percentChange: item.percentChange,
      })),
      laggards: sorted.slice(-3).reverse().map((item) => ({
        symbol: item.symbol,
        percentChange: item.percentChange,
      })),
    };

    res.json({
      data: output,
      summary,
      provider: MARKET_DATA_PROVIDER,
    });
  } catch (error) {
    console.error("market-pulse error", error);
    res.status(500).json({ error: error.message || "Failed to fetch market pulse" });
  }
});

app.get("/api/market-news", async (req, res) => {
  const tickers = String(req.query.tickers || "")
    .split(",")
    .map((item) => normalizeTicker(item))
    .filter(Boolean)
    .slice(0, 5);
  const topic = String(req.query.topic || "").trim();
  const limit = clamp(toNumber(req.query.limit) || 12, 4, 40);

  const queries = [];
  if (topic) queries.push(topic);
  if (tickers.length) queries.push(...tickers.map((ticker) => `${ticker} stock`));
  if (!queries.length) {
    queries.push("stock market", "S&P 500", "Federal Reserve policy");
  }

  try {
    const allItems = [];
    for (const query of queries) {
      const cacheKey = `news:${query.toLowerCase()}`;
      let items = getCached(cacheKey);
      if (!items) {
        const raw = await fetchYahooNews(query, 10);
        items = raw.map((item) => normalizeNewsItem(item, query));
        setCached(cacheKey, items, 5 * 60 * 1000);
      }
      allItems.push(...items);
    }

    const seen = new Set();
    const unique = allItems.filter((item) => {
      const id = item.link || item.id || `${item.title}-${item.publishedAt}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    unique.sort((left, right) => right.publishedUnix - left.publishedUnix);

    res.json({
      data: unique.slice(0, limit),
      meta: {
        queries,
        provider: MARKET_DATA_PROVIDER,
      },
    });
  } catch (error) {
    console.error("market-news error", error);
    res.status(500).json({ error: error.message || "Failed to fetch market news" });
  }
});

app.post("/api/backtest", async (req, res) => {
  const {
    ticker,
    range = "1Y",
    fastPeriod = 20,
    slowPeriod = 50,
    initialCapital = 10000,
    feeBps = 5,
  } = req.body || {};

  const symbol = normalizeTicker(ticker);
  if (!symbol) {
    return res.status(400).json({ error: "ticker is required" });
  }
  if (toNumber(fastPeriod) < 2 || toNumber(slowPeriod) < 3) {
    return res.status(400).json({ error: "fastPeriod and slowPeriod must be valid numbers" });
  }
  if (toNumber(fastPeriod) >= toNumber(slowPeriod)) {
    return res.status(400).json({ error: "fastPeriod must be smaller than slowPeriod" });
  }

  try {
    const rangeConfig = resolveRangeConfig(range);
    const cacheKey = `backtest-candles:${symbol}:${rangeConfig.range}`;
    let candles = getCached(cacheKey);
    if (!candles) {
      candles = await fetchCandles(symbol, "1d", rangeConfig.range);
      setCached(cacheKey, candles, 5 * 60 * 1000);
    }

    if (candles.length < Number(slowPeriod) + 10) {
      return res.status(400).json({
        error: `Not enough candles (${candles.length}) for slowPeriod ${slowPeriod}`,
      });
    }

    const result = runSmaCrossoverBacktest({
      candles,
      fastPeriod: Number(fastPeriod),
      slowPeriod: Number(slowPeriod),
      initialCapital: Number(initialCapital),
      feeBps: Number(feeBps),
    });

    res.json({
      meta: {
        ticker: symbol,
        range: rangeConfig.label || range,
        fastPeriod: Number(fastPeriod),
        slowPeriod: Number(slowPeriod),
        initialCapital: Number(initialCapital),
        feeBps: Number(feeBps),
        provider: MARKET_DATA_PROVIDER,
      },
      data: result,
    });
  } catch (error) {
    console.error("backtest error", error);
    res.status(500).json({ error: error.message || "Failed to run backtest" });
  }
});

app.post("/api/ai/insight", async (req, res) => {
  const {
    ticker,
    candles = [],
    metrics,
    riskProfile = "balanced",
    question = "",
    context = null,
  } = req.body || {};
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
        context,
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
