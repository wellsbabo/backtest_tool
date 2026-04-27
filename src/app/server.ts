import express from "express";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {calculateMaxDrawdownPct} from "../analytics/summary.js";
import {compareStrategies} from "../engine/backtest.js";
import type {ChartPreviewPayload, StrategyRunResult} from "../schemas/backtest-result.js";
import type {DailyCloseBar} from "../market-data/types.js";
import {PythonMarketDataProvider} from "../market-data/python-provider.js";
import {legacyPresetStrategies} from "../strategies/presets.js";
import {MarketDataFxRateProvider, findRateOnOrBefore} from "../market-data/fx-rates.js";
import {parsePrefixedSymbol, type ParsedSymbol} from "../market-data/market-prefixes.js";
import type {CurrencyCode} from "../domain/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const publicDir = path.join(projectRoot, "public");

type ScenarioPayload = {
  symbols: ParsedSymbol[];
  startDate: `${number}-${number}-${number}`;
  endDate: `${number}-${number}-${number}`;
  capital: number;
  savingsAnnualRatePct: number;
  strategyIds: string[];
  baseCurrency: CurrencyCode;
  frequency: "day" | "week" | "month" | "year";
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
const fxProvider = new MarketDataFxRateProvider(provider);

function parseSymbols(rawSymbols: string): ParsedSymbol[] {
  const parsedSymbols = rawSymbols
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parsePrefixedSymbol(value));

  return [...new Map(parsedSymbols.map((symbol) => [symbol.displaySymbol, symbol])).values()];
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

  const savingsAnnualRatePct =
    typeof candidate.savingsAnnualRatePct === "number" && Number.isFinite(candidate.savingsAnnualRatePct)
      ? candidate.savingsAnnualRatePct
      : 0;
  if (savingsAnnualRatePct < 0) {
    throw new Error("Savings annual rate must be 0 or higher.");
  }

  if (strategyIds.length === 0) {
    throw new Error("At least one strategy must be selected.");
  }

  const symbols = parseSymbols(candidate.symbol);
  if (symbols.length === 0) {
    throw new Error("At least one valid symbol is required.");
  }
  const baseCurrency = typeof candidate.baseCurrency === "string" ? candidate.baseCurrency.toUpperCase() : "KRW";
  const frequency = candidate.frequency;
  if (frequency !== "day" && frequency !== "week" && frequency !== "month" && frequency !== "year") {
    throw new Error("Frequency must be one of day, week, month, or year.");
  }

  return {
    symbols,
    startDate: candidate.startDate as `${number}-${number}-${number}`,
    endDate: candidate.endDate as `${number}-${number}-${number}`,
    capital: candidate.capital,
    savingsAnnualRatePct,
    strategyIds,
    baseCurrency,
    frequency,
  };
}

function buildPreviewPayload(symbols: ParsedSymbol[], startDate: string, endDate: string, results: StrategyRunResult[]): ChartPreviewPayload {
  return {
    title:
      symbols.length === 1
        ? `${symbols[0].displaySymbol} Strategy Comparison`
        : `${symbols.map((symbol) => symbol.displaySymbol).join(" vs ")} Comparison`,
    subtitle: `${startDate} to ${endDate}`,
    series: results,
  };
}

