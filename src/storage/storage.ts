import {
  DEFAULT_SETTINGS,
  DEFAULT_WATCHLIST,
  type AppSettings,
  type AppState,
  type FloatPosition,
  type MarketStatus,
  type StockQuote,
  type WatchStock,
} from "../types/stock";
import { normalizePosition } from "../utils/position";

const KEYS = {
  watchlist: "watchlist",
  settings: "settings",
  quoteSnapshot: "quoteSnapshot",
} as const;

export interface QuoteSnapshot {
  quotes: StockQuote[];
  lastUpdated: number | null;
  lastError: string | null;
  marketStatus: MarketStatus;
}

export async function loadState(): Promise<AppState> {
  const raw = await chrome.storage.local.get([KEYS.watchlist, KEYS.settings]);
  const watchlist = Array.isArray(raw.watchlist)
    ? (raw.watchlist as WatchStock[])
    : [...DEFAULT_WATCHLIST];
  const settings = mergeSettings(raw.settings as Partial<AppSettings> | undefined);
  return { watchlist, settings };
}

export async function saveWatchlist(watchlist: WatchStock[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.watchlist]: watchlist });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
}

export async function updateSettings(
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const state = await loadState();
  const next = mergeSettings({ ...state.settings, ...patch });
  if (patch.position) {
    next.position = normalizePosition(patch.position);
  }
  await saveSettings(next);
  return next;
}

export async function savePosition(position: FloatPosition): Promise<AppSettings> {
  return updateSettings({ position: normalizePosition(position) });
}

function mergeSettings(partial?: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(partial ?? {}),
    position: normalizePosition(partial?.position ?? DEFAULT_SETTINGS.position),
  };

  if (merged.opacity < 20) merged.opacity = 20;
  if (merged.opacity > 100) merged.opacity = 100;
  if (![5, 10, 30].includes(merged.refreshInterval)) {
    merged.refreshInterval = 5;
  }

  return merged;
}

export async function saveQuoteSnapshot(snapshot: QuoteSnapshot): Promise<void> {
  await chrome.storage.local.set({ [KEYS.quoteSnapshot]: snapshot });
}

export async function loadQuoteSnapshot(): Promise<QuoteSnapshot | null> {
  const raw = await chrome.storage.local.get(KEYS.quoteSnapshot);
  return (raw.quoteSnapshot as QuoteSnapshot | undefined) ?? null;
}

export function onStorageChanged(
  listener: (changes: {
    watchlist?: WatchStock[];
    settings?: AppSettings;
    quoteSnapshot?: QuoteSnapshot;
  }) => void
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const payload: {
      watchlist?: WatchStock[];
      settings?: AppSettings;
      quoteSnapshot?: QuoteSnapshot;
    } = {};
    if (changes.watchlist) {
      payload.watchlist = changes.watchlist.newValue as WatchStock[];
    }
    if (changes.settings) {
      payload.settings = mergeSettings(changes.settings.newValue as AppSettings);
    }
    if (changes.quoteSnapshot) {
      payload.quoteSnapshot = changes.quoteSnapshot.newValue as QuoteSnapshot;
    }
    if (payload.watchlist || payload.settings || payload.quoteSnapshot) {
      listener(payload);
    }
  });
}
