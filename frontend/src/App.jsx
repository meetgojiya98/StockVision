import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import AdvancedChart from "./AdvancedChart";
import {
  fetchBackendHealth,
  fetchAiInsight,
  fetchMarketNews,
  fetchMarketPulse,
  fetchQuoteMulti,
  fetchStockCandlesMulti,
  getApiConnectionState,
  runBacktest,
  searchSymbols,
} from "./api/client";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA"];
const RANGE_OPTIONS = ["1D", "5D", "1M", "3M", "6M", "1Y"];
const BACKTEST_RANGE_OPTIONS = ["6M", "1Y"];
const MODE_OPTIONS = [
  { value: "candlestick", label: "Candles" },
  { value: "line", label: "Lines" },
];
const RISK_OPTIONS = ["conservative", "balanced", "aggressive"];
const STRATEGY_STYLE_OPTIONS = [
  { value: "tactical", label: "Tactical" },
  { value: "swing", label: "Swing" },
  { value: "portfolio", label: "Portfolio" },
];
const SCANNER_PROFILE_OPTIONS = [
  { value: "momentum", label: "Momentum" },
  { value: "mean_reversion", label: "Mean Reversion" },
  { value: "breakout", label: "Breakout" },
];
const AUTO_REFRESH_OPTIONS = [
  { value: 0, label: "Manual" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 120, label: "120s" },
];
const INDICATOR_OPTIONS = [
  { key: "sma20", label: "SMA20" },
  { key: "sma50", label: "SMA50" },
  { key: "support", label: "Support" },
  { key: "resistance", label: "Resistance" },
];
const BASKET_PRESETS = [
  { label: "Big Tech", tickers: ["AAPL", "MSFT", "NVDA", "GOOGL", "META"] },
  { label: "AI Stack", tickers: ["NVDA", "AMD", "AVGO", "SMCI", "TSM"] },
  { label: "Index Core", tickers: ["SPY", "QQQ", "IWM", "DIA"] },
  { label: "Energy", tickers: ["XOM", "CVX", "COP", "SLB"] },
];
const QUICK_PROMPTS = [
  "Design a high-probability entry plan with invalidation and first target.",
  "What signals would confirm continuation vs fakeout this week?",
  "Build a defensive plan if macro volatility spikes.",
  "Rank this setup for risk/reward compared with SPY.",
];
const STAGGER_ITEM = { duration: 0.45, ease: "easeOut" };
const WORKSPACE_ORDER = ["market", "intelligence", "portfolio", "strategy"];
const WORKSPACE_INFO = {
  market: {
    label: "Market Command",
    hint: "Scanner, pulse, chart arena, and signal matrix",
  },
  intelligence: {
    label: "AI Intelligence",
    hint: "Copilot workflow and curated news stream",
  },
  portfolio: {
    label: "Portfolio Ops",
    hint: "Position monitor with risk and scenario control",
  },
  strategy: {
    label: "Strategy Lab",
    hint: "Chart context plus backtest execution",
  },
};

function usePersistentState(key, fallbackValue) {
  function normalizeParsed(parsed) {
    if (Array.isArray(fallbackValue)) {
      return Array.isArray(parsed) ? parsed : fallbackValue;
    }
    if (typeof fallbackValue === "number") {
      return Number.isFinite(parsed) ? parsed : fallbackValue;
    }
    if (typeof fallbackValue === "string") {
      return typeof parsed === "string" ? parsed : fallbackValue;
    }
    if (typeof fallbackValue === "object" && fallbackValue !== null) {
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...fallbackValue, ...parsed };
      }
      return fallbackValue;
    }
    return parsed ?? fallbackValue;
  }

  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? normalizeParsed(JSON.parse(saved)) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

function normalizeTicker(rawValue) {
  return String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9./-]/g, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.00%";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatCompactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function toneClass(value) {
  if (value > 0) return "tone-positive";
  if (value < 0) return "tone-negative";
  return "tone-neutral";
}

function riskClass(riskLevel) {
  if (riskLevel === "High") return "risk-high";
  if (riskLevel === "Medium") return "risk-medium";
  return "risk-low";
}

