const ENV_BASE = (import.meta.env.VITE_BACKEND_URL || "").trim().replace(/\/$/, "");
const LOCAL_FALLBACKS = ["http://127.0.0.1:4000", "http://localhost:4000"];
let activeBase = ENV_BASE || null;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getBaseCandidates() {
  const candidates = [];

  if (activeBase) candidates.push(activeBase);
  if (ENV_BASE) candidates.push(ENV_BASE);

  if (typeof window !== "undefined" && window.location?.origin) {
    candidates.push(window.location.origin.replace(/\/$/, ""));
  }

  candidates.push(...LOCAL_FALLBACKS);
  return unique(candidates);
}

function buildUrl(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function makeOptions(options = {}) {
  return {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };
}

function shouldTryNext(response, payload) {
  if (!response) return true;
  if (response.status === 404) return true;
  if (response.status === 502 && !payload?.error) return true;
  return false;
}

async function request(path, options = {}, params = {}) {
  const candidates = getBaseCandidates();
  const failures = [];

  for (const base of candidates) {
    const url = buildUrl(base, path, params);

    try {
      const response = await fetch(url, makeOptions(options));
      const payload = await response.json().catch(() => null);

      if (response.ok) {
        activeBase = base;
        return payload;
      }

      const message = payload?.error || `Request failed (${response.status})`;
      if (shouldTryNext(response, payload)) {
        failures.push(`${base}: ${message}`);
        continue;
      }

      throw new Error(`${message} [${base}]`);
    } catch (error) {
      failures.push(`${base}: ${error.message || "network failure"}`);
    }
  }

  throw new Error(
    [
      "Unable to reach backend API.",
      "Start backend with `cd backend && npm start` or set `VITE_BACKEND_URL`.",
      `Tried: ${candidates.join(", ")}`,
      failures.length ? `Failures: ${failures.slice(0, 3).join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export async function fetchBackendHealth() {
  return request("/api/health");
}

export async function searchSymbols(query) {
  const payload = await request("/api/symbol-search", {}, { query });
  return payload?.data || [];
}

export async function fetchStockCandlesMulti({ tickers, range }) {
  return request("/api/stock-candles-multi", {
    method: "POST",
    body: JSON.stringify({ tickers, range }),
  });
}

export async function fetchQuoteMulti({ tickers }) {
  return request("/api/quote-multi", {
    method: "POST",
    body: JSON.stringify({ tickers }),
  });
}

export async function fetchMarketPulse() {
  return request("/api/market-pulse");
}

export async function fetchMarketNews({ tickers = [], topic = "", limit = 12 } = {}) {
  const payload = await request("/api/market-news", {}, {
    tickers: Array.isArray(tickers) ? tickers.join(",") : "",
    topic,
    limit,
  });
  return payload || { data: [], meta: {} };
}

export async function runBacktest({
  ticker,
  range = "1Y",
  fastPeriod = 20,
  slowPeriod = 50,
  initialCapital = 10000,
  feeBps = 5,
}) {
  return request("/api/backtest", {
    method: "POST",
    body: JSON.stringify({
      ticker,
      range,
      fastPeriod,
      slowPeriod,
      initialCapital,
      feeBps,
    }),
  });
}

export async function fetchAiInsight(payload) {
  return request("/api/ai/insight", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
