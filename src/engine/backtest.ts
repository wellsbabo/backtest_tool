import {calculateMaxDrawdownPct, type BacktestSummary} from "../analytics/summary.js";
import type {DailyCloseBar} from "../market-data/types.js";
import type {StrategyRunResult, TimelinePoint, TradeMarker} from "../schemas/backtest-result.js";
import {evaluateThreshold} from "../strategies/operators.js";
import type {StrategyDefinition} from "../strategies/types.js";
import {simpleMovingAverage} from "./indicators.js";

export type BacktestRequest = {
  initialCapital: number;
  bars: DailyCloseBar[];
  strategy: StrategyDefinition;
};

function ensureSortedBars(bars: DailyCloseBar[]): DailyCloseBar[] {
  return [...bars].sort((left, right) => left.date.localeCompare(right.date));
}

function buildSummary(
  timeline: TimelinePoint[],
  initialCapital: number,
  tradeCount: number,
): BacktestSummary {
  const values = timeline.map((point) => point.marketValue);
  const firstPoint = timeline[0];
  const lastPoint = timeline[timeline.length - 1];
  const finalValue = lastPoint.marketValue;
  const profit = finalValue - initialCapital;

  return {
    initialCapital,
    finalValue,
    investedPrincipal: lastPoint.investedPrincipal,
    profit,
    totalReturnPct: (profit / initialCapital) * 100,
    maxDrawdownPct: calculateMaxDrawdownPct(values),
    tradeCount,
    startDate: firstPoint.date,
    endDate: lastPoint.date,
  };
}

function createChartDomain(timeline: TimelinePoint[]) {
  const values = timeline.flatMap((point) => [point.marketValue, point.investedPrincipal, point.close]);
  return {
    minValue: Math.min(...values),
    maxValue: Math.max(...values),
    startDate: timeline[0].date,
    endDate: timeline[timeline.length - 1].date,
  };
}

export function runBacktest(request: BacktestRequest): StrategyRunResult {
  const bars = ensureSortedBars(request.bars);
  if (bars.length === 0) {
    throw new Error("No market data bars provided.");
  }

  const feeRate = request.strategy.feeRate;
  const timeline: TimelinePoint[] = [];
  const trades: TradeMarker[] = [];

  let cash = request.initialCapital;
  let units = 0;
  let investedPrincipal = request.initialCapital;

  if (request.strategy.kind === "buy-and-hold") {
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      let signal: TimelinePoint["signal"] = "hold";

      if (index === 0 && cash > 0) {
        const grossUnits = cash / bar.close;
        const netUnits = grossUnits * (1 - feeRate);
        units = netUnits;
        cash = 0;
        signal = "buy";
        trades.push({date: bar.date, action: "buy", close: bar.close, reason: "initial allocation"});
      }

      const marketValue = cash + units * bar.close;
      timeline.push({
        date: bar.date,
        close: bar.close,
        investedPrincipal,
        marketValue,
        cash,
        positionExposure: units > 0 ? 1 : 0,
        units,
        signal,
        cumulativeReturnPct: ((marketValue - request.initialCapital) / request.initialCapital) * 100,
      });
    }
  } else {
    const closes = bars.map((bar) => bar.close);
    const buyAverage = simpleMovingAverage(closes, request.strategy.buy.window);
    const sellWindow = request.strategy.sell?.window ?? 1;
    const sellAverage = simpleMovingAverage(closes, sellWindow);

    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      const previousClose = index > 0 ? closes[index - 1] : null;
      const previousBuyAverage = index > 0 ? buyAverage[index - 1] : null;
      const previousSellAverage = index > 0 ? sellAverage[index - 1] : null;
      const currentBuyAverage = buyAverage[index];
      const currentSellAverage = sellAverage[index];
      let signal: TimelinePoint["signal"] = "hold";

      if (currentBuyAverage !== null) {
        const shouldBuy =
          units === 0 &&
          evaluateThreshold(
            bar.close,
            currentBuyAverage,
            previousClose,
            previousBuyAverage,
            request.strategy.buy.operator,
          );

        if (shouldBuy && cash > 0) {
          const grossUnits = cash / bar.close;
          const netUnits = grossUnits * (1 - feeRate);
          units = netUnits;
          cash = 0;
          signal = "buy";
          trades.push({date: bar.date, action: "buy", close: bar.close, reason: "buy rule matched"});
        }
      }

      if (request.strategy.sell && currentSellAverage !== null) {
        const shouldSell =
          units > 0 &&
          evaluateThreshold(
            bar.close,
            currentSellAverage,
            previousClose,
            previousSellAverage,
            request.strategy.sell.operator,
          );

        if (shouldSell) {
          cash = units * bar.close * (1 - feeRate);
          units = 0;
          signal = "sell";
          trades.push({date: bar.date, action: "sell", close: bar.close, reason: "sell rule matched"});
        }
      }

      const marketValue = cash + units * bar.close;
      timeline.push({
        date: bar.date,
        close: bar.close,
        investedPrincipal,
        marketValue,
        cash,
        positionExposure: units > 0 ? 1 : 0,
        units,
        signal,
        cumulativeReturnPct: ((marketValue - request.initialCapital) / request.initialCapital) * 100,
      });
    }
  }

  if (timeline.length === 0) {
    throw new Error("Backtest produced no timeline.");
  }

  return {
    strategyId: request.strategy.id,
    strategyLabel: request.strategy.label,
    symbol: bars[0].symbol,
    currency: bars[0].currency,
    market: bars[0].market,
    source: bars[0].source,
    inputBars: bars,
    timeline,
    trades,
    summary: buildSummary(timeline, request.initialCapital, trades.length),
    chartDomain: createChartDomain(timeline),
  };
}

export function compareStrategies(
  initialCapital: number,
  bars: DailyCloseBar[],
  strategies: StrategyDefinition[],
): StrategyRunResult[] {
  return strategies.map((strategy) => runBacktest({initialCapital, bars, strategy}));
}
