import fs from "node:fs/promises";
import path from "node:path";
import type {CurrencyCode, DateString} from "../domain/types.js";
import type {DailyCloseBar, MarketDataProvider} from "./types.js";

type FxCacheFile = {
  version: 1;
  pairs: Record<string, Array<[DateString, number]>>;
};

export type FxRateProvider = {
  getConversionRates(request: {
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    startDate: DateString;
    endDate: DateString;
  }): Promise<Map<DateString, number>>;
};

export class MarketDataFxRateProvider implements FxRateProvider {
  private readonly cache = new Map<string, Promise<Map<DateString, number>>>();
  private readonly diskCachePath = path.join(process.cwd(), ".cache", "fx-rates.json");

  constructor(private readonly marketDataProvider: MarketDataProvider) {}

  async getConversionRates(request: {
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    startDate: DateString;
    endDate: DateString;
  }): Promise<Map<DateString, number>> {
    const fromCurrency = request.fromCurrency.toUpperCase();
    const toCurrency = request.toCurrency.toUpperCase();
    if (fromCurrency === toCurrency) {
      return new Map();
    }

    const cacheKey = `${fromCurrency}/${toCurrency}/${request.startDate}/${request.endDate}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.resolveRates(fromCurrency, toCurrency, request.startDate, request.endDate).catch((error) => {
      this.cache.delete(cacheKey);
      throw error;
    });
    this.cache.set(cacheKey, promise);
    return promise;
  }

  private async resolveRates(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    startDate: DateString,
    endDate: DateString,
  ): Promise<Map<DateString, number>> {
    const pairKey = `${fromCurrency}/${toCurrency}`;

    const direct = await this.tryFetchPair(`${fromCurrency}/${toCurrency}`, startDate, endDate);
    if (direct.size > 0) {
      await this.writePairCache(pairKey, direct);
      return direct;
    }

    const inverse = await this.tryFetchPair(`${toCurrency}/${fromCurrency}`, startDate, endDate);
    if (inverse.size > 0) {
      const inverted = invertRates(inverse);
      await this.writePairCache(pairKey, inverted);
      return inverted;
    }

    if (fromCurrency !== "USD" && toCurrency !== "USD") {
      try {
        const toUsd = await this.getConversionRates({fromCurrency, toCurrency: "USD", startDate, endDate});
        const usdToTarget = await this.getConversionRates({fromCurrency: "USD", toCurrency, startDate, endDate});
        const crossed = crossRates(toUsd, usdToTarget);
        if (crossed.size > 0) {
          await this.writePairCache(pairKey, crossed);
          return crossed;
        }
      } catch {
        // Fall back to stored rates below.
      }
    }

    const cachedFallback = await this.readPairCache(pairKey, endDate);
    if (cachedFallback.size > 0) {
      return cachedFallback;
    }

    throw new Error(`FX rate not available: ${fromCurrency}/${toCurrency}`);
  }

  private async tryFetchPair(symbol: string, startDate: DateString, endDate: DateString): Promise<Map<DateString, number>> {
    try {
      const response = await this.marketDataProvider.getDailyCloses({symbol, startDate, endDate});
      return barsToRateMap(response.bars);
    } catch {
      return new Map();
    }
  }

  private async readCacheFile(): Promise<FxCacheFile> {
    try {
      const raw = await fs.readFile(this.diskCachePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isFxCacheFile(parsed)) {
        return parsed;
      }

      return {version: 1, pairs: migrateLegacyCache(parsed as Record<string, Array<[DateString, number]>>)};
    } catch {
      return {version: 1, pairs: {}};
    }
  }

  private async readPairCache(pairKey: string, endDate: DateString): Promise<Map<DateString, number>> {
    const cacheFile = await this.readCacheFile();
    const entries = cacheFile.pairs[pairKey] ?? [];
    return new Map(
      entries.filter(
        (entry): entry is [DateString, number] =>
          typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[0] <= endDate,
      ),
    );
  }

  private async writePairCache(pairKey: string, rates: Map<DateString, number>): Promise<void> {
    await fs.mkdir(path.dirname(this.diskCachePath), {recursive: true});

    const cacheFile = await this.readCacheFile();
    const merged = new Map<DateString, number>(cacheFile.pairs[pairKey] ?? []);
    for (const [date, rate] of rates.entries()) {
      merged.set(date, rate);
    }

    cacheFile.pairs[pairKey] = [...merged.entries()].sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate));
    await fs.writeFile(this.diskCachePath, JSON.stringify(cacheFile, null, 2), "utf8");
  }
}

function isFxCacheFile(value: unknown): value is FxCacheFile {
  if (!value || typeof value !== "object" || !("pairs" in value)) {
    return false;
  }

  const candidate = value as {pairs?: unknown};
  return Boolean(candidate.pairs && typeof candidate.pairs === "object" && !Array.isArray(candidate.pairs));
}

function migrateLegacyCache(legacy: Record<string, Array<[DateString, number]>>): Record<string, Array<[DateString, number]>> {
  const pairs: Record<string, Map<DateString, number>> = {};
  for (const [legacyKey, entries] of Object.entries(legacy)) {
    const parts = legacyKey.split("/");
    if (parts.length < 2 || !Array.isArray(entries)) {
      continue;
    }

    const pairKey = `${parts[0]}/${parts[1]}`;
    const pairRates = pairs[pairKey] ?? new Map<DateString, number>();
    for (const [date, rate] of entries) {
      if (typeof date === "string" && typeof rate === "number" && Number.isFinite(rate)) {
        pairRates.set(date, rate);
      }
    }
    pairs[pairKey] = pairRates;
  }

  return Object.fromEntries(
    Object.entries(pairs).map(([pairKey, rates]) => [
      pairKey,
      [...rates.entries()].sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate)),
    ]),
  );
}

function barsToRateMap(bars: DailyCloseBar[]): Map<DateString, number> {
  return new Map(
    bars
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .map((bar) => [bar.date, bar.close] as const),
  );
}

function invertRates(rates: Map<DateString, number>): Map<DateString, number> {
  return new Map([...rates.entries()].map(([date, rate]) => [date, 1 / rate]));
}

function crossRates(left: Map<DateString, number>, right: Map<DateString, number>): Map<DateString, number> {
  const crossed = new Map<DateString, number>();
  for (const [date, leftRate] of left.entries()) {
    const rightRate = right.get(date);
    if (rightRate !== undefined) {
      crossed.set(date, leftRate * rightRate);
    }
  }
  return crossed;
}

export function findRateOnOrBefore(rates: Map<DateString, number>, date: DateString): number | undefined {
  if (rates.size === 0) {
    return undefined;
  }

  if (rates.has(date)) {
    return rates.get(date);
  }

  let latestDate: DateString | undefined;
  let earliestFutureDate: DateString | undefined;
  for (const rateDate of rates.keys()) {
    if (rateDate <= date && (!latestDate || rateDate > latestDate)) {
      latestDate = rateDate;
    }
    if (rateDate > date && (!earliestFutureDate || rateDate < earliestFutureDate)) {
      earliestFutureDate = rateDate;
    }
  }

  return latestDate ? rates.get(latestDate) : earliestFutureDate ? rates.get(earliestFutureDate) : undefined;
}
