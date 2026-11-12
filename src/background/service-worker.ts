import { fetchStockQuotes, resolveStockMeta } from "../api/stock-api";
import {
  loadState,
  saveWatchlist,
  updateSettings,
  savePosition,
  saveQuoteSnapshot,
} from "../storage/storage";
import {
  MAX_WATCHLIST,
  type AppSettings,
  type AppState,
  type MarketStatus,
  type PanelBounds,
  type RuntimeMessage,
  type RuntimeResponse,
  type StockQuote,
  type WatchStock,
} from "../types/stock";
import {
  getMarketStatus,
  isTradingSession,
  validateSymbol,
} from "../utils/market";

const ALARM_REFRESH = "stock-float-refresh";

let cachedQuotes: StockQuote[] = [];
let lastUpdated: number | null = null;
let lastError: string | null = null;
let lastMarketStatus: MarketStatus = "unknown";
const visibleTabs = new Set<number>();
let refreshInFlight: Promise<void> | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let panelWindowId: number | null = null;

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  await syncPanelWindow();
  await scheduleAlarm();
  await refreshQuotes("startup");
});

chrome.runtime.onStartup.addListener(async () => {
  await syncPanelWindow();
  await scheduleAlarm();
  await refreshQuotes("startup");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_REFRESH) return;
  await refreshQuotes("alarm");
  await scheduleAlarm();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message as RuntimeMessage, sender)
    .then((response) => sendResponse(response))
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error } satisfies RuntimeResponse);
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (visibleTabs.delete(tabId)) {
    void scheduleAlarm();
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (panelWindowId === windowId) {
    panelWindowId = null;
    void updateSettings({ enabled: false }).then(async (settings) => {
      await scheduleAlarm();
      await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
    });
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.settings || changes.watchlist) {
    if (changes.settings) {
      await syncPanelWindow();
    }
    await scheduleAlarm();
    await broadcastState();
    if (changes.watchlist) {
      await refreshQuotes("watchlist-change");
    }
  }
});