function deriveMarketRegime(pulseSummary, rankedSignals) {
  const avgMove = Number(pulseSummary?.avgMove || 0);
  const breadth = String(pulseSummary?.breadth || "").toLowerCase();
  const bullishCount = rankedSignals.filter((row) => row.metrics?.trend === "Bullish").length;
  const bearishCount = rankedSignals.filter((row) => row.metrics?.trend === "Bearish").length;
  const total = rankedSignals.length || 1;
  const bullishShare = bullishCount / total;
  const bearishShare = bearishCount / total;

  const breadthPositive = breadth.includes("positive");
  const breadthNegative = breadth.includes("negative");

  if ((avgMove >= 0.45 && bullishShare >= 0.5) || breadthPositive) {
    return {
      label: "Risk-On",
      detail: "Upside breadth and trend follow-through are dominant.",
      toneClass: "tone-positive",
      chipClass: "status-positive",
    };
  }

  if ((avgMove <= -0.45 && bearishShare >= 0.4) || breadthNegative) {
    return {
      label: "Risk-Off",
      detail: "Defensive conditions with downside pressure across symbols.",
      toneClass: "tone-negative",
      chipClass: "status-negative",
    };
  }

  if (Math.abs(avgMove) <= 0.2) {
    return {
      label: "Rotation",
      detail: "Mixed tape with sector rotation and lower directional conviction.",
      toneClass: "tone-neutral",
      chipClass: "status-neutral",
    };
  }

  return {
    label: "Balanced",
    detail: "Signals are mixed. Prioritize selectivity and risk control.",
    toneClass: "tone-neutral",
    chipClass: "status-neutral",
  };
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(target.isContentEditable);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeStdDev(values) {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
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

function buildFallbackMetrics(candles) {
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

  const closes = candles.map((candle) => Number(candle.close) || 0);
  const highs = candles.map((candle) => Number(candle.high) || 0);
  const lows = candles.map((candle) => Number(candle.low) || 0);
  const volumes = candles.map((candle) => Number(candle.volume) || 0);
  const lastClose = closes.at(-1) || 0;
  const prevClose = closes.at(-2) || lastClose || 1;
  const changePct = ((lastClose - prevClose) / prevClose) * 100;
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const avgVolume = average(volumes);
  const returns = closes
    .slice(1)
    .map((close, index) => (close - closes[index]) / (closes[index] || 1))
    .filter((value) => Number.isFinite(value));
  const volatility = computeStdDev(returns) * Math.sqrt(252) * 100;
  const rsi14 = computeRsi(closes, 14);
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));
  const trend =
    lastClose > sma20 && sma20 > sma50 ? "Bullish" : lastClose < sma20 && sma20 < sma50 ? "Bearish" : "Range-bound";
  const momentum =
    rsi14 >= 70 ? "Overbought" : rsi14 <= 30 ? "Oversold" : rsi14 >= 55 ? "Positive" : rsi14 <= 45 ? "Negative" : "Neutral";

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

function normalizeScanResponse(response) {
  const rawData = response?.data || {};
  const normalizedData = {};
  let legacyMode = false;

  Object.entries(rawData).forEach(([ticker, payload]) => {
    if (Array.isArray(payload)) {
      legacyMode = true;
      const candles = payload;
      normalizedData[ticker] = {
        candles,
        metrics: buildFallbackMetrics(candles),
      };
      return;
    }

    const candles = Array.isArray(payload?.candles) ? payload.candles : [];
    const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : buildFallbackMetrics(candles);
    normalizedData[ticker] = { candles, metrics };
  });

  const fallbackLeaderboard = Object.entries(normalizedData)
    .map(([ticker, payload]) => ({
      ticker,
      score: Number(payload.metrics.signalScore || 50),
      riskLevel: payload.metrics.riskLevel || "Low",
      trend: payload.metrics.trend || "Neutral",
      momentum: payload.metrics.momentum || "Neutral",
      changePct: Number(payload.metrics.changePct || 0),
      performance20: Number(payload.metrics.performance20 || 0),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    data: normalizedData,
    meta: {
      interval: response?.meta?.interval || "unknown",
      outputsize: response?.meta?.outputsize || 0,
      range: response?.meta?.range || "custom",
      leaderboard: response?.meta?.leaderboard || fallbackLeaderboard,
      correlations: response?.meta?.correlations || {},
      legacyMode,
    },
  };
}

function scoreByProfile(metrics, profile) {
  if (!metrics) return 0;
  const base = Number(metrics.signalScore || 50);

  if (profile === "mean_reversion") {
    let score = 50;
    score += metrics.rsi14 < 35 ? 18 : 0;
    score += metrics.rsi14 > 70 ? -18 : 0;
    score += clamp(metrics.distanceToSupportPct * 0.8, -10, 10);
    score += clamp(-metrics.performance5 * 0.9, -15, 15);
    score += metrics.trend === "Range-bound" ? 8 : 0;
    return Math.round(clamp(score, 0, 100));
  }

  if (profile === "breakout") {
    let score = base;
    score += metrics.distanceToResistancePct < 2.5 ? 14 : 0;
    score += metrics.volumeTrend === "Increasing" ? 9 : 0;
    score += clamp(metrics.performance5 * 1.1, -12, 14);
    score += metrics.trend === "Bullish" ? 6 : 0;
    return Math.round(clamp(score, 0, 100));
  }

  let score = base;
  score += clamp(metrics.performance20 * 0.7, -14, 14);
  score += metrics.trend === "Bullish" ? 8 : metrics.trend === "Bearish" ? -8 : 0;
  score += metrics.momentum === "Positive" ? 4 : metrics.momentum === "Negative" ? -4 : 0;
  return Math.round(clamp(score, 0, 100));
}

function SegmentGroup({ options, value, onChange }) {
  return (
    <div className="segment-group">
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        return (
          <button
            key={optionValue}
            type="button"
            className={`segment-button ${value === optionValue ? "active" : ""}`}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value, detail, tone = "tone-neutral" }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className={`metric-value ${tone}`}>{value}</p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function BrandLogo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id="svxGradient" x1="10%" y1="10%" x2="90%" y2="90%">
            <stop offset="0%" stopColor="#6CF2D4" />
            <stop offset="52%" stopColor="#5AA4FF" />
            <stop offset="100%" stopColor="#FF9A6A" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="14" fill="rgba(255,255,255,0.08)" />
        <path
          d="M16 43 L28 29 L36 37 L48 21"
          fill="none"
          stroke="url(#svxGradient)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="48" cy="21" r="4.5" fill="#6CF2D4" />
      </svg>
    </span>
  );
}

function App() {
  const [theme, setTheme] = usePersistentState("sv-theme", "day");
  const [activeWorkspace, setActiveWorkspace] = usePersistentState("sv-workspace-tab", "market");
  const [selectedTickers, setSelectedTickers] = usePersistentState("sv-selected-tickers", DEFAULT_TICKERS);
  const [range, setRange] = usePersistentState("sv-range", "3M");
  const [chartMode, setChartMode] = usePersistentState("sv-chart-mode", "candlestick");
  const [scannerProfile, setScannerProfile] = usePersistentState("sv-scanner-profile", "momentum");
  const [autoRefreshSec, setAutoRefreshSec] = usePersistentState("sv-auto-refresh", 60);
  const [indicatorConfig, setIndicatorConfig] = usePersistentState("sv-indicators", {
    sma20: true,
    sma50: true,
    support: true,
    resistance: true,
  });

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);
  const searchInputRef = useRef(null);

  const [marketData, setMarketData] = useState({});
  const [marketMeta, setMarketMeta] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [scanNotice, setScanNotice] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [backendStatus, setBackendStatus] = useState("checking");
  const [backendDetails, setBackendDetails] = useState("");
  const [backendEndpoint, setBackendEndpoint] = useState("");
  const [focusTicker, setFocusTicker] = useState(selectedTickers[0] || "");
  const scanInFlightRef = useRef(false);

  const [marketPulse, setMarketPulse] = useState([]);
  const [marketPulseSummary, setMarketPulseSummary] = useState(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [pulseError, setPulseError] = useState("");
  const [newsItems, setNewsItems] = useState([]);
  const [newsMeta, setNewsMeta] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");

  const [positions, setPositions] = usePersistentState("sv-portfolio-positions", []);
  const [positionForm, setPositionForm] = useState({ ticker: "", shares: "", avgCost: "" });
  const [quoteSnapshot, setQuoteSnapshot] = useState({});
  const [scenarioMove, setScenarioMove] = useState(5);

  const [riskProfile, setRiskProfile] = useState("balanced");
  const [strategyStyle, setStrategyStyle] = useState("tactical");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiInsight, setAiInsight] = useState(null);
  const [aiMeta, setAiMeta] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHistory, setAiHistory] = usePersistentState("sv-ai-history", []);
  const [backtestConfig, setBacktestConfig] = usePersistentState("sv-backtest-config", {
    ticker: DEFAULT_TICKERS[0],
    range: "1Y",
    fastPeriod: 20,
    slowPeriod: 50,
    initialCapital: 10000,
    feeBps: 5,
  });
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestMeta, setBacktestMeta] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");

  useEffect(() => {
    if (WORKSPACE_ORDER.includes(activeWorkspace)) return;
    setActiveWorkspace("market");
  }, [activeWorkspace, setActiveWorkspace]);

  useEffect(() => {
    if (!Array.isArray(selectedTickers)) {
      setSelectedTickers(DEFAULT_TICKERS);
      return;
    }
    const sanitized = selectedTickers
      .map((item) => (typeof item === "string" ? item : item?.symbol || item?.ticker || ""))
      .map(normalizeTicker)
      .filter(Boolean)
      .slice(0, 8);
    const changed =
      sanitized.length !== selectedTickers.length ||
      sanitized.some((ticker, index) => ticker !== selectedTickers[index]);
    if (changed) {
      setSelectedTickers(sanitized.length ? sanitized : DEFAULT_TICKERS);
    }
  }, [selectedTickers, setSelectedTickers]);

  useEffect(() => {
    document.body.classList.remove("theme-night", "theme-day");
    document.body.classList.add(theme === "day" ? "theme-day" : "theme-night");
  }, [theme]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (selectedTickers.length === 0) {
      setFocusTicker("");
      return;
    }
    if (!selectedTickers.includes(focusTicker)) {
      setFocusTicker(selectedTickers[0]);
    }
  }, [selectedTickers, focusTicker]);

  useEffect(() => {
    const current = normalizeTicker(backtestConfig?.ticker);
    if (current && selectedTickers.includes(current)) return;
    const replacement = focusTicker || selectedTickers[0] || "";
    if (!replacement) return;
    setBacktestConfig((previous) => {
      if (normalizeTicker(previous?.ticker) === replacement) return previous;
      return {
        ...previous,
        ticker: replacement,
      };
    });
  }, [backtestConfig?.ticker, focusTicker, selectedTickers, setBacktestConfig]);

  const updateBackendStatus = useCallback(({ providerHint, status = "online", message = "" } = {}) => {
    const connection = getApiConnectionState();
    const endpoint = connection.activeBase || connection.envBase || "";
    setBackendEndpoint(endpoint);

    if (status === "online") {
      const provider = providerHint || "unknown";
      const detail = message || `API online · provider: ${provider}${endpoint ? ` · ${endpoint}` : ""}`;
      setBackendStatus("online");
      setBackendDetails(detail);
      return;
    }

    setBackendStatus(status);
    setBackendDetails(message || "Backend unavailable");
  }, []);

  const testBackendConnection = useCallback(async () => {
    updateBackendStatus({ status: "checking", message: "Checking backend..." });
    try {
      const health = await fetchBackendHealth();
      updateBackendStatus({
        providerHint: health?.services?.marketDataProvider || "unknown",
        status: "online",
      });
      return true;
    } catch (error) {
      updateBackendStatus({
        status: "offline",
        message: error.message || "Backend unavailable",
      });
      return false;
    }
  }, [updateBackendStatus]);

  useEffect(() => {
    testBackendConnection();
  }, [testBackendConnection]);

  const addTicker = useCallback(
    (rawValue) => {
      const ticker = normalizeTicker(rawValue);
      if (!ticker) return;
      setSelectedTickers((previous) => {
        if (previous.includes(ticker) || previous.length >= 8) return previous;
        return [...previous, ticker];
      });
      setSearchText("");
      setSuggestions([]);
      setShowSuggestions(false);
    },
    [setSelectedTickers]
  );

  const addTickerBatch = useCallback(
    (batchTickers) => {
      setSelectedTickers((previous) => {
        const merged = [...new Set([...previous, ...batchTickers.map(normalizeTicker).filter(Boolean)])];
        return merged.slice(0, 8);
      });
    },
    [setSelectedTickers]
  );

  const removeTicker = useCallback(
    (tickerToRemove) => {
      setSelectedTickers((previous) => previous.filter((ticker) => ticker !== tickerToRemove));
    },
    [setSelectedTickers]
  );

  const runMarketScan = useCallback(async () => {
    if (scanInFlightRef.current) return;
    if (!selectedTickers.length) {
      setDataError("Add at least one ticker to run a market scan.");
      setScanNotice("");
      setMarketData({});
      return;
    }

    scanInFlightRef.current = true;
    setLoadingData(true);
    setDataError("");
    setScanNotice("");
    try {
      const response = await fetchStockCandlesMulti({
        tickers: selectedTickers,
        range,
      });
      if (!response || typeof response !== "object" || !response.data || typeof response.data !== "object") {
        throw new Error("Market scan returned an invalid payload. Use Test Backend and retry.");
      }

      const normalized = normalizeScanResponse(response);
      const availableEntries = Object.entries(normalized.data || {});
      if (!availableEntries.length) {
        throw new Error("Market scan returned no ticker data. Confirm backend health and selected range.");
      }

      setMarketData(normalized.data || {});
      setMarketMeta(normalized.meta || null);
      setLastRefresh(new Date());
      updateBackendStatus({
        providerHint: response?.meta?.provider || "unknown",
        status: "online",
      });

      const missingTickers = selectedTickers.filter((ticker) => !normalized.data[ticker]);
      if (normalized.meta?.partial || missingTickers.length) {
        const missingLabel = missingTickers.length ? ` (${missingTickers.join(", ")})` : "";
        setScanNotice(
          `Partial scan complete: ${availableEntries.length}/${selectedTickers.length} symbols updated${missingLabel}.`
        );
      } else {
        setScanNotice(`Scan complete: ${availableEntries.length}/${selectedTickers.length} symbols updated.`);
      }
    } catch (error) {
      const message = error.message || "Unable to load market data.";
      setDataError(message);
      setScanNotice("");
      if (message.includes("Unable to reach backend API")) {
        updateBackendStatus({
          status: "offline",
          message,
        });
      }
    } finally {
      setLoadingData(false);
      scanInFlightRef.current = false;
    }
  }, [range, selectedTickers, updateBackendStatus]);

  const refreshPulse = useCallback(async () => {
    setPulseLoading(true);
    setPulseError("");
    try {
      const response = await fetchMarketPulse();
      setMarketPulse(response.data || []);
      setMarketPulseSummary(response.summary || null);
    } catch (error) {
      setPulseError(error.message || "Unable to fetch market pulse.");
    } finally {
      setPulseLoading(false);
    }
  }, []);

  const refreshNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError("");
    try {
      const response = await fetchMarketNews({
        tickers: selectedTickers.slice(0, 4),
        limit: 12,
      });
      setNewsItems(response.data || []);
      setNewsMeta(response.meta || null);
    } catch (error) {
      setNewsError(error.message || "Unable to fetch market news.");
    } finally {
      setNewsLoading(false);
    }
  }, [selectedTickers]);

  const refreshPortfolioQuotes = useCallback(async () => {
    const tickers = [...new Set(positions.map((position) => normalizeTicker(position.ticker)).filter(Boolean))];
    if (tickers.length === 0) {
      setQuoteSnapshot({});
      return;
    }

    try {
      const response = await fetchQuoteMulti({ tickers });
      setQuoteSnapshot(response.data || {});
    } catch {
      setQuoteSnapshot((previous) => previous);
    }
  }, [positions]);

  useEffect(() => {
    runMarketScan();
    refreshPulse();
    refreshNews();
  }, [runMarketScan, refreshPulse, refreshNews]);

  useEffect(() => {
    refreshPortfolioQuotes();
  }, [refreshPortfolioQuotes]);

  useEffect(() => {
    if (!autoRefreshSec) return undefined;
    const timer = window.setInterval(() => {
      runMarketScan();
      refreshPulse();
      refreshNews();
      refreshPortfolioQuotes();
    }, Number(autoRefreshSec) * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSec, refreshPortfolioQuotes, refreshPulse, refreshNews, runMarketScan]);

  useEffect(() => {
    if (!searchText || searchText.trim().length < 2) {
      setSuggestions([]);
      return undefined;
    }

    let isCancelled = false;
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const data = await searchSymbols(searchText.trim());
        if (!isCancelled) {
          setSuggestions(data.slice(0, 8));
          setShowSuggestions(true);
        }
      } catch {
        if (!isCancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setSuggestionsLoading(false);
        }
      }
    }, 280);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText]);

  const dataByTicker = useMemo(() => {
    return Object.fromEntries(
      Object.entries(marketData).map(([ticker, payload]) => [ticker, payload?.candles || []])
    );
  }, [marketData]);

  const scanCoverage = useMemo(() => {
    const requested = selectedTickers.length;
    const available = Object.keys(marketData || {}).length;
    return {
      requested,
      available,
    };
  }, [marketData, selectedTickers.length]);

  const focusPayload = focusTicker ? marketData[focusTicker] : null;
  const focusMetrics = focusPayload?.metrics;

  const rankedSignals = useMemo(() => {
    return selectedTickers
      .map((ticker) => {
        const payload = marketData[ticker];
        const metrics = payload?.metrics;
        if (!metrics) return null;
        return {
          ticker,
          metrics,
          profileScore: scoreByProfile(metrics, scannerProfile),
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.profileScore - left.profileScore);
  }, [marketData, scannerProfile, selectedTickers]);

  const averageSignalScore = useMemo(() => {
    if (!rankedSignals.length) return 0;
    const sum = rankedSignals.reduce((acc, row) => acc + row.metrics.signalScore, 0);
    return sum / rankedSignals.length;
  }, [rankedSignals]);

  const averageVolatility = useMemo(() => {
    if (!rankedSignals.length) return 0;
    const sum = rankedSignals.reduce((acc, row) => acc + Number(row.metrics.volatility || 0), 0);
    return sum / rankedSignals.length;
  }, [rankedSignals]);

  const pulseSummary = useMemo(() => {
    if (marketPulseSummary) return marketPulseSummary;
    const advancers = marketPulse.filter((item) => item.percentChange > 0).length;
    const decliners = marketPulse.filter((item) => item.percentChange < 0).length;
    const unchanged = marketPulse.length - advancers - decliners;
    const avgMove =
      marketPulse.reduce((acc, item) => acc + item.percentChange, 0) / (marketPulse.length || 1);
    return {
      advancers,
      decliners,
      unchanged,
      avgMove,
      breadth: "Live breadth",
      leaders: [],
      laggards: [],
    };
  }, [marketPulse, marketPulseSummary]);

  const marketRegime = useMemo(() => deriveMarketRegime(pulseSummary, rankedSignals), [pulseSummary, rankedSignals]);
  const topSignal = rankedSignals[0] || null;
  const aiEngineDisplay = aiMeta?.engine ? String(aiMeta.engine).replace(/-/g, " ") : "standby";
  const aiFutureProjection = useMemo(() => {
    if (!aiInsight || typeof aiInsight !== "object") return null;
    const projection =
      aiInsight.futureProjection && typeof aiInsight.futureProjection === "object"
        ? aiInsight.futureProjection
        : null;
    if (!projection) return null;

    const predictedPrice = toFiniteNumber(projection.predictedPrice);
    const expectedMovePct = toFiniteNumber(projection.expectedMovePct);
    const rangeLow = toFiniteNumber(projection.rangeLow);
    const rangeHigh = toFiniteNumber(projection.rangeHigh);
    const horizonDays = Math.max(1, toFiniteNumber(projection.horizonDays) || 30);
    const uncertaintyPct = toFiniteNumber(projection.uncertaintyPct);
    return {
      predictedPrice,
      expectedMovePct,
      rangeLow,
      rangeHigh,
      horizonDays,
      uncertaintyPct,
      method: projection.method || "model",
    };
  }, [aiInsight]);
  const workspaceTabs = useMemo(
    () => [
      {
        id: "market",
        ...WORKSPACE_INFO.market,
        stat: `${selectedTickers.length} symbols`,
      },
      {
        id: "intelligence",
        ...WORKSPACE_INFO.intelligence,
        stat: `${newsItems.length} headlines`,
      },
      {
        id: "portfolio",
        ...WORKSPACE_INFO.portfolio,
        stat: `${positions.length} positions`,
      },
      {
        id: "strategy",
        ...WORKSPACE_INFO.strategy,
        stat: backtestResult?.summary ? `${backtestResult.summary.trades} trades` : "No run yet",
      },
    ],
    [backtestResult?.summary?.trades, newsItems.length, positions.length, selectedTickers.length]
  );
  const activeWorkspaceInfo = WORKSPACE_INFO[activeWorkspace] || WORKSPACE_INFO.market;

  const signalChecklist = useMemo(() => {
    if (!focusMetrics) return [];
    const list = [];
    if (focusMetrics.trend === "Bullish") list.push("Primary trend is constructive.");
    if (focusMetrics.trend === "Bearish") list.push("Primary trend remains under pressure.");
    if (focusMetrics.momentum === "Overbought") list.push("Momentum stretched; avoid chasing weak entries.");
    if (focusMetrics.momentum === "Oversold") list.push("Momentum compressed; monitor reversal confirmation.");
    if (focusMetrics.volumeTrend === "Increasing") list.push("Volume is expanding and validating moves.");
    if (focusMetrics.distanceToResistancePct < 2) list.push("Price is approaching resistance zone.");
    if (focusMetrics.distanceToSupportPct < 2) list.push("Price is testing nearby support.");

    if (scannerProfile === "breakout") {
      list.push("Breakout profile: prioritize expansion with volume.");
    } else if (scannerProfile === "mean_reversion") {
      list.push("Mean reversion profile: favor stretched conditions into levels.");
    } else {
      list.push("Momentum profile: favor trend continuation and pullback entries.");
    }

    return list.slice(0, 6);
  }, [focusMetrics, scannerProfile]);

  const correlations = marketMeta?.correlations || {};
  const correlationTickers = Object.keys(correlations);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    if (suggestions.length > 0) {
      addTicker(suggestions[0].symbol);
      return;
    }
    addTicker(searchText);
  };

  const exportScanSnapshot = () => {
    if (!rankedSignals.length) return;
    const rows = rankedSignals.map((row) => ({
      ticker: row.ticker,
      profileScore: row.profileScore,
      signalScore: row.metrics.signalScore,
      trend: row.metrics.trend,
      momentum: row.metrics.momentum,
      changePct: Number(row.metrics.changePct || 0).toFixed(2),
      performance20: Number(row.metrics.performance20 || 0).toFixed(2),
      riskLevel: row.metrics.riskLevel,
      timestamp: new Date().toISOString(),
    }));

    const header = Object.keys(rows[0]);
    const csv = [header.join(","), ...rows.map((row) => header.map((key) => row[key]).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `stockvision-scan-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const runBacktestScenario = async () => {
    const ticker = normalizeTicker(backtestConfig.ticker || focusTicker);
    const fast = Number(backtestConfig.fastPeriod);
    const slow = Number(backtestConfig.slowPeriod);
    const capital = Number(backtestConfig.initialCapital);
    const fee = Number(backtestConfig.feeBps);

    if (!ticker) {
      setBacktestError("Select a ticker for backtesting.");
      return;
    }
    if (!Number.isFinite(fast) || !Number.isFinite(slow) || fast < 2 || slow < 3 || fast >= slow) {
      setBacktestError("Use valid fast/slow periods, with fast smaller than slow.");
      return;
    }
    if (!Number.isFinite(capital) || capital <= 0) {
      setBacktestError("Initial capital must be greater than zero.");
      return;
    }

    setBacktestError("");
    setBacktestLoading(true);
    try {
      const response = await runBacktest({
        ticker,
        range: backtestConfig.range,
        fastPeriod: fast,
        slowPeriod: slow,
        initialCapital: capital,
        feeBps: Number.isFinite(fee) ? fee : 5,
      });
      setBacktestResult(response.data || null);
      setBacktestMeta(response.meta || null);
      setBacktestConfig((previous) => ({ ...previous, ticker }));
    } catch (error) {
      setBacktestError(error.message || "Unable to run backtest.");
    } finally {
      setBacktestLoading(false);
    }
  };

  const generateAiBrief = useCallback(async () => {
    if (!focusTicker || !focusPayload) {
      setAiError("Run a market scan first, then select a focus ticker.");
      return;
    }

    const question =
      aiPrompt.trim() ||
      `Build a ${riskProfile} ${strategyStyle} plan for ${focusTicker} using current signals and risk levels.`;

    setAiError("");
    setAiLoading(true);
    try {
      const response = await fetchAiInsight({
        ticker: focusTicker,
        candles: focusPayload.candles,
        metrics: focusPayload.metrics,
        riskProfile,
        question,
        context: {
          strategyStyle,
          scannerProfile,
          pulse: pulseSummary,
          focusFlags: focusMetrics?.signalFlags?.slice(0, 5) || [],
        },
      });
      setAiInsight(response.data || null);
      setAiMeta(response.meta || null);
      setAiHistory((previous) =>
        [
          {
            id: Date.now(),
            ticker: focusTicker,
            prompt: question,
            createdAt: new Date().toISOString(),
            insight: response.data || null,
            meta: response.meta || null,
          },
          ...previous,
        ].slice(0, 8)
      );
    } catch (error) {
      setAiError(error.message || "Unable to generate AI brief.");
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, focusMetrics, focusPayload, focusTicker, pulseSummary, riskProfile, scannerProfile, setAiHistory, strategyStyle]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = String(event.key || "").toLowerCase();
      const editable = isEditableTarget(event.target);

      if (key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        setShowSuggestions(true);
        return;
      }

      if (!editable && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (key === "1") {
          event.preventDefault();
          setActiveWorkspace("market");
          return;
        }
        if (key === "2") {
          event.preventDefault();
          setActiveWorkspace("intelligence");
          return;
        }
        if (key === "3") {
          event.preventDefault();
          setActiveWorkspace("portfolio");
          return;
        }
        if (key === "4") {
          event.preventDefault();
          setActiveWorkspace("strategy");
          return;
        }
      }

      if (editable || event.repeat) return;
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;

      if (key === "s") {
        event.preventDefault();
        runMarketScan();
      } else if (key === "p") {
        event.preventDefault();
        refreshPulse();
      } else if (key === "n") {
        event.preventDefault();
        refreshNews();
      } else if (key === "b") {
        event.preventDefault();
        generateAiBrief();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [generateAiBrief, refreshNews, refreshPulse, runMarketScan, setActiveWorkspace]);

  const handleAddPosition = (event) => {
    event.preventDefault();
    const ticker = normalizeTicker(positionForm.ticker);
    const shares = Number(positionForm.shares);
    const avgCost = Number(positionForm.avgCost);

    if (!ticker || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(avgCost) || avgCost <= 0) {
      return;
    }

    setPositions((previous) => {
      const existingIndex = previous.findIndex((position) => normalizeTicker(position.ticker) === ticker);
      if (existingIndex === -1) {
        return [...previous, { ticker, shares, avgCost }];
      }

      const existing = previous[existingIndex];
      const combinedShares = existing.shares + shares;
      const weightedCost =
        combinedShares > 0
          ? (existing.shares * existing.avgCost + shares * avgCost) / combinedShares
          : existing.avgCost;

      const updated = [...previous];
      updated[existingIndex] = {
        ticker,
        shares: Number(combinedShares.toFixed(4)),
        avgCost: Number(weightedCost.toFixed(4)),
      };
      return updated;
    });

    setPositionForm({ ticker: "", shares: "", avgCost: "" });
  };

  const basePortfolioRows = useMemo(() => {
    return positions.map((position, index) => {
      const ticker = normalizeTicker(position.ticker);
      const metrics = marketData[ticker]?.metrics;
      const mark =
        metrics?.lastClose ||
        quoteSnapshot[ticker]?.price ||
        marketPulse.find((item) => item.symbol === ticker)?.price ||
        0;
      const marketValue = mark * position.shares;
      const costBasis = position.shares * position.avgCost;
      const pnl = marketValue - costBasis;
      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

      return {
        id: `${ticker}-${index}`,
        ticker,
        shares: position.shares,
        avgCost: position.avgCost,
        mark,
        marketValue,
        costBasis,
        pnl,
        pnlPct,
        volatility: metrics?.volatility || 26,
      };
    });
  }, [positions, marketData, quoteSnapshot, marketPulse]);

  const portfolioTotals = useMemo(() => {
    return basePortfolioRows.reduce(
      (totals, row) => {
        totals.marketValue += row.marketValue;
        totals.costBasis += row.costBasis;
        totals.pnl += row.pnl;
        return totals;
      },
      { marketValue: 0, costBasis: 0, pnl: 0 }
    );
  }, [basePortfolioRows]);

  const portfolioRows = useMemo(() => {
    return basePortfolioRows.map((row) => {
      const weight = portfolioTotals.marketValue > 0 ? row.marketValue / portfolioTotals.marketValue : 0;
      const dailyStd = (row.volatility / 100) / Math.sqrt(252);
      const varContribution = row.marketValue * 1.65 * dailyStd;
      return { ...row, weight, varContribution };
    });
  }, [basePortfolioRows, portfolioTotals.marketValue]);

  const portfolioDailyVar95 = useMemo(() => {
    const variance = portfolioRows.reduce(
      (sum, row) => sum + row.varContribution * row.varContribution,
      0
    );
    return Math.sqrt(variance);
  }, [portfolioRows]);

  const concentrationStats = useMemo(() => {
    const sorted = portfolioRows.slice().sort((left, right) => right.weight - left.weight);
    const top1 = sorted[0]?.weight || 0;
    const top3 = sorted.slice(0, 3).reduce((sum, row) => sum + row.weight, 0);
    return { top1, top3 };
  }, [portfolioRows]);

  const rebalanceRows = useMemo(() => {
    if (portfolioRows.length === 0 || portfolioTotals.marketValue <= 0) return [];
    const targetValue = portfolioTotals.marketValue / portfolioRows.length;

    return portfolioRows.map((row) => {
      const deltaValue = targetValue - row.marketValue;
      const deltaShares = row.mark > 0 ? deltaValue / row.mark : 0;
      return {
        ticker: row.ticker,
        targetValue,
        deltaValue,
        deltaShares,
      };
    });
  }, [portfolioRows, portfolioTotals.marketValue]);

  const projectedValue = portfolioTotals.marketValue * (1 + scenarioMove / 100);
  const projectedMove = projectedValue - portfolioTotals.marketValue;
  const scenarioGrid = [-15, -10, -5, 0, 5, 10, 15].map((move) => {
    const nextValue = portfolioTotals.marketValue * (1 + move / 100);
    return {
      move,
      value: nextValue,
      pnl: nextValue - portfolioTotals.marketValue,
    };
  });
  const backtestTickerOptions = [...new Set([...selectedTickers, ...positions.map((p) => normalizeTicker(p.ticker)).filter(Boolean)])];
  const backtestCurve = backtestResult?.equityCurve || [];
  const curveValues = backtestCurve.map((point) => point.value);
  const curveMin = curveValues.length ? Math.min(...curveValues) : 0;
  const curveMax = curveValues.length ? Math.max(...curveValues) : 0;
  const curveRange = Math.max(1, curveMax - curveMin);

  return (
    <div className="app-shell" data-workspace={activeWorkspace}>
      <div className="ambient-backdrop" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>

      <motion.header
        className="glass-card topbar"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={STAGGER_ITEM}
      >
        <div className="brand-wrap">
          <BrandLogo />
          <div>
            <p className="brand-title">StockVision X</p>
            <p className="brand-subtitle">AI Trading Command Center</p>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-meta">
            <span className={`status-chip ${marketRegime.chipClass}`}>{marketRegime.label}</span>
            <span
              className={`status-chip ${
                backendStatus === "online"
                  ? "status-positive"
                  : backendStatus === "offline"
                  ? "status-negative"
                  : "status-neutral"
              }`}
            >
              API {backendStatus}
            </span>
            <span className="status-chip status-neutral">
              Auto {autoRefreshSec ? `${autoRefreshSec}s` : "manual"}
            </span>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((previous) => (previous === "night" ? "day" : "night"))}
          >
            {theme === "night" ? "Switch To Daylight" : "Switch To Afterhours"}
          </button>
        </div>
      </motion.header>

      <motion.section
        className="hero-panel"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...STAGGER_ITEM, delay: 0.1 }}
      >
        <p className="hero-eyebrow">Deeper Feature Suite</p>
        <h1>Scan, rank, correlate, strategize, and rebalance from one control layer.</h1>
        <p>
          Every module now has expanded depth: profile-driven signal scoring, correlation analytics, tactical AI
          levels, and portfolio risk decomposition.
        </p>
        <div className="hero-stats">
          <div>
            <span>{selectedTickers.length}</span>
            <p>Tracked Symbols</p>
          </div>
          <div>
            <span>{averageSignalScore.toFixed(1)}</span>
            <p>Avg Signal Score</p>
          </div>
          <div>
            <span>{lastRefresh ? lastRefresh.toLocaleTimeString() : "--:--"}</span>
            <p>Last Scan</p>
          </div>
          <div>
            <span>{autoRefreshSec ? `${autoRefreshSec}s` : "Manual"}</span>
            <p>Refresh Cadence</p>
          </div>
        </div>
      </motion.section>

      <motion.section
        className="glass-card ops-ribbon"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...STAGGER_ITEM, delay: 0.12 }}
      >
        <div className="ops-grid">
          <div className="ops-metric">
            <p>Market Regime</p>
            <h3 className={marketRegime.toneClass}>{marketRegime.label}</h3>
            <small>{marketRegime.detail}</small>
          </div>
          <div className="ops-metric">
            <p>Lead Setup</p>
            <h3>{topSignal ? `${topSignal.ticker} · ${topSignal.profileScore}` : "--"}</h3>
            <small>{topSignal ? `${topSignal.metrics.trend} / ${topSignal.metrics.momentum}` : "Run a scan to rank setups."}</small>
          </div>
          <div className="ops-metric">
            <p>Heat + Breadth</p>
            <h3 className={toneClass(pulseSummary.avgMove || 0)}>{formatPercent(pulseSummary.avgMove || 0)}</h3>
            <small>
              {pulseSummary.advancers || 0} advancers / {pulseSummary.decliners || 0} decliners
            </small>
          </div>
          <div className="ops-metric">
            <p>AI Engine</p>
            <h3>{aiEngineDisplay}</h3>
            <small>Volatility map: {formatPercent(averageVolatility)}</small>
          </div>
        </div>
        <div className="ops-actions">
          <button type="button" className="ghost-action ops-action" onClick={runMarketScan} disabled={loadingData}>
            <span>{loadingData ? "Scanning..." : "Run Scan"}</span>
            <kbd>Shift+S</kbd>
          </button>
          <button type="button" className="ghost-action ops-action" onClick={refreshPulse} disabled={pulseLoading}>
            <span>Pulse</span>
            <kbd>Shift+P</kbd>
          </button>
          <button type="button" className="ghost-action ops-action" onClick={refreshNews} disabled={newsLoading}>
            <span>News</span>
            <kbd>Shift+N</kbd>
          </button>
          <button type="button" className="ghost-action ops-action" onClick={generateAiBrief} disabled={aiLoading}>
            <span>AI Brief</span>
            <kbd>Shift+B</kbd>
          </button>
        </div>
        <p className="shortcut-copy">Press "/" to jump to ticker search instantly.</p>
      </motion.section>

      <section className="glass-card workspace-nav">
        <div className="workspace-nav-head">
          <div>
            <h2>{activeWorkspaceInfo.label}</h2>
            <p>{activeWorkspaceInfo.hint}</p>
          </div>
          <p className="workspace-shortcuts">Alt+1/2/3/4 to switch workspace</p>
        </div>
        <div className="workspace-tablist" role="tablist" aria-label="Workspace tabs">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeWorkspace === tab.id}
              className={`workspace-tab ${activeWorkspace === tab.id ? "active" : ""}`}
              onClick={() => setActiveWorkspace(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.hint}</small>
              <em>{tab.stat}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="main-grid workspace-section section-main">
        <motion.div
          className="glass-card command-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.15 }}
        >
          <div className="section-head">
            <h2>Command Deck</h2>
            <p>Discovery, presets, profile tuning, and scan cadence in one console.</p>
          </div>
          <p className={`backend-status ${backendStatus}`}>
            {backendDetails || (backendStatus === "checking" ? "Checking backend..." : "")}
          </p>
          <div className="deck-health-grid">
            <div>
              <span>Endpoint</span>
              <strong>{backendEndpoint || "--"}</strong>
            </div>
            <div>
              <span>Coverage</span>
              <strong>
                {scanCoverage.available}/{scanCoverage.requested}
              </strong>
            </div>
            <div>
              <span>Last Scan</span>
              <strong>{lastRefresh ? lastRefresh.toLocaleTimeString() : "--:--"}</strong>
            </div>
          </div>

          <form className="search-form" ref={suggestionsRef} onSubmit={handleSearchSubmit}>
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search ticker or company (e.g. NVIDIA, TSLA)"
            />
            <button type="submit">{suggestionsLoading ? "..." : "Add"}</button>
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-list">
                {suggestions.map((item) => (
                  <button
                    key={`${item.symbol}-${item.exchange}`}
                    type="button"
                    className="suggestion-item"
                    onClick={() => addTicker(item.symbol)}
                  >
                    <span>{item.symbol}</span>
                    <small>
                      {item.name} · {item.exchange}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="chip-wrap">
            {selectedTickers.map((ticker) => (
              <div key={ticker} className="ticker-chip">
                <button type="button" className="ticker-chip-main" onClick={() => setFocusTicker(ticker)}>
                  {ticker}
                </button>
                <button type="button" className="ticker-chip-remove" onClick={() => removeTicker(ticker)}>
                  ×
                </button>
              </div>
            ))}
            {selectedTickers.length === 0 && <p className="hint-text">No symbols selected yet.</p>}
          </div>

          <div className="basket-row">
            {BASKET_PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="basket-chip" onClick={() => addTickerBatch(preset.tickers)}>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="control-row control-row-3">
            <div>
              <label>Range</label>
              <SegmentGroup options={RANGE_OPTIONS} value={range} onChange={setRange} />
            </div>
            <div>
              <label>Chart</label>
              <SegmentGroup options={MODE_OPTIONS} value={chartMode} onChange={setChartMode} />
            </div>
            <div>
              <label>Scanner Profile</label>
              <SegmentGroup options={SCANNER_PROFILE_OPTIONS} value={scannerProfile} onChange={setScannerProfile} />
            </div>
          </div>

          <div className="control-row control-row-2">
            <div>
              <label>Auto Refresh</label>
              <SegmentGroup options={AUTO_REFRESH_OPTIONS} value={autoRefreshSec} onChange={setAutoRefreshSec} />
            </div>
            <div>
              <label>Indicator Overlays</label>
              <div className="indicator-row">
                {INDICATOR_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`segment-button ${indicatorConfig[item.key] ? "active" : ""}`}
                    onClick={() =>
                      setIndicatorConfig((previous) => ({
                        ...previous,
                        [item.key]: !previous[item.key],
                      }))
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="command-actions">
            <button type="button" className="primary-action" onClick={runMarketScan} disabled={loadingData}>
              <span>{loadingData ? "Scanning..." : "Run Market Scan"}</span>
              {!loadingData ? <kbd>Shift+S</kbd> : null}
            </button>
            <button
              type="button"
              className="ghost-action diagnostic-action"
              onClick={testBackendConnection}
              disabled={backendStatus === "checking"}
            >
              <span>{backendStatus === "checking" ? "Testing..." : "Test Backend"}</span>
            </button>
            <button type="button" className="ghost-action" onClick={refreshPulse} disabled={pulseLoading}>
              <span>Refresh Pulse</span>
              <kbd>Shift+P</kbd>
            </button>
            <button type="button" className="ghost-action" onClick={refreshNews} disabled={newsLoading}>
              <span>{newsLoading ? "Loading News..." : "Refresh News"}</span>
              {!newsLoading ? <kbd>Shift+N</kbd> : null}
            </button>
            <button type="button" className="ghost-action" onClick={exportScanSnapshot} disabled={!rankedSignals.length}>
              <span>Export Scan CSV</span>
            </button>
          </div>

          {dataError && <p className="error-text">{dataError}</p>}
          {scanNotice && !dataError && <p className="scan-note">{scanNotice}</p>}
          {pulseError && <p className="error-text">{pulseError}</p>}
          {newsError && <p className="error-text">{newsError}</p>}
          {marketMeta?.legacyMode && (
            <p className="hint-text">
              Connected backend is on an older API format. Compatibility mode is active.
            </p>
          )}
        </motion.div>

        <motion.div
          className="glass-card pulse-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.2 }}
        >
          <div className="section-head">
            <h2>Market Pulse</h2>
            <p>Breadth summary, leaders/laggards, and real-time directional heat.</p>
          </div>

          <div className="pulse-summary-grid">
            <div>
              <span>Advancers</span>
              <strong>{pulseSummary.advancers || 0}</strong>
            </div>
            <div>
              <span>Decliners</span>
              <strong>{pulseSummary.decliners || 0}</strong>
            </div>
            <div>
              <span>Avg Move</span>
              <strong className={toneClass(pulseSummary.avgMove)}>{formatPercent(pulseSummary.avgMove || 0)}</strong>
            </div>
            <div>
              <span>Breadth</span>
              <strong>{pulseSummary.breadth || "N/A"}</strong>
            </div>
          </div>

          <div className="pulse-list">
            {pulseLoading && marketPulse.length === 0
              ? Array.from({ length: 4 }).map((_, index) => (
                  <div key={`pulse-skeleton-${index}`} className="pulse-item pulse-skeleton">
                    <span className="skeleton-line short" />
                    <span className="skeleton-line medium" />
                    <span className="skeleton-line long" />
                  </div>
                ))
              : marketPulse.map((item) => (
                  <div key={item.symbol} className="pulse-item">
                    <div className="pulse-headline">
                      <p>{item.symbol}</p>
                      <span className={toneClass(item.percentChange)}>{formatPercent(item.percentChange)}</span>
                    </div>
                    <h4>{formatCurrency(item.price)}</h4>
                    <div className="pulse-bar-track">
                      <span
                        className={`pulse-bar-fill ${item.percentChange >= 0 ? "up" : "down"}`}
                        style={{ width: `${Math.min(100, Math.abs(item.percentChange) * 14)}%` }}
                      />
                    </div>
                  </div>
                ))}
            {!pulseLoading && marketPulse.length === 0 && <p className="hint-text">No pulse data yet.</p>}
          </div>

          {(pulseSummary.leaders?.length || pulseSummary.laggards?.length) && (
            <div className="leader-laggard-grid">
              <div>
                <h4>Leaders</h4>
                <ul>
                  {(pulseSummary.leaders || []).map((item) => (
                    <li key={`leader-${item.symbol}`}>
                      {item.symbol} <span className="tone-positive">{formatPercent(item.percentChange)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Laggards</h4>
                <ul>
                  {(pulseSummary.laggards || []).map((item) => (
                    <li key={`laggard-${item.symbol}`}>
                      {item.symbol} <span className="tone-negative">{formatPercent(item.percentChange)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </motion.div>
      </section>

      <section className="analysis-grid workspace-section section-analysis">
        <motion.div
          className="glass-card chart-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.25 }}
        >
          <div className="section-head inline">
            <div>
              <h2>Multi-Asset Chart Arena</h2>
              <p>
                {marketMeta
                  ? `${marketMeta.range} · ${marketMeta.interval} · ${marketMeta.outputsize} bars`
                  : "Run a scan to initialize chart data."}
              </p>
            </div>
            <div className="legend-wrap">
              {Object.keys(dataByTicker).map((ticker) => (
                <button
                  key={ticker}
                  type="button"
                  className={`legend-pill ${focusTicker === ticker ? "active" : ""}`}
                  onClick={() => setFocusTicker(ticker)}
                >
                  {ticker}
                </button>
              ))}
            </div>
          </div>
          {Object.keys(dataByTicker).length > 0 ? (
            <AdvancedChart
              dataByTicker={dataByTicker}
              mode={chartMode}
              theme={theme}
              focusTicker={focusTicker}
              focusMetrics={focusMetrics}
              indicators={indicatorConfig}
            />
          ) : (
            <div className="empty-state">No chart data available. Add symbols and run a market scan.</div>
          )}

          {correlationTickers.length > 1 && (
            <div className="correlation-panel">
              <h3>Cross-Correlation Matrix</h3>
              <div className="correlation-table-wrap">
                <table className="correlation-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      {correlationTickers.map((ticker) => (
                        <th key={`head-${ticker}`}>{ticker}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationTickers.map((rowTicker) => (
                      <tr key={`row-${rowTicker}`}>
                        <th>{rowTicker}</th>
                        {correlationTickers.map((colTicker) => {
                          const value = correlations[rowTicker]?.[colTicker] ?? 0;
                          return (
                            <td key={`${rowTicker}-${colTicker}`} className={toneClass(value)}>
                              {Number(value).toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>

        <div className="side-stack">
          <motion.div
            className="glass-card metrics-panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...STAGGER_ITEM, delay: 0.3 }}
          >
            <div className="section-head inline">
              <div>
                <h2>Signal Matrix</h2>
                <p>Ranked scorecard with profile-specific ranking.</p>
              </div>
              <select value={focusTicker} onChange={(event) => setFocusTicker(event.target.value)}>
                {selectedTickers.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </div>

            {rankedSignals.length > 0 ? (
              <div className="signal-table-wrap">
                <table className="signal-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Profile</th>
                      <th>Trend</th>
                      <th>RSI</th>
                      <th>1M</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedSignals.map((row) => (
                      <tr key={row.ticker} onClick={() => setFocusTicker(row.ticker)}>
                        <td className={focusTicker === row.ticker ? "focus-row" : ""}>{row.ticker}</td>
                        <td>{row.profileScore}</td>
                        <td>{row.metrics.trend}</td>
                        <td>{row.metrics.rsi14.toFixed(1)}</td>
                        <td className={toneClass(row.metrics.performance20)}>
                          {formatPercent(row.metrics.performance20)}
                        </td>
                        <td>
                          <span className={`risk-pill ${riskClass(row.metrics.riskLevel)}`}>{row.metrics.riskLevel}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint-text">Metrics will populate after the first scan.</p>
            )}

            {focusMetrics && (
              <div className="metrics-grid">
                <MetricCard label="Last Price" value={formatCurrency(focusMetrics.lastClose)} detail="Latest close" />
                <MetricCard
                  label="Daily Move"
                  value={formatPercent(focusMetrics.changePct)}
                  detail="Close-to-close"
                  tone={toneClass(focusMetrics.changePct)}
                />
                <MetricCard
                  label="Volatility"
                  value={formatPercent(focusMetrics.volatility)}
                  detail="Annualized"
                />
                <MetricCard label="ATR(14)" value={focusMetrics.atr14.toFixed(2)} detail={formatPercent(focusMetrics.atrPct)} />
                <MetricCard label="Signal Score" value={String(focusMetrics.signalScore)} detail="Composite rank" />
                <MetricCard label="Max Drawdown" value={formatPercent(-focusMetrics.maxDrawdown)} detail="Lookback peak-to-trough" />
              </div>
            )}
          </motion.div>

          <motion.div
            className="glass-card radar-panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...STAGGER_ITEM, delay: 0.33 }}
          >
            <h3>Risk Radar</h3>
            {focusMetrics ? (
              <>
                <div className="radar-list">
                  <div>
                    <span>Support</span>
                    <strong>{formatCurrency(focusMetrics.support)}</strong>
                  </div>
                  <div>
                    <span>Resistance</span>
                    <strong>{formatCurrency(focusMetrics.resistance)}</strong>
                  </div>
                  <div>
                    <span>SMA 20 / 50</span>
                    <strong>
                      {formatCurrency(focusMetrics.sma20)} / {formatCurrency(focusMetrics.sma50)}
                    </strong>
                  </div>
                  <div>
                    <span>Volume Regime</span>
                    <strong>{focusMetrics.volumeTrend}</strong>
                  </div>
                </div>

                <div className="checklist-panel">
                  <h4>Thesis Checklist</h4>
                  <ul>
                    {signalChecklist.map((item, index) => (
                      <li key={`check-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="flag-panel">
                  {(focusMetrics.signalFlags || []).map((flag) => (
                    <span key={flag} className="flag-chip">
                      {flag}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="hint-text">No risk radar yet.</p>
            )}
          </motion.div>
        </div>
      </section>

      <section className="bottom-grid workspace-section section-bottom">
        <motion.div
          className="glass-card ai-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.36 }}
        >
          <div className="section-head">
            <h2>AI Strategy Copilot</h2>
            <p>Tactical levels + structured brief history with reusable prompt shortcuts.</p>
          </div>

          <div className="ai-controls">
            <div>
              <label>Risk Profile</label>
              <SegmentGroup options={RISK_OPTIONS} value={riskProfile} onChange={setRiskProfile} />
            </div>
            <div>
              <label>Strategy Style</label>
              <SegmentGroup options={STRATEGY_STYLE_OPTIONS} value={strategyStyle} onChange={setStrategyStyle} />
            </div>
            <div>
              <label>Quick Prompt Library</label>
              <div className="quick-prompt-row">
                {QUICK_PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" className="basket-chip" onClick={() => setAiPrompt(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label>Prompt</label>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Ask for entry sequencing, risk laddering, hedge conditions, and invalidation logic."
              />
            </div>
          </div>

          <button type="button" className="primary-action" onClick={generateAiBrief} disabled={aiLoading}>
            <span>{aiLoading ? "Generating Brief..." : "Generate AI Brief"}</span>
            {!aiLoading ? <kbd>Shift+B</kbd> : null}
          </button>
          {aiError && <p className="error-text">{aiError}</p>}

          {aiInsight && (
            <div className="ai-output">
              <p className="ai-meta">
                Engine: {aiMeta?.engine || "unknown"} {aiMeta?.model ? `· ${aiMeta.model}` : ""}
              </p>
              <h4>{aiInsight.summary}</h4>

              <div className="tactical-levels">
                <div>
                  <span>Entry Zone</span>
                  <strong>{aiInsight?.tacticalLevels?.entryZone || "N/A"}</strong>
                </div>
                <div>
                  <span>Invalidation</span>
                  <strong>{aiInsight?.tacticalLevels?.invalidation || "N/A"}</strong>
                </div>
                <div>
                  <span>First Target</span>
                  <strong>{aiInsight?.tacticalLevels?.firstTarget || "N/A"}</strong>
                </div>
              </div>

              <div className="future-projection">
                <div className="projection-card projection-primary">
                  <span>Future Price Prediction</span>
                  <strong>
                    {toFiniteNumber(aiFutureProjection?.predictedPrice) !== null
                      ? formatCurrency(aiFutureProjection.predictedPrice)
                      : "N/A"}
                  </strong>
                  <small>{aiFutureProjection ? `${aiFutureProjection.horizonDays}-day horizon` : "Horizon unavailable"}</small>
                </div>
                <div className="projection-card">
                  <span>Expected Move</span>
                  <strong className={toneClass(aiFutureProjection?.expectedMovePct || 0)}>
                    {toFiniteNumber(aiFutureProjection?.expectedMovePct) !== null
                      ? formatPercent(aiFutureProjection.expectedMovePct)
                      : "N/A"}
                  </strong>
                </div>
                <div className="projection-card">
                  <span>Projected Range</span>
                  <strong>
                    {toFiniteNumber(aiFutureProjection?.rangeLow) !== null &&
                    toFiniteNumber(aiFutureProjection?.rangeHigh) !== null
                      ? `${formatCurrency(aiFutureProjection.rangeLow)} - ${formatCurrency(
                          aiFutureProjection.rangeHigh
                        )}`
                      : "N/A"}
                  </strong>
                </div>
                <div className="projection-card">
                  <span>Prediction Model</span>
                  <strong>{aiFutureProjection?.method || aiMeta?.engine || "heuristic"}</strong>
                  {toFiniteNumber(aiFutureProjection?.uncertaintyPct) !== null ? (
                    <small>Band ±{aiFutureProjection.uncertaintyPct.toFixed(2)}%</small>
                  ) : null}
                </div>
              </div>

              <div className="ai-grid">
                <div>
                  <h5>Setups</h5>
                  <ul>
                    {aiInsight.setups?.map((item, index) => (
                      <li key={`setup-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5>Risks</h5>
                  <ul>
                    {aiInsight.risks?.map((item, index) => (
                      <li key={`risk-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5>Catalysts</h5>
                  <ul>
                    {aiInsight.catalysts?.map((item, index) => (
                      <li key={`catalyst-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5>Action Items</h5>
                  <ul>
                    {aiInsight.actionItems?.map((item, index) => (
                      <li key={`action-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="confidence-text">Confidence: {Number(aiInsight.confidence || 0).toFixed(0)} / 100</p>
              <p className="hint-text">
                Educational context only. Validate with your own research, liquidity checks, and risk limits.
              </p>
            </div>
          )}

          {aiHistory.length > 0 && (
            <div className="ai-history">
              <h4>Recent Briefs</h4>
              <div className="ai-history-list">
                {aiHistory.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setFocusTicker(entry.ticker);
                      setAiPrompt(entry.prompt);
                      setAiInsight(entry.insight);
                      setAiMeta(entry.meta);
                    }}
                  >
                    <strong>{entry.ticker}</strong>
                    <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                    <p>{entry.prompt}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        <motion.div
          className="glass-card portfolio-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.4 }}
        >
          <div className="section-head">
            <h2>Portfolio Lab</h2>
            <p>Live P/L, concentration analytics, VaR, rebalancing targets, and scenario lattice.</p>
          </div>

          <form className="portfolio-form" onSubmit={handleAddPosition}>
            <input
              value={positionForm.ticker}
              placeholder="Ticker"
              onChange={(event) => setPositionForm((prev) => ({ ...prev, ticker: event.target.value }))}
            />
            <input
              value={positionForm.shares}
              type="number"
              min="0"
              step="0.01"
              placeholder="Shares"
              onChange={(event) => setPositionForm((prev) => ({ ...prev, shares: event.target.value }))}
            />
            <input
              value={positionForm.avgCost}
              type="number"
              min="0"
              step="0.01"
              placeholder="Avg Cost"
              onChange={(event) => setPositionForm((prev) => ({ ...prev, avgCost: event.target.value }))}
            />
            <button type="submit">Add</button>
          </form>

          <div className="portfolio-table">
            <div className="portfolio-head portfolio-head-depth">
              <span>Ticker</span>
              <span>Shares</span>
              <span>Weight</span>
              <span>Mark</span>
              <span>P/L</span>
              <span />
            </div>
            {portfolioRows.map((row) => (
              <div key={row.id} className="portfolio-row portfolio-row-depth">
                <span>{row.ticker}</span>
                <span>{row.shares}</span>
                <span>{formatPercent(row.weight * 100)}</span>
                <span>{formatCurrency(row.mark)}</span>
                <span className={toneClass(row.pnlPct)}>
                  {formatCurrency(row.pnl)} ({formatPercent(row.pnlPct)})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPositions((previous) => previous.filter((position) => normalizeTicker(position.ticker) !== row.ticker));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            {portfolioRows.length === 0 && <p className="hint-text">No positions yet. Add holdings to begin stress testing.</p>}
          </div>

          <div className="portfolio-summary portfolio-summary-4">
            <div>
              <span>Total Value</span>
              <strong>{formatCurrency(portfolioTotals.marketValue)}</strong>
            </div>
            <div>
              <span>Total Cost</span>
              <strong>{formatCurrency(portfolioTotals.costBasis)}</strong>
            </div>
            <div>
              <span>Unrealized</span>
              <strong className={toneClass(portfolioTotals.pnl)}>
                {formatCurrency(portfolioTotals.pnl)} (
                {formatPercent(
                  portfolioTotals.costBasis > 0 ? (portfolioTotals.pnl / portfolioTotals.costBasis) * 100 : 0
                )}
                )
              </strong>
            </div>
            <div>
              <span>Daily VaR (95%)</span>
              <strong>{formatCurrency(portfolioDailyVar95)}</strong>
            </div>
          </div>

          <div className="concentration-grid">
            <div>
              <span>Top Position</span>
              <strong>{formatPercent(concentrationStats.top1 * 100)}</strong>
            </div>
            <div>
              <span>Top 3 Concentration</span>
              <strong>{formatPercent(concentrationStats.top3 * 100)}</strong>
            </div>
            <div>
              <span>Positions</span>
              <strong>{portfolioRows.length}</strong>
            </div>
          </div>

          {rebalanceRows.length > 1 && (
            <div className="rebalance-panel">
              <h4>Equal-Weight Rebalance Guide</h4>
              <div className="rebalance-list">
                {rebalanceRows.map((row) => (
                  <div key={`rebalance-${row.ticker}`}>
                    <span>{row.ticker}</span>
                    <span className={toneClass(-row.deltaValue)}>
                      {row.deltaValue >= 0 ? "Buy" : "Trim"} {formatCompactNumber(Math.abs(row.deltaShares))} sh
                    </span>
                    <strong>{formatCurrency(Math.abs(row.deltaValue))}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="scenario-block">
            <label htmlFor="scenario-slider">Scenario Shock: {scenarioMove > 0 ? "+" : ""}{scenarioMove}%</label>
            <input
              id="scenario-slider"
              type="range"
              min="-25"
              max="25"
              value={scenarioMove}
              onChange={(event) => setScenarioMove(Number(event.target.value))}
            />
            <p className="hint-text">
              Projected Value: {formatCurrency(projectedValue)} ({projectedMove >= 0 ? "+" : ""}
              {formatCurrency(projectedMove)})
            </p>
          </div>

          <div className="scenario-grid">
            {scenarioGrid.map((scenario) => (
              <div key={`scenario-${scenario.move}`}>
                <span>{scenario.move > 0 ? "+" : ""}{scenario.move}%</span>
                <strong>{formatCurrency(scenario.value)}</strong>
                <p className={toneClass(scenario.pnl)}>
                  {scenario.pnl >= 0 ? "+" : ""}
                  {formatCurrency(scenario.pnl)}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="extras-grid workspace-section section-extras">
        <motion.div
          className="glass-card news-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.43 }}
        >
          <div className="section-head inline">
            <div>
              <h2>News Radar</h2>
              <p>Free live headlines anchored to your active symbols.</p>
            </div>
            <button type="button" className="ghost-action" onClick={refreshNews} disabled={newsLoading}>
              {newsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {newsMeta?.queries?.length ? (
            <p className="hint-text">
              Coverage: {newsMeta.queries.join(" · ")}
            </p>
          ) : null}

          <div className="news-list">
            {newsLoading && newsItems.length === 0
              ? Array.from({ length: 4 }).map((_, index) => (
                  <div key={`news-skeleton-${index}`} className="news-item news-skeleton">
                    <span className="skeleton-line long" />
                    <span className="skeleton-line medium" />
                    <span className="skeleton-line short" />
                  </div>
                ))
              : newsItems.slice(0, 12).map((item) => (
                  <a
                    key={item.id}
                    href={item.link || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="news-item"
                  >
                    <h4>{item.title}</h4>
                    <p>
                      {item.publisher} · {formatDateTime(item.publishedAt)}
                    </p>
                    {item.relatedTickers?.length ? (
                      <div className="news-tags">
                        {item.relatedTickers.slice(0, 4).map((ticker) => (
                          <span key={`${item.id}-${ticker}`}>{ticker}</span>
                        ))}
                      </div>
                    ) : null}
                  </a>
                ))}
            {!newsLoading && !newsItems.length ? <p className="hint-text">No headlines available right now.</p> : null}
          </div>
        </motion.div>

        <motion.div
          className="glass-card backtest-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.46 }}
        >
          <div className="section-head">
            <h2>Strategy Lab</h2>
            <p>SMA crossover backtest using free market data, no paid API required.</p>
          </div>

          <div className="backtest-controls">
            <div>
              <label>Ticker</label>
              <select
                value={backtestConfig.ticker}
                onChange={(event) =>
                  setBacktestConfig((previous) => ({
                    ...previous,
                    ticker: event.target.value,
                  }))
                }
              >
                {backtestTickerOptions.map((ticker) => (
                  <option key={`backtest-${ticker}`} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Range</label>
              <SegmentGroup
                options={BACKTEST_RANGE_OPTIONS}
                value={backtestConfig.range}
                onChange={(value) =>
                  setBacktestConfig((previous) => ({
                    ...previous,
                    range: value,
                  }))
                }
              />
            </div>
            <div className="backtest-row">
              <div>
                <label>Fast</label>
                <input
                  type="number"
                  min="2"
                  value={backtestConfig.fastPeriod}
                  onChange={(event) =>
                    setBacktestConfig((previous) => ({
                      ...previous,
                      fastPeriod: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label>Slow</label>
                <input
                  type="number"
                  min="3"
                  value={backtestConfig.slowPeriod}
                  onChange={(event) =>
                    setBacktestConfig((previous) => ({
                      ...previous,
                      slowPeriod: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label>Capital</label>
                <input
                  type="number"
                  min="1000"
                  step="100"
                  value={backtestConfig.initialCapital}
                  onChange={(event) =>
                    setBacktestConfig((previous) => ({
                      ...previous,
                      initialCapital: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label>Fee (bps)</label>
                <input
                  type="number"
                  min="0"
                  value={backtestConfig.feeBps}
                  onChange={(event) =>
                    setBacktestConfig((previous) => ({
                      ...previous,
                      feeBps: Number(event.target.value),
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="command-actions">
            <button type="button" className="primary-action" onClick={runBacktestScenario} disabled={backtestLoading}>
              {backtestLoading ? "Running Backtest..." : "Run Backtest"}
            </button>
          </div>
          {backtestError ? <p className="error-text">{backtestError}</p> : null}

          {backtestResult?.summary ? (
            <div className="backtest-summary">
              <div>
                <span>Total Return</span>
                <strong className={toneClass(backtestResult.summary.totalReturnPct)}>
                  {formatPercent(backtestResult.summary.totalReturnPct)}
                </strong>
              </div>
              <div>
                <span>Buy & Hold</span>
                <strong className={toneClass(backtestResult.summary.buyHoldReturnPct)}>
                  {formatPercent(backtestResult.summary.buyHoldReturnPct)}
                </strong>
              </div>
              <div>
                <span>Alpha</span>
                <strong className={toneClass(backtestResult.summary.alphaPct)}>
                  {formatPercent(backtestResult.summary.alphaPct)}
                </strong>
              </div>
              <div>
                <span>Max Drawdown</span>
                <strong>{formatPercent(-backtestResult.summary.maxDrawdownPct)}</strong>
              </div>
              <div>
                <span>Win Rate</span>
                <strong>{formatPercent(backtestResult.summary.winRatePct)}</strong>
              </div>
              <div>
                <span>Trades</span>
                <strong>{backtestResult.summary.trades}</strong>
              </div>
            </div>
          ) : null}

          {backtestCurve.length ? (
            <div className="equity-strip">
              {backtestCurve.slice(-80).map((point) => (
                <span
                  key={`eq-${point.date}`}
                  style={{
                    height: `${Math.max(8, ((point.value - curveMin) / curveRange) * 62 + 8)}px`,
                  }}
                />
              ))}
            </div>
          ) : null}

          {backtestResult?.trades?.length ? (
            <div className="backtest-trades">
              <h4>Recent Trades</h4>
              <div className="backtest-trade-list">
                {backtestResult.trades.slice(-8).reverse().map((trade, index) => (
                  <div key={`${trade.date}-${trade.type}-${index}`}>
                    <span>{trade.type}</span>
                    <span>{trade.date}</span>
                    <span>{formatCurrency(trade.price)}</span>
                    <span className={toneClass(trade.pnl || 0)}>
                      {trade.pnl ? formatCurrency(trade.pnl) : "--"}
                    </span>
                  </div>
                ))}
              </div>
              {backtestMeta ? (
                <p className="hint-text">
                  Params: {backtestMeta.fastPeriod}/{backtestMeta.slowPeriod} SMA · {backtestMeta.range}
                </p>
              ) : null}
            </div>
          ) : null}
        </motion.div>
      </section>
    </div>
  );
}

export default App;
