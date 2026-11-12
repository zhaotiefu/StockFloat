export type MarketBoard = "SH" | "SZ";

export type MarketStatus =
  | "trading"
  | "lunch_break"
  | "pre_market"
  | "after_hours"
  | "weekend"
  | "unknown";

export interface StockQuote {
  symbol: string;
  name: string;
  price: number | null;
  preClose: number | null;
  change: number | null;
  changePercent: number | null;
  timestamp: number;
  marketStatus: MarketStatus;
}

export interface WatchStock {
  symbol: string;
  name: string;
  board: MarketBoard;
}

export type RefreshInterval = 2 | 5 | 10 | 30;

export interface FloatPosition {
  /** Offset from the right edge of the viewport (px). */
  right: number;
  /** Offset from the bottom edge of the viewport (px). */
  bottom: number;
}

export interface AppSettings {
  enabled: boolean;
  opacity: number;
  refreshInterval: RefreshInterval;
  showSymbol: boolean;
  showUpdateTime: boolean;
  minimized: boolean;
  position: FloatPosition;
}

export interface AppState {
  watchlist: WatchStock[];
  settings: AppSettings;
}

export const DEFAULT_POSITION: FloatPosition = {
  right: 20,
  bottom: 20,
};

export const DEFAULT_SETTINGS: AppSettings = {
  enabled: true,
  opacity: 85,
  refreshInterval: 2,
  showSymbol: false,
  showUpdateTime: true,
  minimized: false,
  position: { ...DEFAULT_POSITION },
};

export const DEFAULT_WATCHLIST: WatchStock[] = [
  { symbol: "601318", name: "中国平安", board: "SH" },
  { symbol: "600519", name: "贵州茅台", board: "SH" },
  { symbol: "600036", name: "招商银行", board: "SH" },
  { symbol: "300750", name: "宁德时代", board: "SZ" },
];

export const MAX_WATCHLIST = 20;

export type RuntimeMessage =
  | { type: "GET_STATE" }
  | { type: "GET_QUOTES" }
  | { type: "REFRESH_NOW" }
  | { type: "ADD_STOCK"; symbol: string }
  | { type: "REMOVE_STOCK"; symbol: string }
  | { type: "MOVE_STOCK"; symbol: string; direction: "up" | "down" }
  | { type: "UPDATE_SETTINGS"; patch: Partial<AppSettings> }
  | { type: "SET_POSITION"; position: FloatPosition }
  | { type: "TOGGLE_VISIBLE" }
  | { type: "SHOW_FLOAT" }
  | { type: "HIDE_FLOAT" }
  | { type: "PAGE_VISIBILITY"; visible: boolean };

export type RuntimeResponse =
  | {
      ok: true;
      state?: AppState;
      quotes?: StockQuote[];
      error?: string;
      lastError?: string | null;
      lastUpdated?: number | null;
      marketStatus?: MarketStatus;
    }
  | { ok: false; error: string };
