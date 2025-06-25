import React, { useRef, useEffect } from "react";
import { createChart } from "lightweight-charts";

// Palette of distinct colors for multiple tickers
const COLORS = [
  "#f44336", // red
  "#4caf50", // green
  "#2196f3", // blue
  "#ff9800", // orange
  "#9c27b0", // purple
  "#00bcd4", // cyan
  "#e91e63", // pink
  "#3f51b5", // indigo
];

export default function AdvancedChart({ dataByTicker, chartType = "candlestick" }) {
  const chartContainerRef = useRef();

  useEffect(() => {
    if (!dataByTicker || Object.keys(dataByTicker).length === 0) return;

    const container = chartContainerRef.current;
    container.innerHTML = ""; // Clear previous chart

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 400,
      layout: {
        backgroundColor: "#0f172a",
        textColor: "white",
      },
      grid: {
        vertLines: { color: "#334158" },
        horzLines: { color: "#334158" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    });

    Object.entries(dataByTicker).forEach(([ticker, data], idx) => {
      const color = COLORS[idx % COLORS.length];
      const formattedData = data.map((d) => ({
        time: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      if (chartType === "candlestick") {
        const candleSeries = chart.addCandlestickSeries({
          upColor: color,
          downColor: color,
          borderDownColor: color,
          borderUpColor: color,
          wickDownColor: color,
          wickUpColor: color,
        });
        candleSeries.setData(formattedData);
      } else if (chartType === "line") {
        const lineSeries = chart.addLineSeries({
          color,
          lineWidth: 2,
        });

        const lineData = formattedData.map(({ time, close }) => ({ time, value: close }));
        lineSeries.setData(lineData);
      }
    });

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [dataByTicker, chartType]);

  return <div ref={chartContainerRef} style={{ width: "100%", height: 400 }} />;
}