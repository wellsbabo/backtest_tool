export type ThresholdOperator =
  | "crossesAbove"
  | "crossesBelow"
  | "gte"
  | "gt"
  | "lte"
  | "lt"
  | "disabled";

export type BuyAndHoldStrategy = {
  kind: "buy-and-hold";
  id: string;
  label: string;
  feeRate: number;
};

export type MovingAverageThresholdStrategy = {
  kind: "moving-average-threshold";
  id: string;
  label: string;
  buy: {
    window: number;
    operator: Extract<ThresholdOperator, "crossesAbove" | "gte" | "gt">;
  };
  sell?: {
    window: number;
    operator: Extract<ThresholdOperator, "crossesBelow" | "lte" | "lt" | "disabled">;
  };
  feeRate: number;
};

export type StrategyDefinition = BuyAndHoldStrategy | MovingAverageThresholdStrategy;
