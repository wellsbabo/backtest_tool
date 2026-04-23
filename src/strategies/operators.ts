import type {ThresholdOperator} from "./types.js";

export function evaluateThreshold(
  currentValue: number,
  currentAverage: number,
  previousValue: number | null,
  previousAverage: number | null,
  operator: ThresholdOperator,
): boolean {
  if (operator === "disabled") {
    return false;
  }

  if (operator === "crossesAbove") {
    return (
      previousValue !== null &&
      previousAverage !== null &&
      currentValue > currentAverage &&
      previousValue <= previousAverage
    );
  }

  if (operator === "crossesBelow") {
    return (
      previousValue !== null &&
      previousAverage !== null &&
      currentValue < currentAverage &&
      previousValue >= previousAverage
    );
  }

  if (operator === "gte") {
    return currentValue >= currentAverage;
  }

  if (operator === "gt") {
    return currentValue > currentAverage;
  }

  if (operator === "lte") {
    return currentValue <= currentAverage;
  }

  if (operator === "lt") {
    return currentValue < currentAverage;
  }

  return false;
}
