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
const speedDownButton = document.querySelector<HTMLButtonElement>("#speed-down");
const speedUpButton = document.querySelector<HTMLButtonElement>("#speed-up");
const replayButton = document.querySelector<HTMLButtonElement>("#replay-chart");
const speedIndicator = document.querySelector<HTMLDivElement>("#speed-indicator");
const ChartJs = window.Chart;

let chart: {destroy: () => void} | null = null;
let chartAnimationStarted = false;
let chartSpeedMultiplier = 1;
let latestPreview: ChartPreviewPayload | null = null;

function hasMissingMarketPrefix(symbolInputValue: string): boolean {
  return symbolInputValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => !/^[A-Za-z]+\s*:\s*.+$/.test(value));
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

function renderSummary(summary: Extract<JobResponse, {status: "completed"}>["summary"]) {
  if (!summaryEl) {
    return;
  }

  summaryEl.innerHTML = summary
    .map((item) => {
      return `
        <article class="summary-card">
          <h3>${item.strategyLabel}</h3>
          <strong>${Math.round(item.finalValue).toLocaleString()}</strong>
          <div>Return ${item.totalReturnPct.toFixed(2)}%</div>
          <div>MDD ${item.maxDrawdownPct.toFixed(2)}%</div>
          <div>Trades ${item.tradeCount}</div>
        </article>
      `;
    })
    .join("");
}

function buildDatasets(preview: ChartPreviewPayload): ChartDataset<"line", number[]>[] {
  return preview.series.map((series, index) => {
    const color = colors[index % colors.length];
    const data: number[] = series.timeline.map((point) => point.marketValue);
    return {
      label: series.strategyLabel,
      data,
      borderColor: color,
      backgroundColor: `${color}22`,
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.35,
      fill: false,
    };
  });
}

function renderChart(preview: ChartPreviewPayload) {
  if (!chartCanvas || !chartTitleEl || !chartSubtitleEl) {
    return;
  }

  chartTitleEl.textContent = preview.title;
  chartSubtitleEl.textContent = preview.subtitle ?? "";
  latestPreview = preview;
  updateSpeedIndicator();

  const labels = preview.series[0]?.timeline.map((point) => point.date) ?? [];
  const datasets = buildDatasets(preview);
  const totalPoints = Math.max(...preview.series.map((series) => series.timeline.length), 1);
  const delayBetweenPoints = Math.max(8, Math.floor((2200 / totalPoints) * chartSpeedMultiplier));

  if (chart) {
    chart.destroy();
  }

  chartAnimationStarted = false;

  chart = new ChartJs(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animations: {
        x: {
          type: "number",
          easing: "linear",
          duration: delayBetweenPoints,
          from: NaN,
          delay(context: any) {
            if (context.type !== "data" || context.xStarted) {
              return 0;
            }

            context.xStarted = true;
            if (!chartAnimationStarted) {
              chartAnimationStarted = true;
            }

            return context.dataIndex * delayBetweenPoints;
          },
        },
        y: {
          type: "number",
          easing: "easeOutQuart",
          duration: delayBetweenPoints,
          from(context: any) {
            if (context.type !== "data") {
              return 0;
            }

            const dataset = context.chart.data.datasets[context.datasetIndex];
            const data = dataset.data as number[];
            const previousValue = context.dataIndex > 0 ? data[context.dataIndex - 1] : data[0];
            return previousValue ?? 0;
          },
          delay(context: any) {
            if (context.type !== "data" || context.yStarted) {
              return 0;
            }

            context.yStarted = true;
            return context.dataIndex * delayBetweenPoints;
          },
        },
      },
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
          labels: {
            color: "#f5f7fb",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            padding: 12,
            font: {
              size: 12,
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${Math.round(Number(context.raw)).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#99a8bf",
            maxTicksLimit: 5,
            maxRotation: 0,
          },
          grid: {
            color: "rgba(255,255,255,0.08)",
          },
        },
        y: {
          ticks: {
            color: "#99a8bf",
            maxTicksLimit: 6,
            callback: (value) => Number(value).toLocaleString(),
          },
          grid: {
            color: "rgba(255,255,255,0.08)",
          },
        },
      },
    },
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
      setStatus(`Failed: ${job.error}`);
      return;
    }

    if (job.status === "completed") {
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
  chartSpeedMultiplier = Math.min(4, Number((chartSpeedMultiplier + 0.5).toFixed(1)));
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
  const baseCurrency = (document.querySelector<HTMLSelectElement>("#base-currency")?.value ?? "KRW").trim();
  const strategyIds = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="strategy"]:checked')).map(
    (input) => input.value,
  );
  const symbol = symbolInput?.value.trim() ?? "";

  if (hasMissingMarketPrefix(symbol)) {
    window.alert("Every symbol must include a market prefix. Example: KRX: 005930, NASDAQ: MSFT");
    return;
  }

  setStatus("Submitting request");
  if (summaryEl) {
    summaryEl.innerHTML = "";
  }
  if (chartTitleEl) {
    chartTitleEl.textContent = "Chart Preview";
  }
  if (chartSubtitleEl) {
    chartSubtitleEl.textContent = "Use screen recording after the animation settles.";
  }
  if (chart) {
    chart.destroy();
    chart = null;
  }

  const response = await fetch("/api/preview", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      symbol,
      startDate,
      endDate,
      capital,
      baseCurrency,
      strategyIds,
    }),
  });

  const payload = (await response.json()) as {jobId?: string; error?: string};
  if (!response.ok || !payload.jobId) {
    setStatus(`Failed: ${payload.error ?? "Unknown error"}`);
    return;
  }

  await pollJob(payload.jobId);
});
