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
const WORKSPACE_SHORT_LABEL = {
  market: "Market",
  intelligence: "Intel",
  portfolio: "Portfolio",
  strategy: "Strategy",
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

function formatTimeOnly(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function alertSeverityRank(level) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function alertSeverityClass(level) {
  if (level === "high") return "alert-high";
  if (level === "medium") return "alert-medium";
  return "alert-low";
}

function normalizeAlertConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rsiHigh = clamp(Number(source.rsiHigh) || 70, 55, 95);
  const rsiLow = Math.min(clamp(Number(source.rsiLow) || 30, 5, 45), rsiHigh - 5);
  const volatilityHigh = clamp(Number(source.volatilityHigh) || 45, 10, 120);
  const levelBufferPct = clamp(Number(source.levelBufferPct) || 2.5, 0.2, 10);
  return {
    enabled: source.enabled !== false,
    rsiHigh: Number(rsiHigh.toFixed(1)),
    rsiLow: Number(rsiLow.toFixed(1)),
    volatilityHigh: Number(volatilityHigh.toFixed(1)),
    levelBufferPct: Number(levelBufferPct.toFixed(1)),
  };
}

function activityToneClass(kind) {
  if (kind === "error") return "activity-error";
  if (kind === "success") return "activity-success";
  if (kind === "workspace") return "activity-workspace";
  return "activity-neutral";
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
  const [focusMode, setFocusMode] = usePersistentState("sv-focus-mode", false);
  const [activityFeed, setActivityFeed] = usePersistentState("sv-activity-feed", []);
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
  const [alertConfig, setAlertConfig] = usePersistentState("sv-alert-config", normalizeAlertConfig({}));
  const [dismissedAlerts, setDismissedAlerts] = usePersistentState("sv-dismissed-alerts", {});
  const [scanReplay, setScanReplay] = usePersistentState("sv-scan-replay", []);

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);
  const searchInputRef = useRef(null);
  const commandPaletteInputRef = useRef(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const [selectedReplayId, setSelectedReplayId] = useState(null);
  const lastWorkspaceRef = useRef(activeWorkspace);
  const sentinelPanelRef = useRef(null);
  const alphaPanelRef = useRef(null);
  const seenAlertIdsRef = useRef(new Set());

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

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteIndex(0);
  }, []);

  const recordActivity = useCallback(
    (kind, title, detail = "") => {
      setActivityFeed((previous) =>
        [
          {
            id: Date.now() + Math.random(),
            kind,
            title,
            detail,
            at: new Date().toISOString(),
          },
          ...(Array.isArray(previous) ? previous : []),
        ].slice(0, 40)
      );
    },
    [setActivityFeed]
  );

  const clearActivityFeed = useCallback(() => {
    setActivityFeed([]);
  }, [setActivityFeed]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((previous) => !previous);
  }, [setFocusMode]);

  const toggleAlertEngine = useCallback(() => {
    setAlertConfig((previous) => normalizeAlertConfig({ ...previous, enabled: !previous?.enabled }));
  }, [setAlertConfig]);

  const updateAlertThreshold = useCallback(
    (key, rawValue) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      setAlertConfig((previous) => normalizeAlertConfig({ ...previous, [key]: numeric }));
    },
    [setAlertConfig]
  );

  const dismissSentinelAlert = useCallback(
    (alertId) => {
      if (!alertId) return;
      setDismissedAlerts((previous) => ({
        ...(previous && typeof previous === "object" ? previous : {}),
        [alertId]: new Date().toISOString(),
      }));
    },
    [setDismissedAlerts]
  );

  const clearDismissedAlerts = useCallback(() => {
    setDismissedAlerts({});
    seenAlertIdsRef.current = new Set();
    recordActivity("neutral", "Sentinel dismissals reset", "Hidden alerts restored to active queue");
  }, [recordActivity, setDismissedAlerts]);

  const clearScanReplay = useCallback(() => {
    setScanReplay([]);
    setSelectedReplayId(null);
    recordActivity("neutral", "Scan replay cleared", "Timeline snapshots removed");
  }, [recordActivity, setScanReplay]);

  const revealSentinelPanel = useCallback(() => {
    setActiveWorkspace("market");
    if (sentinelPanelRef.current) {
      sentinelPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [setActiveWorkspace]);

  const revealAlphaPanel = useCallback(() => {
    setActiveWorkspace("market");
    if (alphaPanelRef.current) {
      alphaPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [setActiveWorkspace]);

  useEffect(() => {
    const normalized = normalizeAlertConfig(alertConfig);
    if (
      !alertConfig ||
      normalized.enabled !== alertConfig.enabled ||
      normalized.rsiHigh !== alertConfig.rsiHigh ||
      normalized.rsiLow !== alertConfig.rsiLow ||
      normalized.volatilityHigh !== alertConfig.volatilityHigh ||
      normalized.levelBufferPct !== alertConfig.levelBufferPct
    ) {
      setAlertConfig(normalized);
    }
  }, [alertConfig, setAlertConfig]);

  useEffect(() => {
    if (dismissedAlerts && typeof dismissedAlerts === "object" && !Array.isArray(dismissedAlerts)) return;
    setDismissedAlerts({});
  }, [dismissedAlerts, setDismissedAlerts]);

  useEffect(() => {
    if (Array.isArray(scanReplay)) return;
    setScanReplay([]);
  }, [scanReplay, setScanReplay]);

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
    if (!commandPaletteOpen) return undefined;
    const timer = window.setTimeout(() => {
      commandPaletteInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    setCommandPaletteIndex(0);
  }, [commandPaletteOpen, commandPaletteQuery]);

  useEffect(() => {
    if (lastWorkspaceRef.current === activeWorkspace) return;
    const workspaceLabel = WORKSPACE_INFO[activeWorkspace]?.label || activeWorkspace;
    recordActivity("workspace", `Switched to ${workspaceLabel}`, "Workspace context updated");
    lastWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace, recordActivity]);

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
      const provider = health?.services?.marketDataProvider || "unknown";
      updateBackendStatus({
        providerHint: provider,
        status: "online",
      });
      recordActivity("success", "Backend connected", `Provider: ${provider}`);
      return true;
    } catch (error) {
      updateBackendStatus({
        status: "offline",
        message: error.message || "Backend unavailable",
      });
      recordActivity("error", "Backend offline", error.message || "Connectivity check failed");
      return false;
    }
  }, [recordActivity, updateBackendStatus]);

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
      recordActivity("success", `Added ${ticker}`, "Ticker added to active universe");
    },
    [recordActivity, setSelectedTickers]
  );

  const addTickerBatch = useCallback(
    (batchTickers) => {
      setSelectedTickers((previous) => {
        const merged = [...new Set([...previous, ...batchTickers.map(normalizeTicker).filter(Boolean)])];
        const addedCount = Math.max(0, Math.min(8, merged.length) - previous.length);
        if (addedCount > 0) {
          recordActivity("success", "Applied basket preset", `${addedCount} symbols added`);
        }
        return merged.slice(0, 8);
      });
    },
    [recordActivity, setSelectedTickers]
  );

  const removeTicker = useCallback(
    (tickerToRemove) => {
      setSelectedTickers((previous) => previous.filter((ticker) => ticker !== tickerToRemove));
      recordActivity("neutral", `Removed ${tickerToRemove}`, "Ticker removed from active universe");
    },
    [recordActivity, setSelectedTickers]
  );

  const runMarketScan = useCallback(async ({ source = "manual" } = {}) => {
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

      const snapshotRows = availableEntries
        .map(([ticker, payload]) => {
          const metrics = payload?.metrics || {};
          const profileScore = scoreByProfile(metrics, scannerProfile);
          return {
            ticker,
            profileScore,
            signalScore: Number(metrics.signalScore || 0),
            changePct: Number(metrics.changePct || 0),
            trend: metrics.trend || "Neutral",
            momentum: metrics.momentum || "Neutral",
          };
        })
        .sort((left, right) => right.profileScore - left.profileScore);
      const snapshot = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        range,
        profile: scannerProfile,
        requested: selectedTickers.length,
        available: availableEntries.length,
        avgScore: average(snapshotRows.map((row) => row.profileScore)),
        leaderTicker: snapshotRows[0]?.ticker || "",
        leaderScore: snapshotRows[0]?.profileScore || 0,
        rows: snapshotRows.slice(0, 8),
      };
      setScanReplay((previous) => [snapshot, ...(Array.isArray(previous) ? previous : [])].slice(0, 36));
      setSelectedReplayId(snapshot.id);

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
        if (source !== "auto" && source !== "boot") {
          recordActivity(
            "neutral",
            "Partial market scan",
            `${availableEntries.length}/${selectedTickers.length} symbols refreshed${missingLabel}`
          );
        }
      } else {
        setScanNotice(`Scan complete: ${availableEntries.length}/${selectedTickers.length} symbols updated.`);
        if (source !== "auto" && source !== "boot") {
          recordActivity(
            "success",
            "Market scan complete",
            `${availableEntries.length} symbols updated for ${range}`
          );
        }
      }
    } catch (error) {
      const message = error.message || "Unable to load market data.";
      setDataError(message);
      setScanNotice("");
      if (source !== "auto" && source !== "boot") {
        recordActivity("error", "Market scan failed", message);
      }
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
  }, [range, recordActivity, scannerProfile, selectedTickers, setScanReplay, updateBackendStatus]);

  const refreshPulse = useCallback(async ({ source = "manual" } = {}) => {
    setPulseLoading(true);
    setPulseError("");
    try {
      const response = await fetchMarketPulse();
      setMarketPulse(response.data || []);
      setMarketPulseSummary(response.summary || null);
      if (source !== "auto" && source !== "boot") {
        recordActivity(
          "success",
          "Pulse refreshed",
          `${(response.summary?.advancers || 0) + (response.summary?.decliners || 0)} movers tracked`
        );
      }
    } catch (error) {
      const message = error.message || "Unable to fetch market pulse.";
      setPulseError(message);
      if (source !== "auto" && source !== "boot") {
        recordActivity("error", "Pulse refresh failed", message);
      }
    } finally {
      setPulseLoading(false);
    }
  }, [recordActivity]);

  const refreshNews = useCallback(async ({ source = "manual" } = {}) => {
    setNewsLoading(true);
    setNewsError("");
    try {
      const response = await fetchMarketNews({
        tickers: selectedTickers.slice(0, 4),
        limit: 12,
      });
      setNewsItems(response.data || []);
      setNewsMeta(response.meta || null);
      if (source !== "auto" && source !== "boot") {
        recordActivity("success", "News updated", `${response.data?.length || 0} headlines synced`);
      }
    } catch (error) {
      const message = error.message || "Unable to fetch market news.";
      setNewsError(message);
      if (source !== "auto" && source !== "boot") {
        recordActivity("error", "News refresh failed", message);
      }
    } finally {
      setNewsLoading(false);
    }
  }, [recordActivity, selectedTickers]);

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
    runMarketScan({ source: "boot" });
    refreshPulse({ source: "boot" });
    refreshNews({ source: "boot" });
  }, [runMarketScan, refreshPulse, refreshNews]);

  useEffect(() => {
    refreshPortfolioQuotes();
  }, [refreshPortfolioQuotes]);

  useEffect(() => {
    if (!autoRefreshSec) return undefined;
    const timer = window.setInterval(() => {
      runMarketScan({ source: "auto" });
      refreshPulse({ source: "auto" });
      refreshNews({ source: "auto" });
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
  const replayHistory = useMemo(() => {
    if (!Array.isArray(scanReplay)) return [];
    return scanReplay
      .filter((snapshot) => snapshot && typeof snapshot === "object" && Array.isArray(snapshot.rows))
      .slice(0, 36);
  }, [scanReplay]);
  const replaySelection = useMemo(() => {
    if (!replayHistory.length) return null;
    return replayHistory.find((snapshot) => snapshot.id === selectedReplayId) || replayHistory[0];
  }, [replayHistory, selectedReplayId]);
  const replaySeries = useMemo(() => replayHistory.slice(0, 24).reverse(), [replayHistory]);
  const replayScoreDelta = useMemo(() => {
    if (replayHistory.length < 2) return 0;
    return Number(replayHistory[0].avgScore || 0) - Number(replayHistory[1].avgScore || 0);
  }, [replayHistory]);
  const previousReplaySnapshot = replayHistory[1] || null;
  const scanDeltaUniverse = useMemo(() => {
    if (!previousReplaySnapshot || !Array.isArray(previousReplaySnapshot.rows)) return [];
    const previousByTicker = Object.fromEntries(
      previousReplaySnapshot.rows.map((row) => [
        row.ticker,
        Number(row.profileScore ?? row.signalScore ?? 0),
      ])
    );

    return rankedSignals
      .map((row) => {
        const previousScore = previousByTicker[row.ticker];
        if (!Number.isFinite(previousScore)) return null;
        const currentScore = Number(row.profileScore || 0);
        return {
          ticker: row.ticker,
          currentScore,
          previousScore,
          delta: currentScore - previousScore,
          trend: row.metrics?.trend || "Neutral",
          momentum: row.metrics?.momentum || "Neutral",
        };
      })
      .filter(Boolean);
  }, [previousReplaySnapshot, rankedSignals]);
  const scanDeltaTopMovers = useMemo(
    () =>
      scanDeltaUniverse
        .slice()
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
        .slice(0, 6),
    [scanDeltaUniverse]
  );
  const scanDeltaSummary = useMemo(() => {
    return scanDeltaUniverse.reduce(
      (summary, row) => {
        if (row.delta > 0.1) summary.improved += 1;
        else if (row.delta < -0.1) summary.faded += 1;
        else summary.flat += 1;
        return summary;
      },
      { improved: 0, faded: 0, flat: 0 }
    );
  }, [scanDeltaUniverse]);
  const alphaOpportunities = useMemo(() => {
    return rankedSignals.slice(0, 6).map((row, index) => {
      const metrics = row.metrics || {};
      const price = Number(metrics.lastClose || 0);
      const support = Number(metrics.support || price || 0);
      const resistance = Number(metrics.resistance || price || 0);
      const trend = metrics.trend || "Neutral";
      const momentum = metrics.momentum || "Neutral";
      const bullish = trend !== "Bearish";
      const riskUnit = Math.max(Number(metrics.atr14 || 0), Math.abs(price) * 0.01, 0.35);
      const entryAnchor = price || Number(metrics.sma20 || 0) || support || resistance || 0;
      const entryLow = Math.max(0, entryAnchor - riskUnit * (bullish ? 0.35 : 0.2));
      const entryHigh = Math.max(entryLow, entryAnchor + riskUnit * (bullish ? 0.35 : 0.2));
      const stop = bullish ? Math.max(0, support - riskUnit * 0.6) : resistance + riskUnit * 0.6;
      const target = bullish
        ? Math.max(entryAnchor, resistance + riskUnit * 0.7)
        : Math.max(0, support - riskUnit * 0.7);
      const anchorEntry = bullish ? entryHigh : entryLow;
      const riskPerShare = Math.max(0.01, Math.abs(anchorEntry - stop));
      const rewardPerShare = Math.max(0.01, Math.abs(target - anchorEntry));
      const rr = rewardPerShare / riskPerShare;
      const conviction = clamp(
        Math.round(Number(row.profileScore || 0) * 0.65 + Number(metrics.signalScore || 50) * 0.35),
        0,
        100
      );

      return {
        id: `${row.ticker}-${index}`,
        ticker: row.ticker,
        direction: bullish ? "Long Bias" : "Short Bias",
        trend,
        momentum,
        conviction,
        rr,
        entryLow,
        entryHigh,
        stop,
        target,
        riskBudgetPct: clamp((conviction / 100) * 1.8, 0.35, 2.2),
      };
    });
  }, [rankedSignals]);
  const topOpportunity = alphaOpportunities[0] || null;

  const sentinelAlerts = useMemo(() => {
    if (!alertConfig.enabled) return [];
    const alertRows = [];
    const alertTime = lastRefresh ? new Date(lastRefresh).toISOString() : new Date().toISOString();
    const dismissedMap = dismissedAlerts && typeof dismissedAlerts === "object" ? dismissedAlerts : {};

    rankedSignals.forEach((row) => {
      const metrics = row.metrics || {};
      const score = Number(row.profileScore || metrics.signalScore || 0);
      const rsi14 = Number(metrics.rsi14 || 0);
      const volatility = Number(metrics.volatility || 0);
      const distToResistance = Number(metrics.distanceToResistancePct ?? 999);
      const distToSupport = Number(metrics.distanceToSupportPct ?? 999);
      const trend = metrics.trend || "Neutral";

      if (rsi14 >= alertConfig.rsiHigh) {
        alertRows.push({
          id: `${row.ticker}-rsi-high`,
          ticker: row.ticker,
          severity: "medium",
          score,
          at: alertTime,
          title: "RSI overheated",
          detail: `RSI ${rsi14.toFixed(1)} above threshold ${alertConfig.rsiHigh.toFixed(1)}.`,
        });
      }
      if (rsi14 <= alertConfig.rsiLow) {
        alertRows.push({
          id: `${row.ticker}-rsi-low`,
          ticker: row.ticker,
          severity: "medium",
          score,
          at: alertTime,
          title: "RSI compressed",
          detail: `RSI ${rsi14.toFixed(1)} below threshold ${alertConfig.rsiLow.toFixed(1)}.`,
        });
      }
      if (volatility >= alertConfig.volatilityHigh) {
        alertRows.push({
          id: `${row.ticker}-volatility-high`,
          ticker: row.ticker,
          severity: volatility >= alertConfig.volatilityHigh * 1.3 ? "high" : "medium",
          score,
          at: alertTime,
          title: "Volatility spike",
          detail: `Annualized volatility ${volatility.toFixed(2)}% exceeds ${alertConfig.volatilityHigh.toFixed(1)}%.`,
        });
      }
      if (distToResistance <= alertConfig.levelBufferPct && trend === "Bullish") {
        alertRows.push({
          id: `${row.ticker}-resistance-test`,
          ticker: row.ticker,
          severity: "low",
          score,
          at: alertTime,
          title: "Breakout pressure",
          detail: `Price is ${distToResistance.toFixed(2)}% from resistance.`,
        });
      }
      if (distToSupport <= alertConfig.levelBufferPct && trend === "Bearish") {
        alertRows.push({
          id: `${row.ticker}-support-failure`,
          ticker: row.ticker,
          severity: "high",
          score,
          at: alertTime,
          title: "Support pressure",
          detail: `Price is ${distToSupport.toFixed(2)}% from support while trend is bearish.`,
        });
      }
      if (score <= 35 && trend === "Bearish") {
        alertRows.push({
          id: `${row.ticker}-weak-score`,
          ticker: row.ticker,
          severity: "high",
          score,
          at: alertTime,
          title: "Weak composite setup",
          detail: `Profile score ${score.toFixed(0)} with bearish trend alignment.`,
        });
      }
    });

    return alertRows
      .filter((alert) => !dismissedMap[alert.id])
      .sort((left, right) => {
        const severityDiff = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
        if (severityDiff !== 0) return severityDiff;
        return right.score - left.score;
      })
      .slice(0, 18);
  }, [alertConfig, dismissedAlerts, lastRefresh, rankedSignals]);

  const sentinelCounts = useMemo(() => {
    return sentinelAlerts.reduce(
      (summary, alert) => {
        summary.total += 1;
        if (alert.severity === "high") summary.high += 1;
        else if (alert.severity === "medium") summary.medium += 1;
        else summary.low += 1;
        return summary;
      },
      { total: 0, high: 0, medium: 0, low: 0 }
    );
  }, [sentinelAlerts]);

  const sentinelStatus = useMemo(() => {
    if (!alertConfig.enabled) return { label: "Disabled", chipClass: "status-neutral" };
    if (sentinelCounts.high > 0) return { label: "Critical", chipClass: "status-negative" };
    if (sentinelCounts.medium > 0) return { label: "Watch", chipClass: "status-neutral" };
    if (sentinelCounts.low > 0) return { label: "Stable", chipClass: "status-positive" };
    return { label: "No Alerts", chipClass: "status-positive" };
  }, [alertConfig.enabled, sentinelCounts.high, sentinelCounts.low, sentinelCounts.medium]);

  useEffect(() => {
    if (!replayHistory.length) {
      if (selectedReplayId !== null) setSelectedReplayId(null);
      return;
    }
    if (!replayHistory.some((snapshot) => snapshot.id === selectedReplayId)) {
      setSelectedReplayId(replayHistory[0].id);
    }
  }, [replayHistory, selectedReplayId]);

  useEffect(() => {
    if (!alertConfig.enabled || sentinelAlerts.length === 0) return;
    const seenIds = seenAlertIdsRef.current;
    const freshCritical = sentinelAlerts.filter((alert) => alert.severity === "high" && !seenIds.has(alert.id));
    if (!freshCritical.length) return;
    const topAlert = freshCritical[0];
    recordActivity("error", `Sentinel alert: ${topAlert.ticker}`, topAlert.title);
    freshCritical.forEach((alert) => seenIds.add(alert.id));
  }, [alertConfig.enabled, recordActivity, sentinelAlerts]);

  const selectReplaySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setSelectedReplayId(snapshot.id);
    if (snapshot.leaderTicker) {
      setFocusTicker(snapshot.leaderTicker);
    }
  }, []);
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
  const activityStats = useMemo(() => {
    const rows = Array.isArray(activityFeed) ? activityFeed : [];
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const recent = rows.filter((item) => Date.parse(item.at || "") >= dayAgo);
    const scans = recent.filter((item) => String(item.title || "").toLowerCase().includes("scan")).length;
    const briefs = recent.filter((item) => String(item.title || "").toLowerCase().includes("ai brief")).length;
    return {
      recentCount: recent.length,
      scans,
      briefs,
    };
  }, [activityFeed]);
  const missionSteps = useMemo(
    () => [
      {
        id: "universe",
        label: "Assemble Universe",
        detail: "Track at least 3 symbols.",
        done: selectedTickers.length >= 3,
      },
      {
        id: "scan",
        label: "Run Market Scan",
        detail: "Load scan metrics and chart data.",
        done: scanCoverage.available > 0,
      },
      {
        id: "intelligence",
        label: "Generate AI Brief",
        detail: "Build actionable tactical guidance.",
        done: Boolean(aiInsight),
      },
      {
        id: "portfolio",
        label: "Build Portfolio Context",
        detail: "Add at least one position to stress test.",
        done: positions.length > 0,
      },
      {
        id: "strategy",
        label: "Validate Strategy",
        detail: "Run a backtest and inspect outcomes.",
        done: Boolean(backtestResult?.summary),
      },
    ],
    [aiInsight, backtestResult?.summary, positions.length, scanCoverage.available, selectedTickers.length]
  );
  const missionProgress = useMemo(() => {
    const completed = missionSteps.filter((step) => step.done).length;
    return Math.round((completed / missionSteps.length) * 100);
  }, [missionSteps]);
  const activeMissionStep = missionSteps.find((step) => !step.done) || missionSteps.at(-1);

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
    recordActivity("success", "Exported scan snapshot", `${rows.length} rows saved to CSV`);
  };

  const runBacktestScenario = async () => {
    const ticker = normalizeTicker(backtestConfig.ticker || focusTicker);
    const fast = Number(backtestConfig.fastPeriod);
    const slow = Number(backtestConfig.slowPeriod);
    const capital = Number(backtestConfig.initialCapital);
    const fee = Number(backtestConfig.feeBps);

    if (!ticker) {
      setBacktestError("Select a ticker for backtesting.");
      recordActivity("error", "Backtest blocked", "Ticker is required");
      return;
    }
    if (!Number.isFinite(fast) || !Number.isFinite(slow) || fast < 2 || slow < 3 || fast >= slow) {
      setBacktestError("Use valid fast/slow periods, with fast smaller than slow.");
      recordActivity("error", "Backtest blocked", "Invalid fast/slow configuration");
      return;
    }
    if (!Number.isFinite(capital) || capital <= 0) {
      setBacktestError("Initial capital must be greater than zero.");
      recordActivity("error", "Backtest blocked", "Initial capital must be greater than zero");
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
      recordActivity(
        "success",
        "Backtest complete",
        `${ticker} · return ${Number(response.data?.summary?.totalReturnPct || 0).toFixed(2)}%`
      );
    } catch (error) {
      const message = error.message || "Unable to run backtest.";
      setBacktestError(message);
      recordActivity("error", "Backtest failed", message);
    } finally {
      setBacktestLoading(false);
    }
  };

  const generateAiBrief = useCallback(async () => {
    if (!focusTicker || !focusPayload) {
      setAiError("Run a market scan first, then select a focus ticker.");
      recordActivity("error", "AI brief blocked", "Run a scan and select a focus ticker first");
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
      recordActivity(
        "success",
        "AI brief generated",
        `${focusTicker} · confidence ${Number(response.data?.confidence || 0).toFixed(0)}`
      );
    } catch (error) {
      const message = error.message || "Unable to generate AI brief.";
      setAiError(message);
      recordActivity("error", "AI brief failed", message);
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, focusMetrics, focusPayload, focusTicker, pulseSummary, recordActivity, riskProfile, scannerProfile, setAiHistory, strategyStyle]);

  const draftOpportunityBrief = useCallback(
    (opportunity) => {
      if (!opportunity?.ticker) {
        recordActivity("neutral", "No opportunity draft", "Run a market scan to generate opportunities.");
        return;
      }
      const prompt = `Build a ${riskProfile} ${strategyStyle} plan for ${opportunity.ticker}. Bias: ${
        opportunity.direction
      }. Entry zone: ${formatCurrency(opportunity.entryLow)} - ${formatCurrency(opportunity.entryHigh)}. Stop: ${formatCurrency(
        opportunity.stop
      )}. Target: ${formatCurrency(opportunity.target)}. Focus on ${scannerProfile} confirmation, invalidation timing, and position sizing.`;
      setFocusTicker(opportunity.ticker);
      setAiPrompt(prompt);
      setActiveWorkspace("intelligence");
      recordActivity("success", "Opportunity prompt drafted", `${opportunity.ticker} plan staged in AI workspace`);
    },
    [recordActivity, riskProfile, scannerProfile, setActiveWorkspace, strategyStyle]
  );

  const stageOpportunityBacktest = useCallback(
    (opportunity) => {
      if (!opportunity?.ticker) {
        recordActivity("neutral", "No backtest staged", "Run a market scan to identify top opportunities.");
        return;
      }
      setBacktestConfig((previous) => ({
        ...previous,
        ticker: opportunity.ticker,
      }));
      setActiveWorkspace("strategy");
      recordActivity("workspace", "Backtest staged", `${opportunity.ticker} loaded into Strategy Lab`);
    },
    [recordActivity, setActiveWorkspace, setBacktestConfig]
  );

  const commandPaletteActions = useMemo(
    () => [
      {
        id: "scan",
        label: "Run Market Scan",
        description: "Fetch latest candles and recompute signal metrics.",
        shortcut: "Shift+S",
        keywords: "scan candles metrics market",
        run: () => {
          setActiveWorkspace("market");
          runMarketScan();
        },
      },
      {
        id: "pulse",
        label: "Refresh Market Pulse",
        description: "Update breadth and leaders/laggards.",
        shortcut: "Shift+P",
        keywords: "pulse breadth refresh",
        run: () => {
          setActiveWorkspace("market");
          refreshPulse();
        },
      },
      {
        id: "news",
        label: "Refresh News Radar",
        description: "Pull the newest headlines for selected symbols.",
        shortcut: "Shift+N",
        keywords: "news headlines refresh",
        run: () => {
          setActiveWorkspace("intelligence");
          refreshNews();
        },
      },
      {
        id: "ai-brief",
        label: "Generate AI Brief",
        description: "Build tactical plan with levels and projection.",
        shortcut: "Shift+B",
        keywords: "ai brief strategy copilot",
        run: () => {
          setActiveWorkspace("intelligence");
          generateAiBrief();
        },
      },
      {
        id: "backtest",
        label: "Run Strategy Backtest",
        description: "Execute SMA crossover backtest on active config.",
        shortcut: "Lab",
        keywords: "backtest strategy lab sma",
        run: () => {
          setActiveWorkspace("strategy");
          runBacktestScenario();
        },
      },
      {
        id: "backend",
        label: "Test Backend Connection",
        description: "Check API status and provider connectivity.",
        shortcut: "Deck",
        keywords: "backend api health test",
        run: () => {
          setActiveWorkspace("market");
          testBackendConnection();
        },
      },
      {
        id: "focus-search",
        label: "Focus Ticker Search",
        description: "Jump cursor into search bar for symbol lookup.",
        shortcut: "/",
        keywords: "search symbol ticker focus",
        run: () => {
          setActiveWorkspace("market");
          searchInputRef.current?.focus();
          setShowSuggestions(true);
        },
      },
      {
        id: "toggle-focus",
        label: focusMode ? "Disable Focus Mode" : "Enable Focus Mode",
        description: "Reduce visual noise and keep only essential modules.",
        shortcut: "Focus",
        keywords: "focus mode distraction free",
        run: () => toggleFocusMode(),
      },
      {
        id: "clear-activity",
        label: "Clear Activity Intelligence",
        description: "Reset recent operator event history.",
        shortcut: "Log",
        keywords: "clear activity history feed",
        run: () => clearActivityFeed(),
      },
      {
        id: "toggle-alerts",
        label: alertConfig.enabled ? "Disable Signal Sentinel" : "Enable Signal Sentinel",
        description: "Toggle RSI/volatility alert engine.",
        shortcut: "Alert",
        keywords: "sentinel alert rsi volatility",
        run: () => {
          setActiveWorkspace("market");
          toggleAlertEngine();
        },
      },
      {
        id: "reset-alerts",
        label: "Reset Alert Dismissals",
        description: "Restore dismissed alerts back into the queue.",
        shortcut: "Reset",
        keywords: "sentinel dismiss clear reset",
        run: () => {
          setActiveWorkspace("market");
          clearDismissedAlerts();
        },
      },
      {
        id: "jump-sentinel",
        label: "Jump To Signal Sentinel",
        description: "Scroll to the live alert stack in Market Command.",
        shortcut: "Watch",
        keywords: "sentinel panel jump market",
        run: () => revealSentinelPanel(),
      },
      {
        id: "jump-alpha",
        label: "Jump To Alpha Board",
        description: "Open the opportunity panel with setup blueprints.",
        shortcut: "Alpha",
        keywords: "alpha board opportunity panel",
        run: () => revealAlphaPanel(),
      },
      {
        id: "draft-top-opportunity",
        label: "Draft AI Brief: Top Opportunity",
        description: "Send the highest-ranked setup to AI workspace prompt.",
        shortcut: "Draft",
        keywords: "opportunity ai brief top setup",
        run: () => draftOpportunityBrief(topOpportunity),
      },
      {
        id: "stage-top-backtest",
        label: "Stage Backtest: Top Opportunity",
        description: "Load top setup into Strategy Lab backtest controls.",
        shortcut: "Stage",
        keywords: "opportunity backtest strategy lab",
        run: () => stageOpportunityBacktest(topOpportunity),
      },
      {
        id: "clear-replay",
        label: "Clear Scan Replay Timeline",
        description: "Remove replay snapshots and start fresh.",
        shortcut: "Replay",
        keywords: "scan replay history clear",
        run: () => clearScanReplay(),
      },
      {
        id: "tab-market",
        label: "Switch Workspace: Market",
        description: "Scanner, pulse, chart arena, and signal matrix.",
        shortcut: "Alt+1",
        keywords: "workspace tab market",
        run: () => setActiveWorkspace("market"),
      },
      {
        id: "tab-intelligence",
        label: "Switch Workspace: AI Intelligence",
        description: "Copilot and news-focused workspace.",
        shortcut: "Alt+2",
        keywords: "workspace tab ai intelligence",
        run: () => setActiveWorkspace("intelligence"),
      },
      {
        id: "tab-portfolio",
        label: "Switch Workspace: Portfolio Ops",
        description: "Holdings, concentration, and scenario controls.",
        shortcut: "Alt+3",
        keywords: "workspace tab portfolio",
        run: () => setActiveWorkspace("portfolio"),
      },
      {
        id: "tab-strategy",
        label: "Switch Workspace: Strategy Lab",
        description: "Backtest execution with chart context.",
        shortcut: "Alt+4",
        keywords: "workspace tab strategy lab",
        run: () => setActiveWorkspace("strategy"),
      },
    ],
    [
      alertConfig.enabled,
      clearDismissedAlerts,
      clearScanReplay,
      clearActivityFeed,
      draftOpportunityBrief,
      focusMode,
      generateAiBrief,
      refreshNews,
      refreshPulse,
      revealAlphaPanel,
      revealSentinelPanel,
      runBacktestScenario,
      runMarketScan,
      setActiveWorkspace,
      stageOpportunityBacktest,
      testBackendConnection,
      topOpportunity,
      toggleAlertEngine,
      toggleFocusMode,
    ]
  );

  const filteredCommandActions = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase();
    if (!query) return commandPaletteActions;
    return commandPaletteActions.filter((action) =>
      `${action.label} ${action.description} ${action.keywords}`.toLowerCase().includes(query)
    );
  }, [commandPaletteActions, commandPaletteQuery]);

  const executeCommandAction = useCallback(
    (action) => {
      if (!action || typeof action.run !== "function") return;
      closeCommandPalette();
      action.run();
    },
    [closeCommandPalette]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = String(event.key || "").toLowerCase();
      const editable = isEditableTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        if (commandPaletteOpen) closeCommandPalette();
        else openCommandPalette();
        return;
      }

      if (commandPaletteOpen) {
        if (key === "escape") {
          event.preventDefault();
          closeCommandPalette();
          return;
        }
        if (key === "arrowdown") {
          event.preventDefault();
          setCommandPaletteIndex((previous) => {
            if (!filteredCommandActions.length) return 0;
            return Math.min(filteredCommandActions.length - 1, previous + 1);
          });
          return;
        }
        if (key === "arrowup") {
          event.preventDefault();
          setCommandPaletteIndex((previous) => Math.max(0, previous - 1));
          return;
        }
        if (key === "enter") {
          event.preventDefault();
          const action =
            filteredCommandActions[commandPaletteIndex] ||
            filteredCommandActions[0];
          executeCommandAction(action);
          return;
        }
        return;
      }

      if (!editable && key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
        if (key === "f") {
          event.preventDefault();
          toggleFocusMode();
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
      } else if (key === "a") {
        event.preventDefault();
        draftOpportunityBrief(topOpportunity);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeCommandPalette,
    commandPaletteIndex,
    commandPaletteOpen,
    draftOpportunityBrief,
    executeCommandAction,
    filteredCommandActions,
    generateAiBrief,
    openCommandPalette,
    refreshNews,
    refreshPulse,
    runMarketScan,
    setActiveWorkspace,
    topOpportunity,
    toggleFocusMode,
  ]);

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
    recordActivity("success", `Position updated: ${ticker}`, `${shares} shares @ ${formatCurrency(avgCost)}`);
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
  const portfolioGuardrails = useMemo(() => {
    if (!portfolioRows.length || portfolioTotals.marketValue <= 0) return [];
    const guardrails = [];
    const varPct = (portfolioDailyVar95 / portfolioTotals.marketValue) * 100;
    const unrealizedPct =
      portfolioTotals.costBasis > 0 ? (portfolioTotals.pnl / portfolioTotals.costBasis) * 100 : 0;

    if (concentrationStats.top1 >= 0.4) {
      guardrails.push({
        id: "top1",
        severity: "high",
        title: "Single-position concentration risk",
        detail: `Top holding is ${formatPercent(concentrationStats.top1 * 100)} of portfolio value.`,
      });
    } else if (concentrationStats.top1 >= 0.28) {
      guardrails.push({
        id: "top1-watch",
        severity: "medium",
        title: "Concentration trending high",
        detail: `Top holding is ${formatPercent(concentrationStats.top1 * 100)} of portfolio value.`,
      });
    }

    if (varPct >= 4.5) {
      guardrails.push({
        id: "var-high",
        severity: "high",
        title: "1-day VaR is elevated",
        detail: `Estimated VaR is ${varPct.toFixed(2)}% of portfolio value.`,
      });
    } else if (varPct >= 3) {
      guardrails.push({
        id: "var-mid",
        severity: "medium",
        title: "1-day VaR entering caution zone",
        detail: `Estimated VaR is ${varPct.toFixed(2)}% of portfolio value.`,
      });
    }

    if (unrealizedPct <= -8) {
      guardrails.push({
        id: "drawdown",
        severity: "high",
        title: "Portfolio drawdown breach",
        detail: `Unrealized return is ${formatPercent(unrealizedPct)} against cost basis.`,
      });
    }

    if (portfolioRows.length < 3) {
      guardrails.push({
        id: "diversification",
        severity: "low",
        title: "Diversification is shallow",
        detail: `Only ${portfolioRows.length} position${portfolioRows.length === 1 ? "" : "s"} tracked.`,
      });
    }

    return guardrails.slice(0, 5);
  }, [concentrationStats.top1, portfolioDailyVar95, portfolioRows, portfolioTotals.costBasis, portfolioTotals.marketValue, portfolioTotals.pnl]);

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
    <div className="app-shell" data-workspace={activeWorkspace} data-focus={focusMode ? "on" : "off"}>
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
            <span className={`status-chip ${sentinelStatus.chipClass}`}>
              Alerts {alertConfig.enabled ? sentinelCounts.total : "off"}
            </span>
            <span className="status-chip status-neutral">Mission {missionProgress}%</span>
          </div>
          <button type="button" className="command-launch" onClick={openCommandPalette}>
            <span>Command Menu</span>
            <kbd>Ctrl/Cmd+K</kbd>
          </button>
          <button type="button" className="focus-toggle" onClick={toggleFocusMode}>
            {focusMode ? "Exit Focus" : "Focus Mode"}
          </button>
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
          <div>
            <span>{replayHistory.length}</span>
            <p>Replay Snapshots</p>
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
            <small>
              Volatility map: {formatPercent(averageVolatility)} · Sentinel {sentinelStatus.label}
            </small>
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
        <p className="shortcut-copy">Press "/" for ticker search and Shift+A to draft top opportunity AI plan.</p>
      </motion.section>

      <section className="glass-card workspace-nav">
        <div className="workspace-nav-head">
          <div>
            <h2>{activeWorkspaceInfo.label}</h2>
            <p>{activeWorkspaceInfo.hint}</p>
          </div>
          <p className="workspace-shortcuts">Alt+1/2/3/4 workspace · Ctrl/Cmd+K command menu</p>
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

      <section className="command-intel-grid workspace-section">
        <div className="glass-card mission-panel">
          <div className="section-head inline">
            <div>
              <h2>Mission Control</h2>
              <p>Drive the workflow from universe setup to validated strategy.</p>
            </div>
            <strong className="mission-progress">{missionProgress}%</strong>
          </div>
          <div className="mission-track">
            <span style={{ width: `${missionProgress}%` }} />
          </div>
          <p className="mission-current">
            Active step: <strong>{activeMissionStep?.label || "Complete workflow"}</strong>
          </p>
          <div className="mission-list">
            {missionSteps.map((step, index) => (
              <div key={step.id} className={`mission-item ${step.done ? "done" : ""}`}>
                <span>{step.done ? "Done" : `${index + 1}`}</span>
                <div>
                  <p>{step.label}</p>
                  <small>{step.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card activity-panel">
          <div className="section-head inline">
            <div>
              <h2>Activity Intelligence</h2>
              <p>Recent operator events and execution telemetry.</p>
            </div>
            <button type="button" className="ghost-action" onClick={clearActivityFeed}>
              Clear Log
            </button>
          </div>
          <div className="activity-stats">
            <div>
              <span>24h events</span>
              <strong>{activityStats.recentCount}</strong>
            </div>
            <div>
              <span>Scans</span>
              <strong>{activityStats.scans}</strong>
            </div>
            <div>
              <span>AI briefs</span>
              <strong>{activityStats.briefs}</strong>
            </div>
          </div>
          <div className="activity-list">
            {(activityFeed || []).slice(0, 7).map((event) => (
              <div key={event.id} className="activity-item">
                <span className={`activity-dot ${activityToneClass(event.kind)}`} />
                <div>
                  <p>{event.title}</p>
                  <small>{event.detail || "No detail"}</small>
                </div>
                <time>{formatTimeOnly(event.at)}</time>
              </div>
            ))}
            {(!activityFeed || activityFeed.length === 0) && (
              <p className="hint-text">No activity yet. Run a scan or open the command menu to begin.</p>
            )}
          </div>
        </div>

        <div className="glass-card replay-panel">
          <div className="section-head inline">
            <div>
              <h2>Scan Replay</h2>
              <p>Timeline snapshots to inspect setup rotation and score drift.</p>
            </div>
            <button type="button" className="ghost-action" onClick={clearScanReplay} disabled={!replayHistory.length}>
              Clear Replay
            </button>
          </div>
          <div className="replay-stats">
            <div>
              <span>Snapshots</span>
              <strong>{replayHistory.length}</strong>
            </div>
            <div>
              <span>Score Drift</span>
              <strong className={toneClass(replayScoreDelta)}>
                {replayHistory.length > 1 ? formatPercent(replayScoreDelta) : "--"}
              </strong>
            </div>
            <div>
              <span>Lead Symbol</span>
              <strong>{replayHistory[0]?.leaderTicker || "--"}</strong>
            </div>
            <div>
              <span>Last Capture</span>
              <strong>{replayHistory[0]?.createdAt ? formatTimeOnly(replayHistory[0].createdAt) : "--:--"}</strong>
            </div>
          </div>
          <div className="replay-strip">
            {replaySeries.map((snapshot) => {
              const snapshotScore = clamp(Number(snapshot.avgScore || 0), 0, 100);
              return (
                <button
                  key={snapshot.id}
                  type="button"
                  className={`replay-bar ${snapshot.id === replaySelection?.id ? "active" : ""}`}
                  onClick={() => selectReplaySnapshot(snapshot)}
                  title={`${snapshot.leaderTicker || "N/A"} · ${snapshotScore.toFixed(1)} · ${formatDateTime(snapshot.createdAt)}`}
                >
                  <span style={{ height: `${Math.round(12 + (snapshotScore / 100) * 56)}px` }} />
                </button>
              );
            })}
            {!replaySeries.length && <p className="hint-text">Run Market Scan to start timeline capture.</p>}
          </div>
          {replaySelection ? (
            <div className="replay-selection">
              <div className="replay-selection-head">
                <div>
                  <h4>{formatTimeOnly(replaySelection.createdAt)}</h4>
                  <p>
                    {formatRelativeTime(replaySelection.createdAt)} · {replaySelection.profile || "custom"} profile ·{" "}
                    {replaySelection.range || "custom"}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => replaySelection.leaderTicker && setFocusTicker(replaySelection.leaderTicker)}
                  disabled={!replaySelection.leaderTicker}
                >
                  Focus Leader
                </button>
              </div>
              <div className="replay-selection-list">
                {replaySelection.rows.slice(0, 4).map((row) => (
                  <button
                    key={`${replaySelection.id}-${row.ticker}`}
                    type="button"
                    className="replay-row"
                    onClick={() => setFocusTicker(row.ticker)}
                  >
                    <strong>{row.ticker}</strong>
                    <span>{Number(row.profileScore || row.signalScore || 0).toFixed(0)}</span>
                    <em className={toneClass(row.changePct)}>{formatPercent(row.changePct)}</em>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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

          <div className="deck-depth-grid">
            <div className="deck-depth-card">
              <div className="deck-depth-head">
                <h3>Signal Sentinel</h3>
                <span className={`status-chip ${sentinelStatus.chipClass}`}>{sentinelStatus.label}</span>
              </div>
              <p>Auto-detect RSI extremes, volatility spikes, and level pressure across ranked symbols.</p>
              <div className="deck-depth-actions">
                <button type="button" className="ghost-action" onClick={toggleAlertEngine}>
                  {alertConfig.enabled ? "Disable Alerts" : "Enable Alerts"}
                </button>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={clearDismissedAlerts}
                  disabled={!Object.keys(dismissedAlerts || {}).length}
                >
                  Reset Dismissed
                </button>
              </div>
              <div className="threshold-grid">
                <label>
                  RSI High
                  <input
                    type="number"
                    min="55"
                    max="95"
                    value={alertConfig.rsiHigh}
                    onChange={(event) => updateAlertThreshold("rsiHigh", event.target.value)}
                  />
                </label>
                <label>
                  RSI Low
                  <input
                    type="number"
                    min="5"
                    max="45"
                    value={alertConfig.rsiLow}
                    onChange={(event) => updateAlertThreshold("rsiLow", event.target.value)}
                  />
                </label>
                <label>
                  Volatility %
                  <input
                    type="number"
                    min="10"
                    max="120"
                    value={alertConfig.volatilityHigh}
                    onChange={(event) => updateAlertThreshold("volatilityHigh", event.target.value)}
                  />
                </label>
                <label>
                  Level Buffer %
                  <input
                    type="number"
                    min="0.2"
                    max="10"
                    step="0.1"
                    value={alertConfig.levelBufferPct}
                    onChange={(event) => updateAlertThreshold("levelBufferPct", event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="deck-depth-card">
              <div className="deck-depth-head">
                <h3>Replay Control</h3>
                <span className="status-chip status-neutral">{replayHistory.length} captures</span>
              </div>
              <p>Inspect score momentum between scans and jump to previous market leaders instantly.</p>
              <div className="mini-replay-strip">
                {replaySeries.map((snapshot) => {
                  const snapshotScore = clamp(Number(snapshot.avgScore || 0), 0, 100);
                  return (
                    <button
                      key={`mini-${snapshot.id}`}
                      type="button"
                      className={`mini-replay-bar ${snapshot.id === replaySelection?.id ? "active" : ""}`}
                      onClick={() => selectReplaySnapshot(snapshot)}
                    >
                      <span style={{ height: `${Math.round(8 + (snapshotScore / 100) * 38)}px` }} />
                    </button>
                  );
                })}
                {!replaySeries.length && <p className="hint-text">No snapshots yet.</p>}
              </div>
              <div className="deck-depth-meta">
                <div>
                  <span>Current Leader</span>
                  <strong>{replaySelection?.leaderTicker || "--"}</strong>
                </div>
                <div>
                  <span>Last Score</span>
                  <strong>{replaySelection ? Number(replaySelection.avgScore || 0).toFixed(1) : "--"}</strong>
                </div>
              </div>
              <div className="deck-depth-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => replaySelection?.leaderTicker && setFocusTicker(replaySelection.leaderTicker)}
                  disabled={!replaySelection?.leaderTicker}
                >
                  Focus Leader
                </button>
                <button type="button" className="ghost-action" onClick={clearScanReplay} disabled={!replayHistory.length}>
                  Clear Timeline
                </button>
              </div>
            </div>
          </div>

          <div className="delta-panel">
            <div className="delta-head">
              <h3>Scan Delta Intelligence</h3>
              <span className="status-chip status-neutral">
                {previousReplaySnapshot ? "vs previous scan" : "needs 2 scans"}
              </span>
            </div>
            {scanDeltaUniverse.length > 0 ? (
              <>
                <div className="delta-summary">
                  <div>
                    <span>Improved</span>
                    <strong className="tone-positive">{scanDeltaSummary.improved}</strong>
                  </div>
                  <div>
                    <span>Faded</span>
                    <strong className="tone-negative">{scanDeltaSummary.faded}</strong>
                  </div>
                  <div>
                    <span>Flat</span>
                    <strong>{scanDeltaSummary.flat}</strong>
                  </div>
                </div>
                <div className="delta-list">
                  {scanDeltaTopMovers.map((row) => (
                    <button
                      key={`delta-${row.ticker}`}
                      type="button"
                      className="delta-item"
                      onClick={() => setFocusTicker(row.ticker)}
                    >
                      <strong>{row.ticker}</strong>
                      <span>{row.previousScore.toFixed(0)} → {row.currentScore.toFixed(0)}</span>
                      <em className={toneClass(row.delta)}>{row.delta >= 0 ? "+" : ""}{row.delta.toFixed(1)}</em>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="hint-text">Run at least two scans to unlock score delta tracking.</p>
            )}
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

          <motion.div
            ref={sentinelPanelRef}
            className="glass-card sentinel-panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...STAGGER_ITEM, delay: 0.36 }}
          >
            <div className="section-head inline">
              <div>
                <h2>Signal Sentinel</h2>
                <p>Live rule-based surveillance across active scan signals.</p>
              </div>
              <span className={`status-chip ${sentinelStatus.chipClass}`}>{sentinelStatus.label}</span>
            </div>

            <div className="sentinel-stats">
              <div>
                <span>Total</span>
                <strong>{sentinelCounts.total}</strong>
              </div>
              <div>
                <span>High</span>
                <strong>{sentinelCounts.high}</strong>
              </div>
              <div>
                <span>Medium</span>
                <strong>{sentinelCounts.medium}</strong>
              </div>
              <div>
                <span>Low</span>
                <strong>{sentinelCounts.low}</strong>
              </div>
            </div>

            <div className="sentinel-actions">
              <button type="button" className="ghost-action" onClick={toggleAlertEngine}>
                {alertConfig.enabled ? "Disable Engine" : "Enable Engine"}
              </button>
              <button
                type="button"
                className="ghost-action"
                onClick={clearDismissedAlerts}
                disabled={!Object.keys(dismissedAlerts || {}).length}
              >
                Reset Dismissed
              </button>
            </div>

            {alertConfig.enabled ? (
              <div className="sentinel-list">
                {sentinelAlerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className={`sentinel-item ${alertSeverityClass(alert.severity)}`}>
                    <div>
                      <p>
                        {alert.ticker} · {alert.title}
                      </p>
                      <small>{alert.detail}</small>
                    </div>
                    <div className="sentinel-item-tail">
                      <span>{formatRelativeTime(alert.at)}</span>
                      <button type="button" onClick={() => dismissSentinelAlert(alert.id)}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
                {sentinelAlerts.length === 0 && (
                  <p className="hint-text">No active alerts. Sentinel is running with current thresholds.</p>
                )}
              </div>
            ) : (
              <p className="hint-text">Sentinel is disabled. Enable it from Command Deck or the command menu.</p>
            )}
          </motion.div>

          <motion.div
            ref={alphaPanelRef}
            className="glass-card alpha-panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...STAGGER_ITEM, delay: 0.4 }}
          >
            <div className="section-head inline">
              <div>
                <h2>Alpha Opportunity Board</h2>
                <p>Execution-ready setup blueprints ranked from live signal strength.</p>
              </div>
              <span className="status-chip status-neutral">{alphaOpportunities.length} active</span>
            </div>
            {topOpportunity ? (
              <p className="alpha-lead-note">
                Lead setup: <strong>{topOpportunity.ticker}</strong> · {topOpportunity.direction} · Conviction{" "}
                {topOpportunity.conviction}
              </p>
            ) : null}
            <div className="alpha-list">
              {alphaOpportunities.map((opportunity) => (
                <div key={opportunity.id} className="alpha-item">
                  <div className="alpha-item-head">
                    <h4>{opportunity.ticker}</h4>
                    <span className={opportunity.direction === "Long Bias" ? "tone-positive" : "tone-negative"}>
                      {opportunity.direction}
                    </span>
                  </div>
                  <div className="alpha-metrics">
                    <div>
                      <span>Entry</span>
                      <strong>
                        {formatCurrency(opportunity.entryLow)} - {formatCurrency(opportunity.entryHigh)}
                      </strong>
                    </div>
                    <div>
                      <span>Stop / Target</span>
                      <strong>
                        {formatCurrency(opportunity.stop)} / {formatCurrency(opportunity.target)}
                      </strong>
                    </div>
                    <div>
                      <span>R:R</span>
                      <strong>{opportunity.rr.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Risk Budget</span>
                      <strong>{opportunity.riskBudgetPct.toFixed(2)}%</strong>
                    </div>
                  </div>
                  <div className="alpha-tags">
                    <span>{opportunity.trend}</span>
                    <span>{opportunity.momentum}</span>
                  </div>
                  <div className="alpha-progress">
                    <span style={{ width: `${opportunity.conviction}%` }} />
                  </div>
                  <div className="alpha-actions">
                    <button type="button" className="ghost-action" onClick={() => setFocusTicker(opportunity.ticker)}>
                      Focus
                    </button>
                    <button type="button" className="ghost-action" onClick={() => draftOpportunityBrief(opportunity)}>
                      Draft AI Plan
                    </button>
                    <button type="button" className="ghost-action" onClick={() => stageOpportunityBacktest(opportunity)}>
                      Stage Backtest
                    </button>
                  </div>
                </div>
              ))}
              {!alphaOpportunities.length && (
                <p className="hint-text">Run Market Scan to populate opportunity blueprints.</p>
              )}
            </div>
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

          <div className="guardrail-panel">
            <div className="guardrail-head">
              <h4>Risk Guardrails</h4>
              <span className="status-chip status-neutral">{portfolioGuardrails.length} active</span>
            </div>
            {portfolioGuardrails.length ? (
              <div className="guardrail-list">
                {portfolioGuardrails.map((item) => (
                  <div key={item.id} className={`guardrail-item ${alertSeverityClass(item.severity)}`}>
                    <p>{item.title}</p>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint-text">No major risk guardrails triggered.</p>
            )}
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

      <nav className="quick-dock" aria-label="Workspace quick dock">
        {workspaceTabs.map((tab) => (
          <button
            key={`dock-${tab.id}`}
            type="button"
            className={`quick-dock-item ${activeWorkspace === tab.id ? "active" : ""}`}
            onClick={() => setActiveWorkspace(tab.id)}
          >
            {WORKSPACE_SHORT_LABEL[tab.id] || tab.label}
          </button>
        ))}
        <button type="button" className="quick-dock-item dock-command" onClick={openCommandPalette}>
          Menu
        </button>
      </nav>

      {commandPaletteOpen && (
        <div className="command-palette-overlay" onClick={closeCommandPalette}>
          <motion.div
            className="command-palette-panel glass-card"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="command-palette-head">
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                placeholder="Search commands, actions, or workspaces..."
              />
              <button type="button" className="ghost-action" onClick={closeCommandPalette}>
                Close
              </button>
            </div>
            <div className="command-palette-list">
              {filteredCommandActions.length === 0 ? (
                <p className="hint-text">No matching actions. Try another command keyword.</p>
              ) : (
                filteredCommandActions.map((action, index) => (
                  <button
                    key={`command-${action.id}`}
                    type="button"
                    className={`command-palette-item ${index === commandPaletteIndex ? "active" : ""}`}
                    onMouseEnter={() => setCommandPaletteIndex(index)}
                    onClick={() => executeCommandAction(action)}
                  >
                    <div>
                      <span>{action.label}</span>
                      <small>{action.description}</small>
                    </div>
                    <em>{action.shortcut}</em>
                  </button>
                ))
              )}
            </div>
            <p className="command-palette-foot">Arrow keys + Enter to execute. Esc to close.</p>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default App;
