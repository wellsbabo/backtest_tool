# TypeScript Migration Notes

## Current direction

- Keep Python for free KR/US market data retrieval.
- Move strategy execution, analytics, and video input shaping to TypeScript.
- Prepare deterministic React/Remotion scene inputs instead of table-only outputs.

## Runtime split

- Python adapter: `scripts/fetch_market_data.py`
- TypeScript provider wrapper: `src/market-data/python-provider.ts`
- TypeScript engine: `src/engine/backtest.ts`
- Strategy definitions: `src/strategies/*.ts`
- Remotion-ready props and scenes: `src/schemas/backtest-result.ts`, `src/remotion/*`

## Validation commands

```bash
npm run check
npm test
npm run build
```

Real market data example:

```bash
node dist/src/cli/run-backtest.js --symbol QQQ --start 2024-01-01 --end 2024-01-31 --capital 1000000
```

## Normalized output contract

The Python adapter emits normalized daily close bars:

```json
{
  "symbol": "QQQ",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "count": 20,
  "bars": [
    {
      "symbol": "QQQ",
      "date": "2024-01-02",
      "close": 402.5899963378906,
      "currency": "USD",
      "market": "US",
      "source": "FinanceDataReader"
    }
  ]
}
```

The TypeScript engine converts bars into comparison-video input with:

- per-day timeline points
- trade markers
- summary metrics
- chart domain hints
- deterministic scene props for Remotion

## Current assumptions

- Daily close only
- Long-only strategies
- Full allocation on buy, full exit on sell
- Fee applied as a rate on each entry/exit
- No dividends, taxes, slippage, or partial fills yet
