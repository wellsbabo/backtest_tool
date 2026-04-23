import express from "express";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compareStrategies} from "../engine/backtest.js";
import type {ChartPreviewPayload, StrategyRunResult} from "../schemas/backtest-result.js";
import {PythonMarketDataProvider} from "../market-data/python-provider.js";
import {legacyPresetStrategies} from "../strategies/presets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const publicDir = path.join(projectRoot, "public");

type ScenarioPayload = {
  symbols: string[];
  startDate: `${number}-${number}-${number}`;
  endDate: `${number}-${number}-${number}`;
  capital: number;
  strategyIds: string[];
};

type CompletedJob = {
  status: "completed";
  preview: ChartPreviewPayload;
  summary: Array<{
    strategyLabel: string;
    finalValue: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    tradeCount: number;
  }>;
};

type JobState = {status: "queued"} | {status: "running"} | CompletedJob | {status: "failed"; error: string};

const jobs = new Map<string, JobState>();
const provider = new PythonMarketDataProvider();

function normalizeSymbolInput(rawSymbol: string): string {
  const trimmed = rawSymbol.trim();
  const match = trimmed.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
  if (!match) {
    return trimmed;
  }

  return match[2].trim().toUpperCase();
}

function parseSymbols(rawSymbols: string): string[] {
  const symbols = rawSymbols
    .split(",")
    .map((value) => normalizeSymbolInput(value))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(symbols)];
}

function ensureScenarioPayload(payload: unknown): ScenarioPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload.");
  }

  const candidate = payload as Record<string, unknown>;
  const strategyIds = Array.isArray(candidate.strategyIds)
    ? candidate.strategyIds.filter((value): value is string => typeof value === "string")
    : [];

  if (!candidate.symbol || typeof candidate.symbol !== "string") {
    throw new Error("At least one symbol is required.");
  }

  if (typeof candidate.startDate !== "string" || typeof candidate.endDate !== "string") {
    throw new Error("Date range is required.");
  }

  if (typeof candidate.capital !== "number" || !Number.isFinite(candidate.capital) || candidate.capital <= 0) {
    throw new Error("Capital must be a positive number.");
  }

  if (strategyIds.length === 0) {
    throw new Error("At least one strategy must be selected.");
  }

  const symbols = parseSymbols(candidate.symbol);
  if (symbols.length === 0) {
    throw new Error("At least one valid symbol is required.");
  }

  return {
    symbols,
    startDate: candidate.startDate as `${number}-${number}-${number}`,
    endDate: candidate.endDate as `${number}-${number}-${number}`,
    capital: candidate.capital,
    strategyIds,
  };
}

function buildPreviewPayload(symbols: string[], startDate: string, endDate: string, results: StrategyRunResult[]): ChartPreviewPayload {
  return {
    title: symbols.length === 1 ? `${symbols[0]} Strategy Comparison` : `${symbols.join(" vs ")} Comparison`,
    subtitle: `${startDate} to ${endDate}`,
    series: results,
  };
}

async function runScenario(jobId: string, scenario: ScenarioPayload) {
  jobs.set(jobId, {status: "running"});

  try {
    const selectedStrategies = legacyPresetStrategies.filter((strategy) => scenario.strategyIds.includes(strategy.id));
    const resultGroups = await Promise.all(
      scenario.symbols.map(async (symbol) => {
        const marketData = await provider.getDailyCloses({
          symbol,
          startDate: scenario.startDate,
          endDate: scenario.endDate,
        });

        return compareStrategies(scenario.capital, marketData.bars, selectedStrategies).map((result) => ({
          ...result,
          strategyId: `${symbol}__${result.strategyId}`,
          strategyLabel: `${symbol} | ${result.strategyLabel}`,
        }));
      }),
    );

    const results = resultGroups.flat();

    jobs.set(jobId, {
      status: "completed",
      preview: buildPreviewPayload(scenario.symbols, scenario.startDate, scenario.endDate, results),
      summary: results.map((result) => ({
        strategyLabel: result.strategyLabel,
        finalValue: result.summary.finalValue,
        totalReturnPct: result.summary.totalReturnPct,
        maxDrawdownPct: result.summary.maxDrawdownPct,
        tradeCount: result.summary.tradeCount,
      })),
    });
  } catch (error) {
    jobs.set(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startAppServer(port = 3000) {
  const app = express();

  app.use(express.json({limit: "1mb"}));
  app.use(express.static(publicDir));
  app.use("/assets", express.static(path.join(projectRoot, "dist", "src", "app-client")));
  app.use("/vendor", express.static(path.join(projectRoot, "node_modules", "chart.js", "dist")));

  app.post("/api/preview", async (req, res) => {
    try {
      const scenario = ensureScenarioPayload(req.body);
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      jobs.set(jobId, {status: "queued"});
      void runScenario(jobId, scenario);
      res.status(202).json({jobId});
    } catch (error) {
      res.status(400).json({error: error instanceof Error ? error.message : String(error)});
    }
  });

  app.get("/api/jobs/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({error: "Job not found."});
      return;
    }

    res.json(job);
  });

  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`Backtest GUI running at http://localhost:${port}`);
      resolve();
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startAppServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