async function handleMessage(
  message: RuntimeMessage,
  sender?: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  switch (message.type) {
    case "GET_STATE": {
      const state = await loadState();
      return {
        ok: true,
        state,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "GET_QUOTES": {
      return {
        ok: true,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "REFRESH_NOW": {
      await refreshQuotes("manual", true);
      const state = await loadState();
      return {
        ok: true,
        state,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "ADD_STOCK": {
      const state = await addStock(message.symbol);
      return {
        ok: true,
        state,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "REMOVE_STOCK": {
      const state = await removeStock(message.symbol);
      return {
        ok: true,
        state,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "MOVE_STOCK": {
      const state = await moveStock(message.symbol, message.direction);
      return {
        ok: true,
        state,
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "UPDATE_SETTINGS": {
      const settings = await updateSettings(message.patch);
      const state = await loadState();
      await syncPanelWindow();
      await scheduleAlarm();
      await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
      return {
        ok: true,
        state: { ...state, settings },
        quotes: cachedQuotes,
        lastError,
        lastUpdated,
        marketStatus: lastMarketStatus,
      };
    }
    case "SET_POSITION": {
      const settings = await savePosition(message.position);
      return {
        ok: true,
        state: { ...(await loadState()), settings },
        quotes: cachedQuotes,
      };
    }
    case "SET_PANEL_BOUNDS": {
      const settings = await updateSettings({ panelBounds: message.bounds });
      return {
        ok: true,
        state: { ...(await loadState()), settings },
        quotes: cachedQuotes,
      };
    }
    case "TOGGLE_VISIBLE":
    case "SHOW_FLOAT": {
      const settings = await updateSettings({ enabled: true, minimized: false });
      await syncPanelWindow();
      await scheduleAlarm();
      await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
      return { ok: true, state: { ...(await loadState()), settings } };
    }
    case "HIDE_FLOAT": {
      const settings = await updateSettings({ enabled: false });
      await syncPanelWindow();
      await scheduleAlarm();
      await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
      return { ok: true, state: { ...(await loadState()), settings } };
    }
    case "PAGE_VISIBILITY": {
      const tabId = sender?.tab?.id;
      if (typeof tabId === "number") {
        if (message.visible) visibleTabs.add(tabId);
        else visibleTabs.delete(tabId);
      }
      if (message.visible) {
        await refreshQuotes("page-visible");
      }
      await scheduleAlarm();
      return { ok: true };
    }
    default:
      return { ok: false, error: "未知消息类型" };
  }
}

async function addStock(rawSymbol: string): Promise<AppState> {
  const validated = validateSymbol(rawSymbol);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const state = await loadState();
  if (state.watchlist.some((s) => s.symbol === validated.symbol)) {
    throw new Error("该股票已在自选列表中");
  }
  if (state.watchlist.length >= MAX_WATCHLIST) {
    throw new Error(`自选最多 ${MAX_WATCHLIST} 只`);
  }

  const draft: WatchStock = {
    symbol: validated.symbol,
    board: validated.board,
    name: validated.symbol,
  };

  const resolved = await resolveStockMeta(draft);
  if (!resolved.name) {
    throw new Error("股票代码无效");
  }

  const watchlist = [...state.watchlist, resolved];
  await saveWatchlist(watchlist);
  await refreshQuotes("add-stock", true);
  return loadState();
}

async function removeStock(symbol: string): Promise<AppState> {
  const state = await loadState();
  const watchlist = state.watchlist.filter((s) => s.symbol !== symbol);
  await saveWatchlist(watchlist);
  cachedQuotes = cachedQuotes.filter((q) => q.symbol !== symbol);
  await broadcastQuotes();
  return loadState();
}

async function moveStock(
  symbol: string,
  direction: "up" | "down"
): Promise<AppState> {
  const state = await loadState();
  const index = state.watchlist.findIndex((s) => s.symbol === symbol);
  if (index < 0) return state;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.watchlist.length) return state;

  const watchlist = [...state.watchlist];
  const [item] = watchlist.splice(index, 1);
  watchlist.splice(target, 0, item);
  await saveWatchlist(watchlist);

  // Keep quote order aligned with watchlist.
  const order = new Map(watchlist.map((s, i) => [s.symbol, i]));
  cachedQuotes = [...cachedQuotes].sort(
    (a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0)
  );
  await broadcastQuotes();
  return loadState();
}

async function refreshQuotes(
  reason: string,
  force = false
): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const state = await loadState();
    lastMarketStatus = getMarketStatus();

    if (state.watchlist.length === 0) {
      cachedQuotes = [];
      lastError = null;
      await broadcastQuotes();
      return;
    }

    // Skip high-frequency polling when float is disabled and not forced.
    if (!force && !state.settings.enabled) {
      return;
    }

    // Outside trading hours, only refresh on manual/startup/add unless forced.
    if (
      !force &&
      !isTradingSession(lastMarketStatus) &&
      reason === "alarm" &&
      lastUpdated !== null
    ) {
      // Soft refresh at most every 5 minutes off-hours via alarm path.
      const elapsed = Date.now() - lastUpdated;
      if (elapsed < 5 * 60 * 1000) {
        return;
      }
    }

    try {
      const quotes = await fetchStockQuotes(state.watchlist);
      cachedQuotes = quotes;
      lastUpdated = Date.now();
      lastError = null;
      // Sync names if provider returns better names.
      let renamed = false;
      const watchlist = state.watchlist.map((stock) => {
        const q = quotes.find((item) => item.symbol === stock.symbol);
        if (q?.name && q.name !== stock.name) {
          renamed = true;
          return { ...stock, name: q.name };
        }
        return stock;
      });
      if (renamed) {
        await saveWatchlist(watchlist);
      }
      await broadcastQuotes();
    } catch (err) {
      // Keep previous quotes on failure.
      lastError = err instanceof Error ? err.message : String(err);
      lastMarketStatus = getMarketStatus();
      await broadcastQuotes();
    }
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function scheduleAlarm(): Promise<void> {
  const state = await loadState();
  const trading = isTradingSession();
  const base = state.settings.refreshInterval;

  // Prefer an in-worker timer while float panel is enabled.
  restartLiveTimer(state.settings.refreshInterval, state.settings.enabled, trading);

  await chrome.alarms.clear(ALARM_REFRESH);
  const delayInMinutes =
    !state.settings.enabled || !trading ? 5 : 1;
  await chrome.alarms.create(ALARM_REFRESH, { delayInMinutes });
}

function restartLiveTimer(
  intervalSec: number,
  enabled: boolean,
  trading: boolean
): void {
  if (liveTimer) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }

  if (!enabled) {
    return;
  }

  const ms = (trading ? intervalSec : Math.max(intervalSec * 6, 60)) * 1000;
  const tick = async () => {
    await refreshQuotes("timer");
    liveTimer = setTimeout(() => {
      void tick();
    }, ms);
  };
  liveTimer = setTimeout(() => {
    void tick();
  }, ms);
}

async function broadcastState(): Promise<void> {
  await broadcastQuotes();
  const state = await loadState();
  await notifyExtensionPages({
    type: "STATE_UPDATED",
    state,
    quotes: cachedQuotes,
    lastError,
    lastUpdated,
    marketStatus: lastMarketStatus,
  });
}

async function broadcastQuotes(): Promise<void> {
  await saveQuoteSnapshot({
    quotes: cachedQuotes,
    lastUpdated,
    lastError,
    marketStatus: lastMarketStatus,
  });
  await notifyExtensionPages({
    type: "QUOTES_UPDATED",
    quotes: cachedQuotes,
    lastError,
    lastUpdated,
    marketStatus: lastMarketStatus,
  });
}

async function notifyExtensionPages(payload: Record<string, unknown>): Promise<void> {
  try {
    await chrome.runtime.sendMessage(payload);
  } catch {
    // Popup / options page may be closed.
  }
}

async function syncPanelWindow(): Promise<void> {
  const state = await loadState();
  if (!state.settings.enabled) {
    if (panelWindowId !== null) {
      try {
        await chrome.windows.remove(panelWindowId);
      } catch {
        // already closed
      }
      panelWindowId = null;
    }
    return;
  }

  if (panelWindowId !== null) {
    try {
      await chrome.windows.get(panelWindowId);
      // Keep existing window; panel page reacts to storage/settings.
      return;
    } catch {
      panelWindowId = null;
    }
  }

  const bounds = resolvePanelBounds(state.settings.panelBounds, state.settings.minimized);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("panel/panel.html"),
    type: "popup",
    focused: true,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
  });
  panelWindowId = win.id ?? null;
}

function resolvePanelBounds(
  saved: PanelBounds | null | undefined,
  minimized: boolean
): PanelBounds {
  const width = minimized ? 160 : 320;
  const height = minimized ? 56 : 240;
  if (
    saved &&
    Number.isFinite(saved.left) &&
    Number.isFinite(saved.top) &&
    Number.isFinite(saved.width) &&
    Number.isFinite(saved.height)
  ) {
    return {
      left: saved.left,
      top: saved.top,
      width: minimized ? width : Math.max(width, saved.width),
      height: minimized ? height : Math.max(height, saved.height),
    };
  }

  // Fallback: bottom-right of a common desktop size.
  const screenW = 1440;
  const screenH = 900;
  return {
    width,
    height,
    left: Math.max(20, screenW - width - 24),
    top: Math.max(20, screenH - height - 48),
  };
}

// Warm state on worker boot.
void syncPanelWindow();
void scheduleAlarm();
void refreshQuotes("boot");

export type { AppSettings };
