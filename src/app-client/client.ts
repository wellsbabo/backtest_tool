import type {ChartDataset} from "chart.js";
import type {ChartPreviewPayload} from "../schemas/backtest-result.js";

declare global {
  interface Window {
    Chart: typeof import("chart.js").Chart;
  }
}

type JobResponse =
  | {status: "queued"}
  | {status: "running"}
  | {
      status: "completed";
      preview: ChartPreviewPayload;
      summary: Array<{
        strategyLabel: string;
        finalValue: number;
        totalReturnPct: number;
        maxDrawdownPct: number;
        tradeCount: number;
      }>;
    }
  | {status: "failed"; error: string};

const colors = ["#68e1fd", "#f7c66b", "#7ef0a8", "#ff8a80", "#b39ddb", "#80cbc4"];

const form = document.querySelector<HTMLFormElement>("#scenario-form");
const symbolInput = document.querySelector<HTMLInputElement>("#symbol");
const exampleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".example-chip"));
const statusEl = document.querySelector<HTMLDivElement>("#status");
const summaryEl = document.querySelector<HTMLDivElement>("#summary");
const chartTitleEl = document.querySelector<HTMLHeadingElement>("#chart-title");
const chartSubtitleEl = document.querySelector<HTMLParagraphElement>("#chart-subtitle");
const chartCanvas = document.querySelector<HTMLCanvasElement>("#result-chart");
const chartLegendEl = document.querySelector<HTMLDivElement>("#chart-legend");
const speedDownButton = document.querySelector<HTMLButtonElement>("#speed-down");
const speedUpButton = document.querySelector<HTMLButtonElement>("#speed-up");
const replayButton = document.querySelector<HTMLButtonElement>("#replay-chart");
const speedIndicator = document.querySelector<HTMLDivElement>("#speed-indicator");
const legendAliasesInput = document.querySelector<HTMLTextAreaElement>("#legend-aliases");
const loadingModalEl = document.querySelector<HTMLDivElement>("#loading-modal");
const ChartJs = window.Chart;

type RenderableChart = {
  destroy: () => void;
  update: (mode?: "none") => void;
  getDatasetMeta: (index: number) => {data?: Array<{x?: number; y?: number}>};
  data: {
    labels: string[];
    datasets: Array<ChartDataset<"line", Array<{x: number; y: number}>>>;
  };
  options: {
    scales?: {
      x?: {
        min?: number;
        max?: number;
      };
      y?: {
        min?: number;
        max?: number;
      };
    };
  };
};

let chart: RenderableChart | null = null;
let chartSpeedMultiplier = 8;
let latestPreview: ChartPreviewPayload | null = null;
let animationFrameId: number | null = null;
let currentXAxisMarkers: Array<{position: number; label: string}> = [];
let currentLineLabels: Array<{label: string; color: string; x: number; y: number; value: number}> = [];

function dateToAxisValue(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function hasMissingMarketPrefix(symbolInputValue: string): boolean {
  return symbolInputValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => !/^[A-Za-z]+\s*:\s*.+$/.test(value));
}

function hasMergedSymbols(symbolInputValue: string): boolean {
  return symbolInputValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => {
      const match = value.match(/^[A-Za-z]+\s*:\s*(.+)$/);
      if (!match) {
        return false;
      }

      return /[A-Za-z]+\s*:/.test(match[1]);
    });
}

