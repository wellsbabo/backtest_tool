import type {CurrencyCode, MarketCode} from "../domain/types.js";

export type MarketPrefixInfo = {
  prefix: MarketCode;
  label: string;
  currency: CurrencyCode;
  toProviderSymbol: (code: string) => string;
};

const identitySymbol = (code: string) => code.trim().toUpperCase();

export const marketPrefixMap: Record<string, MarketPrefixInfo> = {
  KRX: {
    prefix: "KRX",
    label: "Korea Exchange",
    currency: "KRW",
    toProviderSymbol: identitySymbol,
  },
  KOSPI: {
    prefix: "KRX",
    label: "KOSPI",
    currency: "KRW",
    toProviderSymbol: identitySymbol,
  },
  KOSDAQ: {
    prefix: "KRX",
    label: "KOSDAQ",
    currency: "KRW",
    toProviderSymbol: identitySymbol,
  },
  NASDAQ: {
    prefix: "NASDAQ",
    label: "NASDAQ",
    currency: "USD",
    toProviderSymbol: identitySymbol,
  },
  NYSE: {
    prefix: "NYSE",
    label: "NYSE",
    currency: "USD",
    toProviderSymbol: identitySymbol,
  },
  AMEX: {
    prefix: "AMEX",
    label: "NYSE American",
    currency: "USD",
    toProviderSymbol: identitySymbol,
  },
  TYO: {
    prefix: "TYO",
    label: "Tokyo Stock Exchange",
    currency: "JPY",
    toProviderSymbol: (code) => `${code.trim().toUpperCase()}.T`,
  },
  TSE: {
    prefix: "TYO",
    label: "Tokyo Stock Exchange",
    currency: "JPY",
    toProviderSymbol: (code) => `${code.trim().toUpperCase()}.T`,
  },
};

export type ParsedSymbol = {
  input: string;
  prefix: MarketCode;
  code: string;
  providerSymbol: string;
  displaySymbol: string;
  currency: CurrencyCode;
  marketLabel: string;
};

export function parsePrefixedSymbol(rawSymbol: string): ParsedSymbol {
  const trimmed = rawSymbol.trim();
  const match = trimmed.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
  if (!match) {
    throw new Error(`Market prefix is required: ${trimmed}`);
  }

  const rawPrefix = match[1].trim().toUpperCase();
  const code = match[2].trim().toUpperCase();
  if (/[A-Z]+\s*:/.test(code)) {
    throw new Error(`Multiple symbols must be separated by commas: ${trimmed}`);
  }
  const marketInfo = marketPrefixMap[rawPrefix];
  if (!marketInfo) {
    throw new Error(`Unsupported market prefix: ${rawPrefix}`);
  }

  return {
    input: trimmed,
    prefix: marketInfo.prefix,
    code,
    providerSymbol: marketInfo.toProviderSymbol(code),
    displaySymbol: `${rawPrefix}: ${code}`,
    currency: marketInfo.currency,
    marketLabel: marketInfo.label,
  };
}
