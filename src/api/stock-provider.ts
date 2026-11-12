import type { StockQuote, WatchStock } from "../types/stock";
import {
  getMarketStatus,
  parseProviderTimestamp,
  toProviderCode,
} from "../utils/market";

export interface StockProvider {
  readonly id: string;
  readonly name: string;
  fetchQuotes(stocks: WatchStock[]): Promise<StockQuote[]>;
}

/**
 * Tencent finance quote endpoint.
 * Docs are unofficial; response is GBK text like:
 * v_sh601318="1~中国平安~601318~53.14~53.41~..."
 */
export class TencentStockProvider implements StockProvider {
  readonly id = "tencent";
  readonly name = "腾讯行情";

  private readonly endpoint = "https://qt.gtimg.cn/q=";

  async fetchQuotes(stocks: WatchStock[]): Promise<StockQuote[]> {
    if (stocks.length === 0) return [];

    const codes = stocks.map(toProviderCode).join(",");
    const url = `${this.endpoint}${codes}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/plain,*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`行情请求失败（HTTP ${response.status}）`);
    }

    const buffer = await response.arrayBuffer();
    const text = decodeGbk(buffer).trim();
    if (!text) {
      throw new Error("行情源返回空数据");
    }

    const marketStatus = getMarketStatus();
    const bySymbol = new Map<string, StockQuote>();

    for (const line of text.split(";")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = /^v_([a-z]{2})(\d{6})="(.*)"$/.exec(trimmed);
      if (!match) continue;
      const symbol = match[2];
      const fields = match[3].split("~");
      if (fields.length < 5) continue;

      const name = fields[1]?.trim() || symbol;
      const price = parseOptionalNumber(fields[3]);
      const preClose = parseOptionalNumber(fields[4]);
      const tsRaw = fields[30] ?? "";
      const timestamp = parseProviderTimestamp(tsRaw);

      let change: number | null = parseOptionalNumber(fields[31]);
      let changePercent: number | null = parseOptionalNumber(fields[32]);

      if (
        (change === null || changePercent === null) &&
        price !== null &&
        preClose !== null &&
        preClose !== 0
      ) {
        change = Number((price - preClose).toFixed(2));
        changePercent = Number((((price - preClose) / preClose) * 100).toFixed(2));
      }

      if (preClose === null || preClose === 0) {
        change = null;
        changePercent = null;
      }

      // Avoid treating blank/invalid quotes as 0.
      if (price === 0 && (fields[3] === "" || fields[3] === "0.00") && !name) {
        continue;
      }

      bySymbol.set(symbol, {
        symbol,
        name,
        price,
        preClose,
        change,
        changePercent,
        timestamp,
        marketStatus,
      });
    }

    // Preserve request order; missing symbols become null quotes (not fabricated).
    return stocks.map((stock) => {
      const hit = bySymbol.get(stock.symbol);
      if (hit) {
        return {
          ...hit,
          name: hit.name || stock.name || stock.symbol,
        };
      }
      return {
        symbol: stock.symbol,
        name: stock.name || stock.symbol,
        price: null,
        preClose: null,
        change: null,
        changePercent: null,
        timestamp: Date.now(),
        marketStatus,
      };
    });
  }
}

function parseOptionalNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t || t === "-" || t === "--") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

function decodeGbk(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
}

export const defaultProvider: StockProvider = new TencentStockProvider();
