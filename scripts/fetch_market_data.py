from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass

try:
    import FinanceDataReader as fdr
except ModuleNotFoundError as exc:  # pragma: no cover
    raise SystemExit(
        "FinanceDataReader is required. Install it with `pip install finance-datareader`."
    ) from exc


@dataclass
class DailyBar:
    symbol: str
    date: str
    close: float
    currency: str | None = None
    market: str | None = None
    source: str = "FinanceDataReader"


def infer_market(symbol: str) -> str | None:
    if symbol.isdigit() and len(symbol) == 6:
        return "KRX"
    if symbol.startswith(("KS", "KQ")):
        return "KRX"
    if "." in symbol:
        return symbol.rsplit(".", 1)[-1].upper()
    if symbol.isalpha():
        return "US"
    return None


def infer_currency(market: str | None) -> str | None:
    if market == "KRX":
        return "KRW"
    if market == "US":
        return "USD"
    return None


def fetch_daily_closes(symbol: str, start_date: str, end_date: str) -> list[DailyBar]:
    frame = fdr.DataReader(symbol, start_date, end_date)
    if frame.empty:
        return []

    normalized_frame = frame.reset_index()
    date_column = "Date" if "Date" in normalized_frame.columns else normalized_frame.columns[0]
    market = infer_market(symbol)
    currency = infer_currency(market)
    normalized: list[DailyBar] = []

    for _, row in normalized_frame.iterrows():
        date_value = row[date_column]
        close_value = row["Close"]
        if close_value is None:
            continue

        normalized.append(
            DailyBar(
                symbol=symbol,
                date=date_value.strftime("%Y-%m-%d"),
                close=float(close_value),
                currency=currency,
                market=market,
            )
        )

    return normalized


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()

    bars = fetch_daily_closes(args.symbol, args.start, args.end)
    payload = {
        "symbol": args.symbol,
        "startDate": args.start,
        "endDate": args.end,
        "count": len(bars),
        "bars": [asdict(bar) for bar in bars],
    }
    json.dump(payload, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
