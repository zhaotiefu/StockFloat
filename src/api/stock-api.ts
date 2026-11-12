import type { StockQuote, WatchStock } from "../types/stock";
import { defaultProvider, type StockProvider } from "./stock-provider";

let provider: StockProvider = defaultProvider;

export function setStockProvider(next: StockProvider): void {
  provider = next;
}

export function getStockProvider(): StockProvider {
  return provider;
}

export async function fetchStockQuotes(
  stocks: WatchStock[]
): Promise<StockQuote[]> {
  if (stocks.length === 0) return [];
  return provider.fetchQuotes(stocks);
}

/** Resolve name for a newly added symbol; throws on network/provider failure. */
export async function resolveStockMeta(
  stock: WatchStock
): Promise<WatchStock> {
  const [quote] = await provider.fetchQuotes([stock]);
  if (!quote) {
    throw new Error("未找到该股票或行情源暂不可用");
  }
  // Invalid codes often come back with empty name / null prices from the provider.
  if (quote.price === null && quote.preClose === null) {
    throw new Error("股票代码无效或暂无行情");
  }
  return {
    ...stock,
    name: quote.name || stock.name || stock.symbol,
  };
}
