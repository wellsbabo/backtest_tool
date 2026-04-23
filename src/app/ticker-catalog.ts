export type TickerCatalogEntry = {
  symbol: string;
  label: string;
  market: "KRX" | "US";
};

export const tickerCatalog: TickerCatalogEntry[] = [
  {symbol: "QQQ", label: "Invesco QQQ Trust", market: "US"},
  {symbol: "SPY", label: "SPDR S&P 500 ETF", market: "US"},
  {symbol: "AAPL", label: "Apple", market: "US"},
  {symbol: "MSFT", label: "Microsoft", market: "US"},
  {symbol: "NVDA", label: "NVIDIA", market: "US"},
  {symbol: "TSLA", label: "Tesla", market: "US"},
  {symbol: "005930", label: "Samsung Electronics", market: "KRX"},
  {symbol: "000660", label: "SK hynix", market: "KRX"},
  {symbol: "035420", label: "NAVER", market: "KRX"},
  {symbol: "005380", label: "Hyundai Motor", market: "KRX"},
  {symbol: "051910", label: "LG Chem", market: "KRX"},
  {symbol: "035720", label: "Kakao", market: "KRX"},
];

export function searchTickers(query: string): TickerCatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return tickerCatalog.slice(0, 8);
  }

  return tickerCatalog
    .filter((entry) => {
      return (
        entry.symbol.toLowerCase().includes(normalized) ||
        entry.label.toLowerCase().includes(normalized) ||
        entry.market.toLowerCase().includes(normalized)
      );
    })
    .slice(0, 12);
}
