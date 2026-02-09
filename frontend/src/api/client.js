const API_BASE = (import.meta.env.VITE_BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");

function withParams(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export async function searchSymbols(query) {
  const response = await fetch(withParams("/api/symbol-search", { query }));
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to search symbols");
  }

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
  const url = withParams("/api/market-news", {
    tickers: Array.isArray(tickers) ? tickers.join(",") : "",
    topic,
    limit,
  });
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to fetch market news");
  }

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
