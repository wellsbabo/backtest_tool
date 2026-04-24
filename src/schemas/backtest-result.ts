import type {TradeAction} from "../domain/types.js";
import type {DailyCloseBar} from "../market-data/types.js";
import type {BacktestSummary} from "../analytics/summary.js";

export type TradeMarker = {
  date: string;
  action: TradeAction;
  close: number;
  reason: string;
};

export type TimelinePoint = {
  date: string;
  close: number;
  investedPrincipal: number;
  marketValue: number;
  cash: number;
  positionExposure: number;
  units: number;
  signal: TradeAction | "hold";
  cumulativeReturnPct: number;
};

export type StrategyRunResult = {
  strategyId: string;
  strategyLabel: string;
  symbol: string;
  currency?: string;
  market?: string;
  source: string;
  inputBars: DailyCloseBar[];
  timeline: TimelinePoint[];
  trades: TradeMarker[];
  summary: BacktestSummary;
  chartDomain: {
    minValue: number;
    maxValue: number;
    startDate: string;
    endDate: string;
  };
};

export type ChartPreviewPayload = {
  title: string;
  subtitle?: string;
  series: StrategyRunResult[];
};
