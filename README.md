# Backtest Chart App

This project uses a Python market-data adapter and a TypeScript GUI to compare symbols and strategies with a progressive line chart preview.

The current workflow is:

- Fetch free daily close data with Python and `FinanceDataReader`
- Run strategy comparisons in TypeScript
- Preview the result as an animated chart in the browser
- Capture the screen with OBS or Windows screen recording instead of rendering MP4 inside the app

## Main features

- Single-symbol strategy comparison
- Multi-symbol comparison using comma-separated input
- Market prefix to currency mapping for `KRX`, `NASDAQ`, `NYSE`, `AMEX`, `TYO`
- Normalized price comparison and FX-converted price comparison
- Buy and Hold, 5D Breakout, 20D Breakout presets
- Initial capital, base currency, date range, and option selection in the GUI
- Progressive line chart preview with Chart.js
- Summary cards for final value, return, drawdown, and trade count

## Current architecture

- [app.py](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/app.py:1)
  - legacy Python reference app
- [scripts/fetch_market_data.py](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/scripts/fetch_market_data.py:1)
  - Python market-data adapter
- [src/app/server.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/app/server.ts:1)
  - GUI server and preview API
- [src/app-client/client.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/app-client/client.ts:1)
  - Chart.js preview client
- [src/engine/backtest.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/engine/backtest.ts:1)
  - backtest engine
- [src/strategies/presets.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/strategies/presets.ts:1)
  - strategy presets
- [public/index.html](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/public/index.html:1)
  - browser UI

## Requirements

- Python 3.13+
- Node.js 20+
- npm 10+

## Install

```bash
npm install
pip install finance-datareader pandas
```

## Run

Type check:

```bash
npm run check
```

Tests:

```bash
npm test
```

Start the app:

```bash
npm run app
```

Open:

```text
http://localhost:3000
```

## How to use

1. Enter one or more symbols in the `market: code` format.
2. Use commas to compare multiple symbols.
3. Choose the date range.
4. Enter the initial capital.
5. Choose a base currency for FX-converted price lines.
6. Select one or more chart options or strategies.
7. Click `Preview Chart`.
8. Wait for the chart animation and capture the screen if needed.

## Symbol input examples

- `KRX: 005930`
- `NASDAQ: AAPL`
- `NASDAQ: MSFT`
- `NYSE: SPY`
- `TYO: 7974`
- `KRX: 005930, NASDAQ: AAPL`

## Price options

- `Normalized Price`
  - Sets each selected symbol's first close to `100`.
  - Best for comparing relative performance across currencies.
- `FX Converted Price`
  - Converts each selected symbol's close price into the selected base currency.
  - Uses the market prefix currency mapping first, then fetches FX rates through the Python `FinanceDataReader` adapter.
  - Supported mapping currently includes `KRX -> KRW`, `NASDAQ/NYSE/AMEX -> USD`, and `TYO/TSE -> JPY`.

## What comparisons are supported

- One symbol + multiple strategies
- Multiple symbols + the same selected strategies
- Multiple symbols + multiple strategies together

Examples:

- `NASDAQ: QQQ` with `Buy and Hold` + `5D Breakout`
- `KRX: 005930, NASDAQ: AAPL` with `Buy and Hold`
- `KRX: 005930, NASDAQ: AAPL, NYSE: SPY` with all presets

## Output

The app returns:

- summary cards
- progressive line chart preview
- browser-based visualization ready for screen capture

The CLI helper still prints structured preview JSON:

```bash
npm run sample:json
```

## Current assumptions

- Daily close only
- Long-only
- Full allocation on buy
- Full exit on sell
- Fee applied on each entry and exit

## Current limitations

- No dividends
- No taxes
- No slippage
- No partial fills
- No DCA logic yet
- No multi-asset portfolio rebalancing
