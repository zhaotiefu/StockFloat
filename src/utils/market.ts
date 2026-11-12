import type { MarketBoard, MarketStatus, WatchStock } from "../types/stock";

const PURE_CODE = /^\d{6}$/;

/** Infer board from A-share code. */
export function inferBoard(symbol: string): MarketBoard | null {
  if (!PURE_CODE.test(symbol)) return null;
  if (
    symbol.startsWith("6") ||
    symbol.startsWith("5") ||
    symbol.startsWith("9")
  ) {
    return "SH";
  }
  if (
    symbol.startsWith("0") ||
    symbol.startsWith("1") ||
    symbol.startsWith("2") ||
    symbol.startsWith("3")
  ) {
    return "SZ";
  }
  return null;
}

export function normalizeSymbolInput(input: string): string {
  return input.trim().toUpperCase().replace(/^(SH|SZ)/, "");
}

export function validateSymbol(input: string): {
  ok: true;
  symbol: string;
  board: MarketBoard;
} | { ok: false; error: string } {
  const symbol = normalizeSymbolInput(input);
  if (!PURE_CODE.test(symbol)) {
    return { ok: false, error: "请输入 6 位 A 股代码，例如 601318" };
  }
  const board = inferBoard(symbol);
  if (!board) {
    return { ok: false, error: "无法识别该代码所属市场" };
  }
  // Common A-share prefixes: SH 60/68/51…, SZ 00/30/15…
  const allowed =
    /^(60|68|51|50|11|13)\d{4}$/.test(symbol) ||
    /^(00|30|15|16|12|18)\d{4}$/.test(symbol);
  if (!allowed) {
    return { ok: false, error: "暂不支持该代码类型，请确认后重试" };
  }
  return { ok: true, symbol, board };
}

export function toProviderCode(stock: Pick<WatchStock, "symbol" | "board">): string {
  return `${stock.board.toLowerCase()}${stock.symbol}`;
}

/** Simple A-share session check (Asia/Shanghai). Holidays left for later versions. */
export function getMarketStatus(now = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") {
    return "weekend";
  }

  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const afternoonClose = 15 * 60;

  if (mins < morningOpen) return "pre_market";
  if (mins >= morningOpen && mins < morningClose) return "trading";
  if (mins >= morningClose && mins < afternoonOpen) return "lunch_break";
  if (mins >= afternoonOpen && mins < afternoonClose) return "trading";
  return "after_hours";
}

export function isTradingSession(status = getMarketStatus()): boolean {
  return status === "trading";
}

export function marketStatusLabel(status: MarketStatus): string {
  switch (status) {
    case "trading":
      return "交易中";
    case "lunch_break":
      return "午休";
    case "pre_market":
      return "盘前";
    case "after_hours":
      return "已收盘";
    case "weekend":
      return "休市";
    default:
      return "未知";
  }
}

/** Parse Tencent datetime like 20261112141752 → epoch ms. */
export function parseProviderTimestamp(raw: string): number {
  if (!/^\d{14}$/.test(raw)) return Date.now();
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const h = Number(raw.slice(8, 10));
  const mi = Number(raw.slice(10, 12));
  const s = Number(raw.slice(12, 14));
  // Interpret as Asia/Shanghai wall clock via fixed +08:00 offset.
  return Date.parse(
    `${String(y).padStart(4, "0")}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}+08:00`
  );
}
