import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import AdvancedChart from "./AdvancedChart";
import {
  fetchAiInsight,
  fetchMarketPulse,
  fetchQuoteMulti,
  fetchStockCandlesMulti,
  searchSymbols,
} from "./api/client";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA"];
const RANGE_OPTIONS = ["1D", "5D", "1M", "3M", "6M", "1Y"];
const MODE_OPTIONS = [
  { value: "candlestick", label: "Candles" },
  { value: "line", label: "Lines" },
];
const RISK_OPTIONS = ["conservative", "balanced", "aggressive"];
const STAGGER_ITEM = { duration: 0.45, ease: "easeOut" };

function usePersistentState(key, fallbackValue) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallbackValue;
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

function toneClass(value) {
  if (value > 0) return "tone-positive";
  if (value < 0) return "tone-negative";
  return "tone-neutral";
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

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className={`metric-value ${tone}`}>{value}</p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function App() {
  const [theme, setTheme] = usePersistentState("sv-theme", "day");
  const [selectedTickers, setSelectedTickers] = usePersistentState("sv-selected-tickers", DEFAULT_TICKERS);
  const [range, setRange] = usePersistentState("sv-range", "3M");
  const [chartMode, setChartMode] = usePersistentState("sv-chart-mode", "candlestick");

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);

  const [marketData, setMarketData] = useState({});
  const [marketMeta, setMarketMeta] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [focusTicker, setFocusTicker] = useState(selectedTickers[0] || "");

  const [marketPulse, setMarketPulse] = useState([]);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [pulseError, setPulseError] = useState("");

  const [positions, setPositions] = usePersistentState("sv-portfolio-positions", []);
  const [positionForm, setPositionForm] = useState({ ticker: "", shares: "", avgCost: "" });
  const [quoteSnapshot, setQuoteSnapshot] = useState({});
  const [scenarioMove, setScenarioMove] = useState(5);

  const [riskProfile, setRiskProfile] = useState("balanced");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiInsight, setAiInsight] = useState(null);
  const [aiMeta, setAiMeta] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

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

  const runMarketScan = useCallback(async () => {
    if (!selectedTickers.length) {
      setDataError("Add at least one ticker to run a market scan.");
      setMarketData({});
      return;
    }

    setLoadingData(true);
    setDataError("");
    try {
      const response = await fetchStockCandlesMulti({
        tickers: selectedTickers,
        range,
      });
      setMarketData(response.data || {});
      setMarketMeta(response.meta || null);
      setLastRefresh(new Date());
    } catch (error) {
      setDataError(error.message || "Unable to load market data.");
    } finally {
      setLoadingData(false);
    }
  }, [range, selectedTickers]);

  const refreshPulse = useCallback(async () => {
    setPulseLoading(true);
    setPulseError("");
    try {
      const response = await fetchMarketPulse();
      setMarketPulse(response.data || []);
    } catch (error) {
      setPulseError(error.message || "Unable to fetch market pulse.");
    } finally {
      setPulseLoading(false);
    }
  }, []);

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
  }, [runMarketScan, refreshPulse]);

  useEffect(() => {
    const pulseTimer = window.setInterval(() => {
      refreshPulse();
    }, 60000);
    return () => window.clearInterval(pulseTimer);
  }, [refreshPulse]);

  useEffect(() => {
    refreshPortfolioQuotes();
  }, [refreshPortfolioQuotes]);

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

  const focusPayload = focusTicker ? marketData[focusTicker] : null;
  const focusMetrics = focusPayload?.metrics;

  const addTicker = useCallback(
    (rawValue) => {
      const ticker = normalizeTicker(rawValue);
      if (!ticker) return;
      if (selectedTickers.includes(ticker)) return;
      if (selectedTickers.length >= 8) return;
      setSelectedTickers((previous) => [...previous, ticker]);
      setSearchText("");
      setSuggestions([]);
      setShowSuggestions(false);
    },
    [selectedTickers, setSelectedTickers]
  );

  const removeTicker = useCallback(
    (tickerToRemove) => {
      setSelectedTickers((previous) => previous.filter((ticker) => ticker !== tickerToRemove));
    },
    [setSelectedTickers]
  );

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    if (suggestions.length > 0) {
      addTicker(suggestions[0].symbol);
      return;
    }
    addTicker(searchText);
  };

  const generateAiBrief = async () => {
    if (!focusTicker || !focusPayload) {
      setAiError("Run a market scan first, then select a focus ticker.");
      return;
    }

    setAiError("");
    setAiLoading(true);
    try {
      const response = await fetchAiInsight({
        ticker: focusTicker,
        candles: focusPayload.candles,
        metrics: focusPayload.metrics,
        riskProfile,
        question:
          aiPrompt.trim() ||
          `Build a ${riskProfile} swing-trading plan for ${focusTicker} over the next 2-4 weeks.`,
      });
      setAiInsight(response.data || null);
      setAiMeta(response.meta || null);
    } catch (error) {
      setAiError(error.message || "Unable to generate AI brief.");
    } finally {
      setAiLoading(false);
    }
  };

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

  const portfolioRows = useMemo(() => {
    return positions.map((position, index) => {
      const ticker = normalizeTicker(position.ticker);
      const mark =
        marketData[ticker]?.metrics?.lastClose ||
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
      };
    });
  }, [positions, marketData, quoteSnapshot, marketPulse]);

  const portfolioTotals = useMemo(() => {
    return portfolioRows.reduce(
      (totals, row) => {
        totals.marketValue += row.marketValue;
        totals.costBasis += row.costBasis;
        totals.pnl += row.pnl;
        return totals;
      },
      { marketValue: 0, costBasis: 0, pnl: 0 }
    );
  }, [portfolioRows]);

  const projectedValue = portfolioTotals.marketValue * (1 + scenarioMove / 100);
  const projectedMove = projectedValue - portfolioTotals.marketValue;

  return (
    <div className="app-shell">
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
          <span className="brand-mark">SV</span>
          <div>
            <p className="brand-title">StockVision X</p>
            <p className="brand-subtitle">AI Trading Command Center</p>
          </div>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((previous) => (previous === "night" ? "day" : "night"))}
        >
          {theme === "night" ? "Switch To Daylight" : "Switch To Afterhours"}
        </button>
      </motion.header>

      <motion.section
        className="hero-panel"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...STAGGER_ITEM, delay: 0.1 }}
      >
        <p className="hero-eyebrow">Revamped Experience</p>
        <h1>Build, stress-test, and brief your next move in one cockpit.</h1>
        <p>
          Multi-symbol analytics, live pulse monitoring, AI strategy narration, and a scenario-aware portfolio lab
          tuned for fast decisions.
        </p>
        <div className="hero-stats">
          <div>
            <span>{selectedTickers.length}</span>
            <p>Active Symbols</p>
          </div>
          <div>
            <span>{marketPulse.length}</span>
            <p>Pulse Assets</p>
          </div>
          <div>
            <span>{lastRefresh ? lastRefresh.toLocaleTimeString() : "--:--"}</span>
            <p>Last Scan</p>
          </div>
        </div>
      </motion.section>

      <section className="main-grid">
        <motion.div
          className="glass-card command-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.15 }}
        >
          <div className="section-head">
            <h2>Command Deck</h2>
            <p>Discover symbols, set horizon, and launch a full-market scan.</p>
          </div>

          <form className="search-form" ref={suggestionsRef} onSubmit={handleSearchSubmit}>
            <input
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

          <div className="control-row">
            <div>
              <label>Range</label>
              <SegmentGroup options={RANGE_OPTIONS} value={range} onChange={setRange} />
            </div>
            <div>
              <label>Chart</label>
              <SegmentGroup options={MODE_OPTIONS} value={chartMode} onChange={setChartMode} />
            </div>
          </div>

          <div className="command-actions">
            <button type="button" className="primary-action" onClick={runMarketScan} disabled={loadingData}>
              {loadingData ? "Scanning..." : "Run Market Scan"}
            </button>
            <button type="button" className="ghost-action" onClick={refreshPulse} disabled={pulseLoading}>
              Refresh Pulse
            </button>
          </div>

          {dataError && <p className="error-text">{dataError}</p>}
          {pulseError && <p className="error-text">{pulseError}</p>}
        </motion.div>

        <motion.div
          className="glass-card pulse-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.2 }}
        >
          <div className="section-head">
            <h2>Market Pulse</h2>
            <p>Macro and megacap tape for quick context switching.</p>
          </div>
          <div className="pulse-list">
            {marketPulse.map((item) => (
              <div key={item.symbol} className="pulse-item">
                <p>{item.symbol}</p>
                <h4>{formatCurrency(item.price)}</h4>
                <span className={toneClass(item.percentChange)}>{formatPercent(item.percentChange)}</span>
              </div>
            ))}
            {marketPulse.length === 0 && <p className="hint-text">{pulseLoading ? "Loading pulse..." : "No pulse data yet."}</p>}
          </div>
        </motion.div>
      </section>

      <section className="analysis-grid">
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
                <span key={ticker} className={`legend-pill ${focusTicker === ticker ? "active" : ""}`}>
                  {ticker}
                </span>
              ))}
            </div>
          </div>
          {Object.keys(dataByTicker).length > 0 ? (
            <AdvancedChart dataByTicker={dataByTicker} mode={chartMode} theme={theme} />
          ) : (
            <div className="empty-state">No chart data available. Add symbols and run a market scan.</div>
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
                <p>Focused diagnostics for your active symbol.</p>
              </div>
              <select value={focusTicker} onChange={(event) => setFocusTicker(event.target.value)}>
                {selectedTickers.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </div>

            {focusMetrics ? (
              <div className="metrics-grid">
                <MetricCard
                  label="Last Price"
                  value={formatCurrency(focusMetrics.lastClose)}
                  detail="Latest close"
                />
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
                <MetricCard label="RSI(14)" value={focusMetrics.rsi14.toFixed(1)} detail={focusMetrics.momentum} />
                <MetricCard label="Trend" value={focusMetrics.trend} detail="SMA 20/50 regime" />
                <MetricCard label="Avg Volume" value={Math.round(focusMetrics.avgVolume).toLocaleString()} detail="Recent mean" />
              </div>
            ) : (
              <p className="hint-text">Metrics will populate after the first scan.</p>
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
                  <span>Momentum</span>
                  <strong>{focusMetrics.momentum}</strong>
                </div>
              </div>
            ) : (
              <p className="hint-text">No risk radar yet.</p>
            )}
          </motion.div>
        </div>
      </section>

      <section className="bottom-grid">
        <motion.div
          className="glass-card ai-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...STAGGER_ITEM, delay: 0.36 }}
        >
          <div className="section-head">
            <h2>AI Strategy Copilot</h2>
            <p>Get a structured brief with setups, risks, catalysts, and action items.</p>
          </div>

          <div className="ai-controls">
            <div>
              <label>Risk Profile</label>
              <SegmentGroup options={RISK_OPTIONS} value={riskProfile} onChange={setRiskProfile} />
            </div>
            <div>
              <label>Prompt</label>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Ask for an entry plan, invalidation level, scaling logic, or risk budget."
              />
            </div>
          </div>

          <button type="button" className="primary-action" onClick={generateAiBrief} disabled={aiLoading}>
            {aiLoading ? "Generating Brief..." : "Generate AI Brief"}
          </button>
          {aiError && <p className="error-text">{aiError}</p>}

          {aiInsight && (
            <div className="ai-output">
              <p className="ai-meta">
                Engine: {aiMeta?.engine || "unknown"} {aiMeta?.model ? `· ${aiMeta.model}` : ""}
              </p>
              <h4>{aiInsight.summary}</h4>

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
                Educational context only. Always validate with independent research and position sizing rules.
              </p>
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
            <p>Track live valuation and run quick scenario shocks.</p>
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
            <div className="portfolio-head">
              <span>Ticker</span>
              <span>Shares</span>
              <span>Mark</span>
              <span>P/L</span>
              <span />
            </div>
            {portfolioRows.map((row) => (
              <div key={row.id} className="portfolio-row">
                <span>{row.ticker}</span>
                <span>{row.shares}</span>
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

          <div className="portfolio-summary">
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
          </div>

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
        </motion.div>
      </section>
    </div>
  );
}

export default App;
