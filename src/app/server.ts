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
  strategyIds: string[];
  baseCurrency: CurrencyCode;
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

  if (strategyIds.length === 0) {
    throw new Error("At least one strategy must be selected.");
  }

  const symbols = parseSymbols(candidate.symbol);
  if (symbols.length === 0) {
    throw new Error("At least one valid symbol is required.");
  }
  const baseCurrency = typeof candidate.baseCurrency === "string" ? candidate.baseCurrency.toUpperCase() : "KRW";

  return {
    symbols,
    startDate: candidate.startDate as `${number}-${number}-${number}`,
    endDate: candidate.endDate as `${number}-${number}-${number}`,
    capital: candidate.capital,
    strategyIds,
    baseCurrency,
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

async function runScenario(jobId: string, scenario: ScenarioPayload) {
  jobs.set(jobId, {status: "running"});

  try {
    const includeConvertedPrice = scenario.strategyIds.includes("converted-price");
    const includeNormalizedPrice = scenario.strategyIds.includes("normalized-price");
    const selectedStrategies = legacyPresetStrategies.filter((strategy) => scenario.strategyIds.includes(strategy.id));
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

        const strategyResults = compareStrategies(scenario.capital, bars, selectedStrategies).map((result) => ({
          ...result,
          strategyId: `${symbol.displaySymbol}__${result.strategyId}`,
          strategyLabel: `${symbol.displaySymbol} | ${result.strategyLabel}`,
          symbol: symbol.displaySymbol,
          currency: symbol.currency,
          market: symbol.prefix,
        }));

        const optionResults: StrategyRunResult[] = [];
        if (includeNormalizedPrice) {
          optionResults.push(createPriceSeries(symbol, bars, "normalized"));
        }
        if (includeConvertedPrice) {
          optionResults.push(
            await createConvertedPriceSeries(symbol, bars, scenario.baseCurrency, scenario.startDate, scenario.endDate),
          );
        }

        return [...optionResults, ...strategyResults];
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