function createPriceSeries(
  symbol: ParsedSymbol,
  bars: DailyCloseBar[],
  mode: "normalized" | "converted",
  convertedValues?: Array<{date: `${number}-${number}-${number}`; value: number}>,
): StrategyRunResult {
  const firstClose = bars[0]?.close ?? 0;
  const convertedByDate = new Map(convertedValues?.map((point) => [point.date, point.value]) ?? []);
  const initialConvertedValue = convertedValues?.[0]?.value ?? 0;
  const timeline = bars.map((bar) => {
    const marketValue =
      mode === "normalized" ? (firstClose === 0 ? 0 : (bar.close / firstClose) * 100) : (convertedByDate.get(bar.date) ?? 0);
    const initialValueForReturn = mode === "normalized" ? 100 : initialConvertedValue;

    return {
      date: bar.date,
      close: bar.close,
      investedPrincipal: initialValueForReturn,
      marketValue,
      cash: 0,
      positionExposure: 1,
      units: 1,
      signal: "hold" as const,
      cumulativeReturnPct: initialValueForReturn === 0 ? 0 : ((marketValue - initialValueForReturn) / initialValueForReturn) * 100,
    };
  });
  const values = timeline.map((point) => point.marketValue);
  const initialValue = values[0] ?? 0;
  const lastValue = values[values.length - 1] ?? 0;

  return {
    strategyId: `${symbol.displaySymbol}__${mode === "normalized" ? "normalized-price" : "converted-price"}`,
    strategyLabel: `${symbol.displaySymbol} | ${mode === "normalized" ? "Normalized Price" : `FX Converted Price (${bars[0]?.currency})`}`,
    symbol: symbol.displaySymbol,
    currency: mode === "converted" ? bars[0]?.currency : symbol.currency,
    market: symbol.prefix,
    source: bars[0]?.source ?? "FinanceDataReader",
    inputBars: bars,
    timeline,
    trades: [],
    summary: {
      initialCapital: initialValue,
      finalValue: lastValue,
      investedPrincipal: initialValue,
      profit: lastValue - initialValue,
      totalReturnPct: initialValue === 0 ? 0 : ((lastValue - initialValue) / initialValue) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(values),
      tradeCount: 0,
      startDate: bars[0]?.date ?? "",
      endDate: bars[bars.length - 1]?.date ?? "",
    },
    chartDomain: {
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      startDate: bars[0]?.date ?? "",
      endDate: bars[bars.length - 1]?.date ?? "",
    },
  };
}

async function createConvertedPriceSeries(
  symbol: ParsedSymbol,
  bars: DailyCloseBar[],
  baseCurrency: CurrencyCode,
  startDate: `${number}-${number}-${number}`,
  endDate: `${number}-${number}-${number}`,
): Promise<StrategyRunResult> {
  const fromCurrency = symbol.currency.toUpperCase();
  const toCurrency = baseCurrency.toUpperCase();
  const rates =
    fromCurrency === toCurrency
      ? new Map<`${number}-${number}-${number}`, number>()
      : await fxProvider.getConversionRates({
          fromCurrency,
          toCurrency,
          startDate,
          endDate,
        });
  const convertedValues = bars.map((bar) => {
    const rate = fromCurrency === toCurrency ? 1 : findRateOnOrBefore(rates, bar.date);
    if (rate === undefined) {
      throw new Error(`FX rate missing for ${symbol.displaySymbol} on ${bar.date}: ${fromCurrency}/${toCurrency}`);
    }
    return {date: bar.date, value: bar.close * rate};
  });
  const result = createPriceSeries(symbol, bars, "converted", convertedValues);

  return {
    ...result,
    currency: toCurrency,
    strategyLabel: `${symbol.displaySymbol} | FX Converted Price (${toCurrency})`,
  };
}

function createSavingsSeries(
  capital: number,
  annualRatePct: number,
  bars: DailyCloseBar[],
  currency: CurrencyCode,
): StrategyRunResult {
  if (bars.length === 0) {
    throw new Error("Savings benchmark requires at least one bar.");
  }

  const annualRate = annualRatePct / 100;
  const startDateMs = Date.parse(`${bars[0].date}T00:00:00Z`);
  const timeline = bars.map((bar) => {
    const elapsedDays = Math.max(0, (Date.parse(`${bar.date}T00:00:00Z`) - startDateMs) / 86400000);
    const marketValue = capital * (1 + annualRate / 365) ** elapsedDays;

    return {
      date: bar.date,
      close: marketValue,
      investedPrincipal: capital,
      marketValue,
      cash: marketValue,
      positionExposure: 0,
      units: 0,
      signal: "hold" as const,
      cumulativeReturnPct: capital === 0 ? 0 : ((marketValue - capital) / capital) * 100,
    };
  });
  const values = timeline.map((point) => point.marketValue);
  const finalValue = values[values.length - 1] ?? capital;

  return {
    strategyId: "savings-interest",
    strategyLabel: `Savings Interest Benchmark (${annualRatePct.toFixed(2)}%)`,
    symbol: "Savings",
    currency,
    market: "BANK",
    source: "Derived",
    inputBars: bars,
    timeline,
    trades: [],
    summary: {
      initialCapital: capital,
      finalValue,
      investedPrincipal: capital,
      profit: finalValue - capital,
      totalReturnPct: capital === 0 ? 0 : ((finalValue - capital) / capital) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(values),
      tradeCount: 0,
      startDate: bars[0]?.date ?? "",
      endDate: bars[bars.length - 1]?.date ?? "",
    },
    chartDomain: {
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      startDate: bars[0]?.date ?? "",
      endDate: bars[bars.length - 1]?.date ?? "",
    },
  };
}

