import {compareStrategies} from "../engine/backtest.js";
import type {DailyCloseBar} from "../market-data/types.js";
import {legacyPresetStrategies} from "../strategies/presets.js";
import type {ChartPreviewPayload} from "../schemas/backtest-result.js";

const samplePairs: Array<[`${number}-${number}-${number}`, number]> = [
  ["2024-01-02", 100],
  ["2024-01-03", 102],
  ["2024-01-04", 99],
  ["2024-01-05", 105],
  ["2024-01-08", 108],
  ["2024-01-09", 110],
  ["2024-01-10", 112],
  ["2024-01-11", 109],
  ["2024-01-12", 114],
  ["2024-01-15", 118],
  ["2024-01-16", 116],
  ["2024-01-17", 120],
  ["2024-01-18", 122],
  ["2024-01-19", 119],
  ["2024-01-22", 124],
  ["2024-01-23", 128],
  ["2024-01-24", 126],
  ["2024-01-25", 132],
  ["2024-01-26", 130],
  ["2024-01-29", 136],
  ["2024-01-30", 140],
  ["2024-01-31", 142],
];

const sampleBars: DailyCloseBar[] = samplePairs.map(([date, close]) => ({
  symbol: "SAMPLE",
  date,
  close,
  currency: "USD",
  market: "US",
  source: "sample",
}));

export const sampleComparisonChartInput: ChartPreviewPayload = {
  title: "Lump Sum vs MA Strategy",
  subtitle: "Python market-data adapter + TS engine + Chart preview",
  series: compareStrategies(10_000, sampleBars, legacyPresetStrategies.slice(0, 2)),
};