function updateSpeedIndicator() {
  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${chartSpeedMultiplier.toFixed(1)}x`;
  }
}

function setStatus(text: string) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function showLoadingModal() {
  if (loadingModalEl) {
    loadingModalEl.hidden = false;
  }
}

function hideLoadingModal() {
  if (loadingModalEl) {
    loadingModalEl.hidden = true;
  }
}

function renderSummary(summary: Extract<JobResponse, {status: "completed"}>["summary"]) {
  if (!summaryEl) {
    return;
  }

  const aliasRules = parseLegendAliasRules(legendAliasesInput?.value ?? "");
  summaryEl.innerHTML = summary
    .map((item) => {
      const displayLabel = applyLegendAliases(item.strategyLabel, aliasRules);
      return `
        <article class="summary-card">
          <h3>${displayLabel}</h3>
          <strong>${Math.round(item.finalValue).toLocaleString()}</strong>
          <div>Return ${item.totalReturnPct.toFixed(2)}%</div>
          <div>MDD ${item.maxDrawdownPct.toFixed(2)}%</div>
          <div>Trades ${item.tradeCount}</div>
        </article>
      `;
    })
    .join("");
}

function renderLegend(preview: ChartPreviewPayload) {
  if (!chartLegendEl) {
    return;
  }

  const aliasRules = parseLegendAliasRules(legendAliasesInput?.value ?? "");
  chartLegendEl.innerHTML = preview.series
    .map((series, index) => {
      const color = colors[index % colors.length];
      const label = applyLegendAliases(series.strategyLabel, aliasRules);
      return `
        <div class="chart-legend-item">
          <span class="chart-legend-swatch" style="background:${color}"></span>
          <span>${label}</span>
        </div>
      `;
    })
    .join("");
}

function stopChartAnimation() {
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function parseLegendAliasRules(rawText: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.includes("=") ? trimmed.indexOf("=") : trimmed.indexOf("=>");
    if (separatorIndex < 0) {
      continue;
    }

    const left = trimmed.slice(0, separatorIndex).trim();
    const right = trimmed.slice(separatorIndex + (trimmed.includes("=>") ? 2 : 1)).trim();
    if (left && right) {
      rules.set(left, right);
    }
  }
  return rules;
}

function applyLegendAliases(label: string, rules: Map<string, string>): string {
  if (rules.size === 0) {
    return label;
  }

  const exactMatch = rules.get(label);
  if (exactMatch) {
    return exactMatch;
  }

  return label
    .split(" | ")
    .map((part) => rules.get(part) ?? part)
    .join(" | ");
}

function createPlaceholderDatasets(preview: ChartPreviewPayload): ChartDataset<"line", Array<{x: number; y: number}>>[] {
  const aliasRules = parseLegendAliasRules(legendAliasesInput?.value ?? "");
  return preview.series.map((series, index) => {
    const color = colors[index % colors.length];
    return {
      label: applyLegendAliases(series.strategyLabel, aliasRules),
      data: series.timeline.map(() => ({x: 0, y: Number.NaN})),
      borderColor: color,
      backgroundColor: `${color}22`,
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.35,
      fill: false,
      spanGaps: false,
      parsing: false,
    };
  });
}

function calculateVisibleYDomain(preview: ChartPreviewPayload, visiblePoints: number) {
  const visibleValues = preview.series.flatMap((series) =>
    series.timeline.slice(0, visiblePoints).map((point) => point.marketValue),
  );

  if (visibleValues.length === 0) {
    return {min: 0, max: 1};
  }

  const minValue = Math.min(...visibleValues);
  const maxValue = Math.max(...visibleValues);
  const range = maxValue - minValue;
  const padding = range === 0 ? Math.max(1, Math.abs(maxValue) * 0.05 || 1) : range * 0.12;

  return {
    min: minValue - padding,
    max: maxValue + padding,
  };
}

function calculateXAxisLayout(labels: string[], visiblePoints: number) {
  const visibleLabels = labels.slice(0, visiblePoints);
  const positions = visibleLabels.map((label) => dateToAxisValue(label));
  const markerIndexes = buildXAxisMarkerIndexes(visibleLabels.length);
  const markers = markerIndexes.map((index) => ({
    position: positions[index] ?? 0,
    label: visibleLabels[index] ?? "",
  }));

  return {positions, markers};
}

function buildXAxisMarkerIndexes(visiblePoints: number): number[] {
  if (visiblePoints <= 1) {
    return [0];
  }

  const maxMarkers = Math.min(5, visiblePoints);
  const indexes = new Set<number>([0, visiblePoints - 1]);
  for (let marker = 1; marker < maxMarkers - 1; marker += 1) {
    indexes.add(Math.round(((visiblePoints - 1) * marker) / (maxMarkers - 1)));
  }

  return [...indexes].sort((left, right) => left - right);
}

function formatXAxisTick(value: number): string {
  if (currentXAxisMarkers.length === 0) {
    return "";
  }

  let closest = currentXAxisMarkers[0];
  let closestDistance = Math.abs(value - closest.position);
  for (const marker of currentXAxisMarkers) {
    const distance = Math.abs(value - marker.position);
    if (distance < closestDistance) {
      closest = marker;
      closestDistance = distance;
    }
  }

  const minPosition = currentXAxisMarkers[0]?.position ?? 0;
  const maxPosition = currentXAxisMarkers[currentXAxisMarkers.length - 1]?.position ?? minPosition;
  const threshold = Math.max((maxPosition - minPosition) / 20, 86400000 * 2);

  return closestDistance <= threshold ? closest.label : "";
}

const lineLabelPlugin = {
  id: "lineLabelPlugin",
  afterDatasetsDraw(chartInstance: any) {
    const ctx = chartInstance.ctx;
    const yScale = chartInstance.scales?.y;
    if (!ctx || !yScale || currentLineLabels.length === 0) {
      return;
    }

    ctx.save();
    ctx.font = "12px Segoe UI";
    ctx.textBaseline = "middle";

    const placed: Array<{top: number; bottom: number}> = [];
    const sortedLabels = [...currentLineLabels].sort((left, right) => left.y - right.y);
    for (const item of sortedLabels) {
      let y = item.y;
      const text = `${item.label}  ${Math.round(item.value).toLocaleString()}`;
      const metrics = ctx.measureText(text);
      const boxWidth = metrics.width + 16;
      const boxHeight = 22;
      const x = Math.min(item.x + 10, chartInstance.chartArea.right - boxWidth);

      for (const existing of placed) {
        if (y + boxHeight / 2 >= existing.top && y - boxHeight / 2 <= existing.bottom) {
          y = existing.bottom + boxHeight / 2 + 4;
        }
      }

      y = Math.max(chartInstance.chartArea.top + boxHeight / 2, Math.min(y, chartInstance.chartArea.bottom - boxHeight / 2));

      ctx.fillStyle = "rgba(7, 17, 31, 0.88)";
      ctx.strokeStyle = `${item.color}66`;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y - boxHeight / 2, boxWidth, boxHeight, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x + 10, y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#f5f7fb";
      ctx.fillText(text, x + 20, y);
      placed.push({top: y - boxHeight / 2, bottom: y + boxHeight / 2});
    }

    ctx.restore();
  },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function animateChart(preview: ChartPreviewPayload, totalPoints: number) {
  if (!chart) {
    return;
  }

  const animationDurationMs = Math.max(9600, Math.round(4200 * chartSpeedMultiplier));
  const startedAt = performance.now();
  let lastVisiblePoints = -1;

  const step = (now: number) => {
    if (!chart) {
      return;
    }
    const activeChart = chart;

    const elapsed = now - startedAt;
    const progress = Math.min(1, elapsed / animationDurationMs);
    const visiblePoints = Math.max(1, Math.ceil(progress * totalPoints));
    if (visiblePoints === lastVisiblePoints && progress < 1) {
      animationFrameId = window.requestAnimationFrame(step);
      return;
    }

    lastVisiblePoints = visiblePoints;
    const labels = preview.series[0]?.timeline.map((point) => point.date) ?? [];
    const xAxisLayout = calculateXAxisLayout(labels, visiblePoints);
    currentXAxisMarkers = xAxisLayout.markers;
    const fullXAxisValues = labels.map((label) => dateToAxisValue(label));
    const xMin = fullXAxisValues[0] ?? 0;
    const xMax = fullXAxisValues[fullXAxisValues.length - 1] ?? xMin + 1;

    preview.series.forEach((series, index) => {
      const dataset = chart?.data.datasets[index];
      if (!dataset) {
        return;
      }

      const nextData = series.timeline.map((point, pointIndex) => ({
        x: dateToAxisValue(point.date),
        y: pointIndex < visiblePoints ? point.marketValue : Number.NaN,
      }));
      dataset.data = nextData;
    });

    const domain = calculateVisibleYDomain(preview, visiblePoints);
    if (!activeChart.options.scales) {
      activeChart.options.scales = {};
    }
    if (!activeChart.options.scales.x) {
      activeChart.options.scales.x = {};
    }
    if (!activeChart.options.scales.y) {
      activeChart.options.scales.y = {};
    }
    activeChart.options.scales.x.min = xMin;
    activeChart.options.scales.x.max = xMax;
    activeChart.options.scales.y.min = domain.min;
    activeChart.options.scales.y.max = domain.max;

    activeChart.update("none");

    currentLineLabels = [];
    preview.series.forEach((series, index) => {
      const dataset = activeChart.data.datasets[index];
      if (!dataset) {
        return;
      }

      const meta = activeChart.getDatasetMeta(index);
      const dataPointIndex = Math.min(visiblePoints - 1, series.timeline.length - 1);
      const visualPoint = meta.data?.[dataPointIndex];
      const value = series.timeline[dataPointIndex]?.marketValue;
      if (visualPoint?.x !== undefined && visualPoint?.y !== undefined && value !== undefined) {
        currentLineLabels.push({
          label: dataset.label ?? "",
          color: colors[index % colors.length],
          x: visualPoint.x,
          y: visualPoint.y,
          value,
        });
      }
    });

    if (progress < 1) {
      animationFrameId = window.requestAnimationFrame(step);
      return;
    }

    animationFrameId = null;
  };

  stopChartAnimation();
  animationFrameId = window.requestAnimationFrame(step);
}

function renderChart(preview: ChartPreviewPayload) {
  if (!chartCanvas || !chartTitleEl || !chartSubtitleEl) {
    return;
  }

  chartTitleEl.textContent = preview.title;
  chartSubtitleEl.textContent = preview.subtitle ?? "";
  latestPreview = preview;
  updateSpeedIndicator();
  renderLegend(preview);

  const labels = preview.series[0]?.timeline.map((point) => point.date) ?? [];
  const totalPoints = Math.max(...preview.series.map((series) => series.timeline.length), 1);
  const initialDomain = calculateVisibleYDomain(preview, 1);
  currentXAxisMarkers = calculateXAxisLayout(labels, 1).markers;
  currentLineLabels = [];

  if (chart) {
    stopChartAnimation();
    chart.destroy();
  }

  chart = new ChartJs(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: createPlaceholderDatasets(preview),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      layout: {
        padding: {
          top: 8,
          right: 8,
          bottom: 4,
          left: 4,
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#f5f7fb",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            padding: 12,
            font: {
              size: 13,
            },
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const item = items[0];
              if (!item) {
                return "";
              }

              return labels[item.dataIndex] ?? "";
            },
            label: (context) => {
              const raw = context.raw as {x: number; y: number};
              return `${context.dataset.label}: ${Math.round(Number(raw.y)).toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: {
            color: "#99a8bf",
            maxTicksLimit: 5,
            maxRotation: 0,
            callback: (value) => formatXAxisTick(Number(value)),
          },
          grid: {
            color: "rgba(255,255,255,0.08)",
          },
        },
        y: {
          min: initialDomain.min,
          max: initialDomain.max,
          ticks: {
            color: "#99a8bf",
            maxTicksLimit: 8,
            callback: (value) => {
              const yScale = chart?.options.scales?.y;
              const currentRange =
                typeof yScale?.max === "number" && typeof yScale?.min === "number" ? yScale.max - yScale.min : initialDomain.max - initialDomain.min;
              return formatYAxisValue(Number(value), currentRange);
            },
          },
          grid: {
            color: "rgba(255,255,255,0.08)",
          },
        },
      },
    },
    plugins: [lineLabelPlugin],
  }) as RenderableChart;

  animateChart(preview, totalPoints);
}

