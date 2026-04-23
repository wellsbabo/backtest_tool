export function simpleMovingAverage(values: number[], window: number): Array<number | null> {
  const result: Array<number | null> = [];
  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index];
    if (index >= window) {
      rollingSum -= values[index - window];
    }

    if (index < window - 1) {
      result.push(null);
      continue;
    }

    result.push(rollingSum / window);
  }

  return result;
}
