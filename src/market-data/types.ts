import type {CurrencyCode, DateString, MarketCode} from "../domain/types.js";

export type DailyCloseBar = {
  symbol: string;
  date: DateString;
  close: number;
  currency?: CurrencyCode;
  market?: MarketCode;
  source: string;
};

export type MarketDataRequest = {
  symbol: string;
  startDate: DateString;
  endDate: DateString;
};

export type MarketDataResponse = {
  symbol: string;
  startDate: DateString;
  endDate: DateString;
  count: number;
  bars: DailyCloseBar[];
};

export interface MarketDataProvider {
  getDailyCloses(request: MarketDataRequest): Promise<MarketDataResponse>;
}
