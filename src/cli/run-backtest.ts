import {PythonMarketDataProvider} from "../market-data/python-provider.js";
import {compareStrategies} from "../engine/backtest.js";
import {legacyPresetStrategies} from "../strategies/presets.js";
import type {ChartPreviewPayload} from "../schemas/backtest-result.js";

type CliArgs = {
  symbol: string;
  start: string;
  end: string;
  capital: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    args.set(argv[index], argv[index + 1]);
  }

  return {
    symbol: args.get("--symbol") ?? "QQQ",
    start: args.get("--start") ?? "2024-01-01",
    end: args.get("--end") ?? "2024-12-31",
    capital: Number(args.get("--capital") ?? "10000000"),
  };
}

async function main() {
  const {symbol, start, end, capital} = parseArgs(process.argv.slice(2));
  const provider = new PythonMarketDataProvider();
  const marketData = await provider.getDailyCloses({
    symbol,
    startDate: start as `${number}-${number}-${number}`,
    endDate: end as `${number}-${number}-${number}`,
  });

  const results = compareStrategies(capital, marketData.bars, legacyPresetStrategies);
  const preview: ChartPreviewPayload = {
    title: `${symbol} Strategy Comparison`,
    subtitle: `${start} to ${end}`,
    series: results,
  };

  process.stdout.write(JSON.stringify(preview, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
