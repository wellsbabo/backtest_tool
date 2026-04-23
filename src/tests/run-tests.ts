import assert from "node:assert/strict";
import {runBacktest} from "../engine/backtest.js";
import type {DailyCloseBar} from "../market-data/types.js";
import type {StrategyDefinition} from "../strategies/types.js";

const bars: DailyCloseBar[] = [100, 101, 102, 103, 104, 110, 108, 112, 115].map((close, index) => ({
  symbol: "TST",
  date: `2024-01-${String(index + 1).padStart(2, "0")}` as `${number}-${number}-${number}`,
  close,
  currency: "USD",
  market: "US",
  source: "test",
}));

function testBuyAndHold() {
  const strategy: StrategyDefinition = {
    kind: "buy-and-hold",
    id: "bah",
    label: "Buy and Hold",
    feeRate: 0,
  };

  const result = runBacktest({initialCapital: 1000, bars, strategy});
  assert.equal(result.trades.length, 1);
  assert.equal(result.timeline.length, bars.length);
  assert.equal(result.timeline[0].signal, "buy");
  assert.ok(result.summary.finalValue > 1000);
}

function testMovingAverageThreshold() {
  const strategy: StrategyDefinition = {
    kind: "moving-average-threshold",
    id: "ma",
    label: "MA",
    buy: {window: 3, operator: "crossesAbove"},
    sell: {window: 3, operator: "disabled"},
    feeRate: 0,
  };

  const result = runBacktest({initialCapital: 1000, bars, strategy});
  assert.equal(result.strategyId, "ma");
  assert.equal(result.chartDomain.startDate, bars[0].date);
  assert.equal(result.chartDomain.endDate, bars[bars.length - 1].date);
  assert.ok(result.timeline.every((point) => Number.isFinite(point.marketValue)));
}

function main() {
  testBuyAndHold();
  testMovingAverageThreshold();
  process.stdout.write("All tests passed.\n");
}

main();
