# Backtest Chart App

This project combines a Python market-data adapter with a TypeScript desktop-style browser UI for investment comparison charts.

The current product direction is:

- fetch free daily close data with Python and `FinanceDataReader`
- run backtests and comparison calculations in TypeScript
- preview animated charts in the browser with Chart.js
- capture the browser screen instead of rendering video files inside the app

## Main features

- multi-symbol comparison with comma-separated input
- required market prefixes such as `KRX: 005930` and `NASDAQ: AAPL`
- strategy comparison on the same symbol
- cross-market comparison with normalized price and FX-converted price
- built-in presets:
  - `Buy and Hold`
  - `5D Breakout`
  - `20D Breakout`
- progressive chart animation with speed controls

## Current architecture

- [app.py](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/app.py:1)
  - legacy Python reference prototype
- [scripts/fetch_market_data.py](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/scripts/fetch_market_data.py:1)
  - Python adapter for daily close data
- [src/app/server.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/app/server.ts:1)
  - Express server and preview API
- [src/app-client/client.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/app-client/client.ts:1)
  - browser client and Chart.js rendering
- [src/engine/backtest.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/engine/backtest.ts:1)
  - TypeScript backtest engine
- [src/market-data/market-prefixes.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/market-data/market-prefixes.ts:1)
  - market prefix, currency, and provider-symbol mapping
- [src/market-data/fx-rates.ts](/c:/Users/LeeJungkwan/Desktop/work/save/JK_P/backtest/src/market-data/fx-rates.ts:1)
  - FX lookup and on-disk rate cache

## Requirements

- Python 3.13+
- Node.js 20+
- npm 10+

## Install

```bash
npm install
pip install finance-datareader pandas
```

If you prefer an isolated Python environment:

```bash
python -m venv venv
venv\Scripts\activate
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

The app now tries Python in this order:

1. `BACKTEST_PYTHON` if set
2. `venv/Scripts/python.exe` or `.venv/Scripts/python.exe` on Windows
3. `venv/bin/python` or `.venv/bin/python` on macOS/Linux
4. system `python` on Windows or `python3` on macOS/Linux

Open:

```text
http://localhost:3000
```

## How to use

1. Enter one or more symbols in `market: code` format.
2. Separate multiple symbols with commas.
3. Choose the date range.
4. Enter the initial capital.
5. Select the base currency if you want FX-converted price lines.
6. Select one or more price options or strategy presets.
7. Click `Preview Chart`.
8. Use the speed controls or replay button if needed.

## Symbol examples

- `KRX: 005930`
- `NASDAQ: AAPL`
- `NASDAQ: MSFT`
- `NYSE: SPY`
- `TYO: 7974`
- `KRX: 005930, NASDAQ: AAPL`

## Supported market prefix mapping

- `KRX`, `KOSPI`, `KOSDAQ` -> `KRW`
- `NASDAQ`, `NYSE`, `AMEX` -> `USD`
- `TYO`, `TSE` -> `JPY`

`TYO` and `TSE` symbols are converted to `.T` format for the Python provider.

## Price options

- `Normalized Price`
  - sets every selected symbol to `100` on the first visible date
  - best for relative performance comparison across different currencies
- `FX Converted Price with historical FX`
  - converts each date using that date's FX rate
  - best for absolute value comparison from the perspective of a selected base currency

## Current assumptions

- daily close only
- long-only
- full allocation on buy
- full exit on sell
- fee applied on each entry and exit

## Current limitations

- no dividends
- no taxes
- no slippage
- no partial fills
- no DCA logic yet
- no portfolio rebalancing
- FX conversion still depends on external provider availability for uncached dates

## Output

The app currently produces:

- summary cards
- animated comparison chart preview
- browser-based output suitable for manual screen capture

The CLI helper still exists for structured output:

```bash
npm run sample:json
```

## Python runtime notes

If `npm run app` fails with a Python-related message:

- create and populate a virtual environment in the project root, or
- point the app at a specific interpreter with `BACKTEST_PYTHON`

Examples:

```powershell
$env:BACKTEST_PYTHON="C:\path\to\python.exe"
npm run app
```

```bash
BACKTEST_PYTHON=/path/to/python npm run app
```
