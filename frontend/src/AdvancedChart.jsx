import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

const SERIES_COLORS = ["#ff6b6b", "#5be7c4", "#ffb86b", "#6aa9ff", "#f4ff63", "#8efc6e", "#ff82d1"];

function toChartTime(candle) {
  if (candle.datetime && candle.datetime.includes(":")) {
    const parsed = Date.parse(candle.datetime.replace(" ", "T"));
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return candle.date;
}

export default function AdvancedChart({ dataByTicker, mode = "candlestick", theme = "night" }) {
  const chartContainerRef = useRef(null);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !dataByTicker || Object.keys(dataByTicker).length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 430,
      layout: {
        background: { color: theme === "night" ? "#09162f" : "#f5f9ff" },
        textColor: theme === "night" ? "#d2ddff" : "#1d2a54",
        fontFamily: "Space Grotesk, sans-serif",
      },
      grid: {
        vertLines: { color: theme === "night" ? "rgba(160, 184, 255, 0.14)" : "rgba(75, 106, 175, 0.14)" },
        horzLines: { color: theme === "night" ? "rgba(160, 184, 255, 0.14)" : "rgba(75, 106, 175, 0.14)" },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(255, 255, 255, 0.2)" },
        horzLine: { color: "rgba(255, 255, 255, 0.2)" },
      },
    });

    Object.entries(dataByTicker).forEach(([ticker, candles], index) => {
      const color = SERIES_COLORS[index % SERIES_COLORS.length];
      const formatted = (candles || [])
        .map((candle) => ({
          time: toChartTime(candle),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }))
        .filter((item) => Number.isFinite(item.close));

      if (formatted.length === 0) return;

      if (mode === "line") {
        const lineSeries = chart.addLineSeries({
          color,
          lineWidth: 2.5,
          title: ticker,
          priceLineVisible: false,
        });
        lineSeries.setData(formatted.map((item) => ({ time: item.time, value: item.close })));
      } else {
        const candleSeries = chart.addCandlestickSeries({
          upColor: color,
          downColor: "#e4527f",
          borderVisible: false,
          wickUpColor: color,
          wickDownColor: "#e4527f",
          priceLineVisible: false,
        });
        candleSeries.setData(formatted);
      }
    });

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [dataByTicker, mode, theme]);

  return <div ref={chartContainerRef} className="advanced-chart-canvas" />;
}
