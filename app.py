from __future__ import annotations

import tkinter as tk
from tkinter import messagebox, ttk

import pandas as pd

try:
    import FinanceDataReader as fdr
except ModuleNotFoundError:
    fdr = None


APP_TITLE = "퀀트 백테스트 데스크톱"
DEFAULT_TICKER = "005930"
DEFAULT_START_DATE = "2023-01-01"
DEFAULT_END_DATE = "2024-01-01"
DEFAULT_CAPITAL = "10000000"

BUY_OPERATORS = ("상향 돌파", "이상", "초과")
SELL_OPERATORS = ("하향 돌파", "이하", "미만", "사용 안 함")

STRATEGY_PRESETS = {
    "5일선 돌파": {
        "description": "종가가 단기 이동평균선을 상향 돌파하면 매수하고, 다시 이동평균선 아래로 내려가면 청산합니다.",
        "buy_period": 5,
        "buy_operator": "상향 돌파",
        "sell_period": 5,
        "sell_operator": "하향 돌파",
        "fee_percent": 0.20,
    },
    "20일선 돌파": {
        "description": "종가가 20일 이동평균선 위로 올라설 때 진입하고, 다시 20일선 아래로 내려오면 청산합니다.",
        "buy_period": 20,
        "buy_operator": "상향 돌파",
        "sell_period": 20,
        "sell_operator": "하향 돌파",
        "fee_percent": 0.20,
    },
    "커스텀": {
        "description": "매수와 매도 규칙을 직접 조합해 전략을 정의합니다.",
        "buy_period": 10,
        "buy_operator": "상향 돌파",
        "sell_period": 20,
        "sell_operator": "하향 돌파",
        "fee_percent": 0.20,
    },
}


def fetch_price_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    if fdr is None:
        raise ModuleNotFoundError(
            "FinanceDataReader가 설치되어 있지 않습니다.\n"
            "설치 명령: pip install finance-datareader"
        )

    df = fdr.DataReader(ticker, start_date, end_date)
    if df.empty:
        return pd.DataFrame()

    df = df.reset_index()
    df = df[["Date", "Close"]]
    df.columns = ["날짜", "종가"]
    df["날짜"] = pd.to_datetime(df["날짜"])
    return df.sort_values("날짜").reset_index(drop=True)


def _make_signal(series: pd.Series, moving_average: pd.Series, operator: str) -> pd.Series:
    prev_series = series.shift(1)
    prev_average = moving_average.shift(1)

    if operator == "상향 돌파":
        return (series > moving_average) & (prev_series <= prev_average)
    if operator == "하향 돌파":
        return (series < moving_average) & (prev_series >= prev_average)
    if operator == "이상":
        return series >= moving_average
    if operator == "초과":
        return series > moving_average
    if operator == "이하":
        return series <= moving_average
    if operator == "미만":
        return series < moving_average
    if operator == "사용 안 함":
        return pd.Series(False, index=series.index)
    raise ValueError(f"지원하지 않는 조건입니다: {operator}")


def run_backtest(
    price_df: pd.DataFrame,
    initial_capital: float,
    buy_period: int,
    buy_operator: str,
    sell_period: int,
    sell_operator: str,
    fee_rate: float,
) -> pd.DataFrame:
    required_period = max(buy_period, sell_period if sell_operator != "사용 안 함" else 1)
    bt_df = price_df.copy()
    bt_df["매수선"] = bt_df["종가"].rolling(window=buy_period).mean()
    bt_df["매도선"] = bt_df["종가"].rolling(window=sell_period).mean()
    bt_df = bt_df.dropna().reset_index(drop=True)

    if bt_df.empty or len(bt_df) < 2 or len(bt_df) < required_period:
        return pd.DataFrame()

    buy_signal = _make_signal(bt_df["종가"], bt_df["매수선"], buy_operator)
    sell_signal = _make_signal(bt_df["종가"], bt_df["매도선"], sell_operator)

    position_state: list[str] = []
    trade_action: list[str] = []
    positions: list[int] = []
    holding = 0

    for index in bt_df.index:
        action = "대기"
        if holding == 0 and bool(buy_signal.iloc[index]):
            holding = 1
            action = "매수"
        elif holding == 1 and bool(sell_signal.iloc[index]):
            holding = 0
            action = "매도"

        positions.append(holding)
        position_state.append("보유" if holding else "현금")
        trade_action.append(action)

    bt_df["포지션"] = positions
    bt_df["상태"] = position_state
    bt_df["신호"] = trade_action
    bt_df["전일_포지션"] = bt_df["포지션"].shift(1).fillna(0)
    bt_df["일간수익률"] = bt_df["종가"].pct_change().fillna(0)
    bt_df["거래발생"] = (bt_df["포지션"] != bt_df["전일_포지션"]).astype(int)
    bt_df["수익률"] = (bt_df["전일_포지션"] * bt_df["일간수익률"]) - (bt_df["거래발생"] * fee_rate)
    bt_df["누적수익률"] = (1 + bt_df["수익률"]).cumprod()
    bt_df["잔고"] = initial_capital * bt_df["누적수익률"]
    return bt_df.reset_index(drop=True)


class BacktestApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("1420x820")
        self.root.minsize(1260, 760)

        self.ticker_var = tk.StringVar(value=DEFAULT_TICKER)
        self.strategy_var = tk.StringVar(value="5일선 돌파")
        self.start_date_var = tk.StringVar(value=DEFAULT_START_DATE)
        self.end_date_var = tk.StringVar(value=DEFAULT_END_DATE)
        self.capital_var = tk.StringVar(value=DEFAULT_CAPITAL)
        self.buy_period_var = tk.StringVar()
        self.buy_operator_var = tk.StringVar()
        self.sell_period_var = tk.StringVar()
        self.sell_operator_var = tk.StringVar()
        self.fee_var = tk.StringVar()
        self.strategy_description_var = tk.StringVar()
        self.rule_summary_var = tk.StringVar()
        self.status_var = tk.StringVar(value="전략을 확인하고 조회를 실행하세요.")
        self._applying_preset = False

        self.metric_vars = {
            "initial": tk.StringVar(value="-"),
            "final": tk.StringVar(value="-"),
            "delta": tk.StringVar(value="-"),
            "profit": tk.StringVar(value="-"),
        }

        self.tree_columns = (
            "날짜",
            "종가",
            "매수선",
            "매도선",
            "신호",
            "상태",
            "수익률",
            "잔고",
        )

        self._build_layout()
        self._apply_preset(self.strategy_var.get())

    def _build_layout(self) -> None:
        self.root.columnconfigure(0, weight=0)
        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(0, weight=1)

        control_frame = ttk.Frame(self.root, padding=16)
        control_frame.grid(row=0, column=0, sticky="ns")
        control_frame.columnconfigure(0, weight=1)

        result_frame = ttk.Frame(self.root, padding=(0, 16, 16, 16))
        result_frame.grid(row=0, column=1, sticky="nsew")
        result_frame.columnconfigure(0, weight=1)
        result_frame.rowconfigure(2, weight=1)

        self._build_controls(control_frame)
        self._build_results(result_frame)

    def _build_controls(self, parent: ttk.Frame) -> None:
        title = ttk.Label(parent, text="전략 설정", font=("Malgun Gothic", 16, "bold"))
        title.grid(row=0, column=0, sticky="w", pady=(0, 14))

        base_labels = [
            ("종목코드", self.ticker_var),
            ("시작일 (YYYY-MM-DD)", self.start_date_var),
            ("종료일 (YYYY-MM-DD)", self.end_date_var),
            ("초기 투자금", self.capital_var),
        ]

        current_row = 1
        for label_text, variable in base_labels:
            ttk.Label(parent, text=label_text).grid(row=current_row, column=0, sticky="w", pady=(0, 6))
            ttk.Entry(parent, textvariable=variable, width=30).grid(
                row=current_row + 1, column=0, sticky="ew", pady=(0, 12)
            )
            current_row += 2

        ttk.Label(parent, text="전략 프리셋").grid(row=current_row, column=0, sticky="w", pady=(0, 6))
        strategy_combo = ttk.Combobox(
            parent,
            textvariable=self.strategy_var,
            values=tuple(STRATEGY_PRESETS.keys()),
            state="readonly",
            width=27,
        )
        strategy_combo.grid(row=current_row + 1, column=0, sticky="ew", pady=(0, 10))
        strategy_combo.bind("<<ComboboxSelected>>", self._on_strategy_change)
        current_row += 2

        description_frame = ttk.LabelFrame(parent, text="전략 설명", padding=10)
        description_frame.grid(row=current_row, column=0, sticky="ew", pady=(0, 12))
        description_frame.columnconfigure(0, weight=1)
        ttk.Label(
            description_frame,
            textvariable=self.strategy_description_var,
            justify="left",
            wraplength=320,
        ).grid(row=0, column=0, sticky="w")
        current_row += 1

        rules_frame = ttk.LabelFrame(parent, text="전략 규칙", padding=10)
        rules_frame.grid(row=current_row, column=0, sticky="ew", pady=(0, 12))
        rules_frame.columnconfigure(0, weight=1)
        rules_frame.columnconfigure(1, weight=1)

        ttk.Label(rules_frame, text="매수 이동평균").grid(row=0, column=0, sticky="w", pady=(0, 6))
        ttk.Entry(rules_frame, textvariable=self.buy_period_var, width=12).grid(
            row=1, column=0, sticky="ew", padx=(0, 8), pady=(0, 10)
        )
        ttk.Label(rules_frame, text="매수 조건").grid(row=0, column=1, sticky="w", pady=(0, 6))
        ttk.Combobox(
            rules_frame,
            textvariable=self.buy_operator_var,
            values=BUY_OPERATORS,
            state="readonly",
            width=12,
        ).grid(row=1, column=1, sticky="ew", pady=(0, 10))

        ttk.Label(rules_frame, text="매도 이동평균").grid(row=2, column=0, sticky="w", pady=(0, 6))
        ttk.Entry(rules_frame, textvariable=self.sell_period_var, width=12).grid(
            row=3, column=0, sticky="ew", padx=(0, 8), pady=(0, 10)
        )
        ttk.Label(rules_frame, text="매도 조건").grid(row=2, column=1, sticky="w", pady=(0, 6))
        ttk.Combobox(
            rules_frame,
            textvariable=self.sell_operator_var,
            values=SELL_OPERATORS,
            state="readonly",
            width=12,
        ).grid(row=3, column=1, sticky="ew", pady=(0, 10))

        ttk.Label(rules_frame, text="거래비용 (%)").grid(row=4, column=0, sticky="w", pady=(0, 6))
        ttk.Entry(rules_frame, textvariable=self.fee_var, width=12).grid(
            row=5, column=0, sticky="ew", padx=(0, 8)
        )

        summary_frame = ttk.LabelFrame(parent, text="적용 규칙 요약", padding=10)
        summary_frame.grid(row=current_row + 1, column=0, sticky="ew", pady=(0, 12))
        summary_frame.columnconfigure(0, weight=1)
        ttk.Label(
            summary_frame,
            textvariable=self.rule_summary_var,
            justify="left",
            wraplength=320,
        ).grid(row=0, column=0, sticky="w")

        for variable in (
            self.buy_period_var,
            self.buy_operator_var,
            self.sell_period_var,
            self.sell_operator_var,
            self.fee_var,
        ):
            variable.trace_add("write", self._refresh_rule_summary)

        run_button = ttk.Button(parent, text="조회 실행", command=self.run)
        run_button.grid(row=current_row + 2, column=0, sticky="ew")

    def _build_results(self, parent: ttk.Frame) -> None:
        header = ttk.Label(parent, text="백테스트 결과", font=("Malgun Gothic", 16, "bold"))
        header.grid(row=0, column=0, sticky="w", pady=(0, 12))

        metrics_frame = ttk.Frame(parent)
        metrics_frame.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        for index in range(4):
            metrics_frame.columnconfigure(index, weight=1)

        metric_specs = [
            ("초기 투자금", self.metric_vars["initial"]),
            ("최종 잔고", self.metric_vars["final"]),
            ("손익", self.metric_vars["delta"]),
            ("누적 수익률", self.metric_vars["profit"]),
        ]
        for column, (label_text, variable) in enumerate(metric_specs):
            card = ttk.LabelFrame(metrics_frame, text=label_text, padding=12)
            card.grid(row=0, column=column, sticky="ew", padx=(0, 10) if column < 3 else 0)
            ttk.Label(card, textvariable=variable, font=("Malgun Gothic", 12, "bold")).pack(anchor="w")

        table_frame = ttk.Frame(parent)
        table_frame.grid(row=2, column=0, sticky="nsew")
        table_frame.columnconfigure(0, weight=1)
        table_frame.rowconfigure(0, weight=1)

        self.tree = ttk.Treeview(table_frame, columns=self.tree_columns, show="headings")
        self.tree.grid(row=0, column=0, sticky="nsew")

        column_widths = {
            "날짜": 110,
            "종가": 110,
            "매수선": 110,
            "매도선": 110,
            "신호": 90,
            "상태": 90,
            "수익률": 100,
            "잔고": 130,
        }
        for column in self.tree_columns:
            anchor = "center" if column in {"날짜", "신호", "상태"} else "e"
            self.tree.heading(column, text=column)
            self.tree.column(column, width=column_widths[column], anchor=anchor)

        y_scrollbar = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        y_scrollbar.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=y_scrollbar.set)

        status_label = ttk.Label(parent, textvariable=self.status_var, foreground="#555555")
        status_label.grid(row=3, column=0, sticky="w", pady=(10, 0))

    def _on_strategy_change(self, _event: object | None = None) -> None:
        self._apply_preset(self.strategy_var.get())

    def _apply_preset(self, preset_name: str) -> None:
        preset = STRATEGY_PRESETS[preset_name]
        self._applying_preset = True
        self.strategy_description_var.set(preset["description"])
        self.buy_period_var.set(str(preset["buy_period"]))
        self.buy_operator_var.set(preset["buy_operator"])
        self.sell_period_var.set(str(preset["sell_period"]))
        self.sell_operator_var.set(preset["sell_operator"])
        self.fee_var.set(f"{preset['fee_percent']:.2f}")
        self._refresh_rule_summary()
        self._applying_preset = False

    def _refresh_rule_summary(self, *_args: object) -> None:
        if not self._applying_preset and self.strategy_var.get() != "커스텀":
            self.strategy_var.set("커스텀")
            self.strategy_description_var.set(STRATEGY_PRESETS["커스텀"]["description"])

        buy_period = self.buy_period_var.get().strip() or "?"
        sell_period = self.sell_period_var.get().strip() or "?"
        buy_operator = self.buy_operator_var.get().strip() or "?"
        sell_operator = self.sell_operator_var.get().strip() or "?"
        fee_text = self.fee_var.get().strip() or "?"

        buy_rule = f"매수: 종가가 {buy_period}일 이동평균선 기준으로 '{buy_operator}' 조건일 때 진입"
        if sell_operator == "사용 안 함":
            sell_rule = "매도: 자동 청산 없이 계속 보유"
        else:
            sell_rule = f"매도: 종가가 {sell_period}일 이동평균선 기준으로 '{sell_operator}' 조건일 때 청산"

        fee_rule = f"거래비용: 진입 또는 청산 시마다 {fee_text}% 반영"
        self.rule_summary_var.set(f"{buy_rule}\n{sell_rule}\n{fee_rule}")

    def run(self) -> None:
        try:
            ticker = self.ticker_var.get().strip()
            start_date = self._parse_date(self.start_date_var.get().strip(), "시작일")
            end_date = self._parse_date(self.end_date_var.get().strip(), "종료일")
            capital = self._parse_positive_float(self.capital_var.get().strip(), "초기 투자금")
            buy_period = self._parse_positive_int(self.buy_period_var.get().strip(), "매수 이동평균")
            sell_period = self._parse_positive_int(self.sell_period_var.get().strip(), "매도 이동평균")
            buy_operator = self.buy_operator_var.get().strip()
            sell_operator = self.sell_operator_var.get().strip()
            fee_rate = self._parse_fee(self.fee_var.get().strip())

            if not ticker:
                raise ValueError("종목코드를 입력하세요.")
            if start_date > end_date:
                raise ValueError("시작일은 종료일보다 늦을 수 없습니다.")
            if buy_operator not in BUY_OPERATORS:
                raise ValueError("매수 조건을 선택하세요.")
            if sell_operator not in SELL_OPERATORS:
                raise ValueError("매도 조건을 선택하세요.")

            self.status_var.set("데이터를 조회하고 전략을 계산하고 있습니다...")
            self.root.update_idletasks()

            market_data = fetch_price_data(
                ticker,
                start_date.strftime("%Y-%m-%d"),
                end_date.strftime("%Y-%m-%d"),
            )
            if market_data.empty:
                self._reset_metrics()
                self._clear_table()
                self.status_var.set("조회 결과가 없습니다.")
                messagebox.showwarning("조회 결과 없음", "해당 조건에 맞는 가격 데이터가 없습니다.")
                return

            result_df = run_backtest(
                price_df=market_data,
                initial_capital=capital,
                buy_period=buy_period,
                buy_operator=buy_operator,
                sell_period=sell_period,
                sell_operator=sell_operator,
                fee_rate=fee_rate,
            )
            if result_df.empty:
                self._reset_metrics()
                self._clear_table()
                self.status_var.set("계산 가능한 데이터가 부족합니다.")
                messagebox.showwarning(
                    "계산 불가",
                    "선택한 기간이 너무 짧거나 이동평균 계산에 필요한 데이터가 부족합니다.",
                )
                return

            self._update_summary(capital, result_df)
            self._populate_table(result_df)
            self.status_var.set(f"{ticker} 백테스트가 완료되었습니다. 총 {len(result_df)}건")
        except Exception as exc:
            self.status_var.set("실행 중 오류가 발생했습니다.")
            messagebox.showerror("오류", str(exc))

    def _parse_date(self, value: str, label: str) -> pd.Timestamp:
        try:
            return pd.to_datetime(value, format="%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"{label} 형식이 잘못되었습니다. YYYY-MM-DD 형식으로 입력하세요.") from exc

    def _parse_positive_float(self, value: str, label: str) -> float:
        normalized = value.replace(",", "").strip()
        try:
            parsed = float(normalized)
        except ValueError as exc:
            raise ValueError(f"{label}은 숫자로 입력하세요.") from exc
        if parsed <= 0:
            raise ValueError(f"{label}은 0보다 커야 합니다.")
        return parsed

    def _parse_non_negative_float(self, value: str, label: str) -> float:
        normalized = value.replace(",", "").strip()
        try:
            parsed = float(normalized)
        except ValueError as exc:
            raise ValueError(f"{label}은 숫자로 입력하세요.") from exc
        if parsed < 0:
            raise ValueError(f"{label}은 0 이상이어야 합니다.")
        return parsed

    def _parse_positive_int(self, value: str, label: str) -> int:
        try:
            parsed = int(value)
        except ValueError as exc:
            raise ValueError(f"{label}은 정수로 입력하세요.") from exc
        if parsed <= 0:
            raise ValueError(f"{label}은 1 이상이어야 합니다.")
        return parsed

    def _parse_fee(self, value: str) -> float:
        fee_percent = self._parse_non_negative_float(value, "거래비용")
        return fee_percent / 100

    def _update_summary(self, capital: float, result_df: pd.DataFrame) -> None:
        final_balance = float(result_df.iloc[-1]["잔고"])
        profit_delta = final_balance - capital
        profit_rate = profit_delta / capital * 100

        self.metric_vars["initial"].set(f"{capital:,.0f} 원")
        self.metric_vars["final"].set(f"{final_balance:,.0f} 원")
        self.metric_vars["delta"].set(f"{profit_delta:,.0f} 원")
        self.metric_vars["profit"].set(f"{profit_rate:.2f} %")

    def _populate_table(self, result_df: pd.DataFrame) -> None:
        self._clear_table()

        display_df = result_df.copy()
        display_df["날짜"] = display_df["날짜"].dt.strftime("%Y-%m-%d")
        for column in ("종가", "매수선", "매도선", "잔고"):
            display_df[column] = display_df[column].map(lambda value: f"{value:,.0f}")
        display_df["수익률"] = display_df["수익률"].map(lambda value: f"{value * 100:.2f} %")

        for row in display_df[list(self.tree_columns)].itertuples(index=False, name=None):
            self.tree.insert("", "end", values=row)

    def _clear_table(self) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)

    def _reset_metrics(self) -> None:
        for variable in self.metric_vars.values():
            variable.set("-")


def main() -> None:
    root = tk.Tk()
    ttk.Style().theme_use("clam")
    BacktestApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
