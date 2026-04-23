export type BacktestSummary = {
  initialCapital: number;
  finalValue: number;
  investedPrincipal: number;
  profit: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  startDate: string;
  endDate: string;
};

export function calculateMaxDrawdownPct(values: number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) {
      peak = value;
    }

    if (peak > 0) {
      const drawdown = (value - peak) / peak;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  return maxDrawdown * 100;
}
