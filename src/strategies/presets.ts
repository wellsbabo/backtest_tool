import type {StrategyDefinition} from "./types.js";

export const legacyPresetStrategies: StrategyDefinition[] = [
  {
    kind: "moving-average-threshold",
    id: "ma-5-breakout",
    label: "5D Breakout",
    buy: {window: 5, operator: "crossesAbove"},
    sell: {window: 5, operator: "crossesBelow"},
    feeRate: 0.002,
  },
  {
    kind: "moving-average-threshold",
    id: "ma-20-breakout",
    label: "20D Breakout",
    buy: {window: 20, operator: "crossesAbove"},
    sell: {window: 20, operator: "crossesBelow"},
    feeRate: 0.002,
  },
  {
    kind: "buy-and-hold",
    id: "buy-and-hold",
    label: "Buy and Hold",
    feeRate: 0.002,
  },
];