function formatYAxisValue(value: number, range: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const maximumFractionDigits = range < 5 ? 2 : range < 50 ? 1 : 0;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

async function pollJob(jobId: string) {
  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = (await response.json()) as JobResponse;

    if (job.status === "queued") {
      setStatus("Queued");
    }

    if (job.status === "running") {
      setStatus("Fetching market data and running backtest");
    }

    if (job.status === "failed") {
      hideLoadingModal();
      setStatus(`Failed: ${job.error}`);
      return;
    }

    if (job.status === "completed") {
      hideLoadingModal();
      setStatus("Chart ready");
      renderSummary(job.summary);
      renderChart(job.preview);
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

for (const button of exampleButtons) {
  button.addEventListener("click", () => {
    if (symbolInput) {
      symbolInput.value = button.dataset.symbol ?? "";
    }
  });
}

speedDownButton?.addEventListener("click", () => {
  chartSpeedMultiplier = Math.min(12, Number((chartSpeedMultiplier + 0.5).toFixed(1)));
  updateSpeedIndicator();
  if (latestPreview) {
    renderChart(latestPreview);
  }
});

speedUpButton?.addEventListener("click", () => {
  chartSpeedMultiplier = Math.max(0.3, Number((chartSpeedMultiplier - 0.5).toFixed(1)));
  updateSpeedIndicator();
  if (latestPreview) {
    renderChart(latestPreview);
  }
});

replayButton?.addEventListener("click", () => {
  if (latestPreview) {
    renderChart(latestPreview);
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const startDate = (document.querySelector<HTMLInputElement>("#start-date")?.value ?? "").trim();
  const endDate = (document.querySelector<HTMLInputElement>("#end-date")?.value ?? "").trim();
  const capital = Number((document.querySelector<HTMLInputElement>("#capital")?.value ?? "0").trim());
  const savingsAnnualRatePct = Number((document.querySelector<HTMLInputElement>("#savings-rate")?.value ?? "0").trim());
  const baseCurrency = (document.querySelector<HTMLSelectElement>("#base-currency")?.value ?? "KRW").trim();
  const frequency = (document.querySelector<HTMLSelectElement>("#frequency")?.value ?? "day").trim();
  const strategyIds = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="strategy"]:checked')).map(
    (input) => input.value,
  );
  const symbol = symbolInput?.value.trim() ?? "";

  if (hasMissingMarketPrefix(symbol)) {
    window.alert("Every symbol must include a market prefix. Example: KRX: 005930, NASDAQ: MSFT");
    return;
  }

  if (hasMergedSymbols(symbol)) {
    window.alert("Multiple symbols must be separated by commas. Example: NASDAQ: QQQ, NASDAQ: AAPL");
    return;
  }

  if (!Number.isFinite(savingsAnnualRatePct) || savingsAnnualRatePct < 0) {
    window.alert("Savings annual rate must be 0 or higher.");
    return;
  }

  setStatus("Submitting request");
  showLoadingModal();
  if (summaryEl) {
    summaryEl.innerHTML = "";
  }
  if (chartLegendEl) {
    chartLegendEl.innerHTML = "";
  }
  if (chartTitleEl) {
    chartTitleEl.textContent = "Chart Preview";
  }
  if (chartSubtitleEl) {
    chartSubtitleEl.textContent = "Use screen recording after the animation settles.";
  }
  if (chart) {
    stopChartAnimation();
    chart.destroy();
    chart = null;
  }

  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        symbol,
        startDate,
        endDate,
        capital,
        savingsAnnualRatePct,
        baseCurrency,
        frequency,
        strategyIds,
      }),
    });

    const payload = (await response.json()) as {jobId?: string; error?: string};
    if (!response.ok || !payload.jobId) {
      hideLoadingModal();
      setStatus(`Failed: ${payload.error ?? "Unknown error"}`);
      return;
    }

    await pollJob(payload.jobId);
  } catch (error) {
    hideLoadingModal();
    setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