async function runScenario(jobId: string, scenario: ScenarioPayload) {
  jobs.set(jobId, {status: "running"});

  try {
    const includeConvertedPrice = scenario.strategyIds.includes("converted-price");
    const includeNormalizedPrice = scenario.strategyIds.includes("normalized-price");
    const includeSavingsInterest = scenario.strategyIds.includes("savings-interest");
    const selectedStrategies = legacyPresetStrategies.filter((strategy) => scenario.strategyIds.includes(strategy.id));
    let savingsBenchmarkBars: DailyCloseBar[] | null = null;
    const resultGroups = await Promise.all(
      scenario.symbols.map(async (symbol) => {
        const marketData = await provider.getDailyCloses({
          symbol: symbol.providerSymbol,
          startDate: scenario.startDate,
          endDate: scenario.endDate,
        });
        const bars = marketData.bars.map((bar) => ({
          ...bar,
          symbol: symbol.displaySymbol,
          currency: symbol.currency,
          market: symbol.prefix,
        }));
        const sampledBars = resampleBars(bars, scenario.frequency);
        if (!savingsBenchmarkBars) {
          savingsBenchmarkBars = sampledBars;
        }

        const strategyResults = compareStrategies(scenario.capital, sampledBars, selectedStrategies).map((result) => ({
          ...result,
          strategyId: `${symbol.displaySymbol}__${result.strategyId}`,
          strategyLabel: `${symbol.displaySymbol} | ${result.strategyLabel}`,
          symbol: symbol.displaySymbol,
          currency: symbol.currency,
          market: symbol.prefix,
        }));

        const optionResults: StrategyRunResult[] = [];
        if (includeNormalizedPrice) {
          optionResults.push(createPriceSeries(symbol, sampledBars, "normalized"));
        }
        if (includeConvertedPrice) {
          optionResults.push(
            await createConvertedPriceSeries(symbol, sampledBars, scenario.baseCurrency, scenario.startDate, scenario.endDate),
          );
        }

        return [...optionResults, ...strategyResults];
      }),
    );

    const results = resultGroups.flat();
    if (includeSavingsInterest && savingsBenchmarkBars) {
      results.unshift(createSavingsSeries(scenario.capital, scenario.savingsAnnualRatePct, savingsBenchmarkBars, scenario.baseCurrency));
    }

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

function resampleBars(bars: DailyCloseBar[], frequency: ScenarioPayload["frequency"]): DailyCloseBar[] {
  if (frequency === "day") {
    return bars;
  }

  const grouped = new Map<string, DailyCloseBar>();
  for (const bar of bars) {
    grouped.set(getBucketKey(bar.date, frequency), bar);
  }

  return [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function getBucketKey(date: string, frequency: Exclude<ScenarioPayload["frequency"], "day">): string {
  if (frequency === "month") {
    return date.slice(0, 7);
  }

  if (frequency === "year") {
    return date.slice(0, 4);
  }

  const utcDate = new Date(`${date}T00:00:00Z`);
  const weekYearDate = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate()));
  const dayNumber = weekYearDate.getUTCDay() || 7;
  weekYearDate.setUTCDate(weekYearDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(weekYearDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((weekYearDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYearDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
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
