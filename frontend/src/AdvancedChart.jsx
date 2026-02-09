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

function buildMovingAverage(data, period) {
  if (!data?.length || period <= 1) return [];
  const output = [];
  let rolling = 0;
  for (let i = 0; i < data.length; i += 1) {
    rolling += data[i].close;
    if (i >= period) rolling -= data[i - period].close;
    if (i >= period - 1) {
      output.push({
        time: data[i].time,
        value: rolling / period,
      });
    }
  }
  return output;
}

export default function AdvancedChart({
  dataByTicker,
  mode = "candlestick",
  theme = "night",
  focusTicker = "",
  focusMetrics = null,
  indicators = {},
}) {
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

    let focusSeries = null;
    let focusFormatted = null;

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
          lineWidth: ticker === focusTicker ? 3 : 2.1,
          title: ticker,
          priceLineVisible: false,
        });
        lineSeries.setData(formatted.map((item) => ({ time: item.time, value: item.close })));
        if (ticker === focusTicker) {
          focusSeries = lineSeries;
          focusFormatted = formatted;
        }
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
        if (ticker === focusTicker) {
          focusSeries = candleSeries;
          focusFormatted = formatted;
        }
      }
    });

    if (focusFormatted && focusFormatted.length) {
      if (indicators?.sma20) {
        const sma20Series = chart.addLineSeries({
          color: theme === "night" ? "#90a7ff" : "#3d5bba",
          lineWidth: 1.8,
          lineStyle: 1,
          priceLineVisible: false,
        });
        sma20Series.setData(buildMovingAverage(focusFormatted, 20));
      }

      if (indicators?.sma50) {
        const sma50Series = chart.addLineSeries({
          color: theme === "night" ? "#f4c46b" : "#a5641f",
          lineWidth: 1.8,
          lineStyle: 2,
          priceLineVisible: false,
        });
        sma50Series.setData(buildMovingAverage(focusFormatted, 50));
      }
    }

    if (focusSeries && focusMetrics) {
      if (indicators?.support) {
        focusSeries.createPriceLine({
          price: focusMetrics.support,
          color: "rgba(91, 231, 196, 0.8)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "Support",
        });
      }
      if (indicators?.resistance) {
        focusSeries.createPriceLine({
          price: focusMetrics.resistance,
          color: "rgba(255, 128, 160, 0.85)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "Resistance",
        });
      }
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [dataByTicker, mode, theme, focusTicker, focusMetrics, indicators]);

  return <div ref={chartContainerRef} className="advanced-chart-canvas" />;
}
