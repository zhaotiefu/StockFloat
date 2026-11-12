"use strict";
(() => {
  // src/utils/market.ts
  var PURE_CODE = /^\d{6}$/;
  function inferBoard(symbol) {
    if (!PURE_CODE.test(symbol)) return null;
    if (symbol.startsWith("6") || symbol.startsWith("5") || symbol.startsWith("9")) {
      return "SH";
    }
    if (symbol.startsWith("0") || symbol.startsWith("1") || symbol.startsWith("2") || symbol.startsWith("3")) {
      return "SZ";
    }
    return null;
  }
  function normalizeSymbolInput(input) {
    return input.trim().toUpperCase().replace(/^(SH|SZ)/, "");
  }
  function validateSymbol(input) {
    const symbol = normalizeSymbolInput(input);
    if (!PURE_CODE.test(symbol)) {
      return { ok: false, error: "\u8BF7\u8F93\u5165 6 \u4F4D A \u80A1\u4EE3\u7801\uFF0C\u4F8B\u5982 601318" };
    }
    const board = inferBoard(symbol);
    if (!board) {
      return { ok: false, error: "\u65E0\u6CD5\u8BC6\u522B\u8BE5\u4EE3\u7801\u6240\u5C5E\u5E02\u573A" };
    }
    const allowed = /^(60|68|51|50|11|13)\d{4}$/.test(symbol) || /^(00|30|15|16|12|18)\d{4}$/.test(symbol);
    if (!allowed) {
      return { ok: false, error: "\u6682\u4E0D\u652F\u6301\u8BE5\u4EE3\u7801\u7C7B\u578B\uFF0C\u8BF7\u786E\u8BA4\u540E\u91CD\u8BD5" };
    }
    return { ok: true, symbol, board };
  }
  function toProviderCode(stock) {
    return `${stock.board.toLowerCase()}${stock.symbol}`;
  }
  function getMarketStatus(now = /* @__PURE__ */ new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
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
  function isTradingSession(status = getMarketStatus()) {
    return status === "trading";
  }
  function parseProviderTimestamp(raw) {
    if (!/^\d{14}$/.test(raw)) return Date.now();
    const y = Number(raw.slice(0, 4));
    const mo = Number(raw.slice(4, 6)) - 1;
    const d = Number(raw.slice(6, 8));
    const h = Number(raw.slice(8, 10));
    const mi = Number(raw.slice(10, 12));
    const s = Number(raw.slice(12, 14));
    return Date.parse(
      `${String(y).padStart(4, "0")}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}+08:00`
    );
  }

  // src/api/stock-provider.ts
  var TencentStockProvider = class {
    id = "tencent";
    name = "\u817E\u8BAF\u884C\u60C5";
    endpoint = "https://qt.gtimg.cn/q=";
    async fetchQuotes(stocks) {
      if (stocks.length === 0) return [];
      const codes = stocks.map(toProviderCode).join(",");
      const url = `${this.endpoint}${codes}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "text/plain,*/*"
        }
      });
      if (!response.ok) {
        throw new Error(`\u884C\u60C5\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
      }
      const buffer = await response.arrayBuffer();
      const text = decodeGbk(buffer).trim();
      if (!text) {
        throw new Error("\u884C\u60C5\u6E90\u8FD4\u56DE\u7A7A\u6570\u636E");
      }
      const marketStatus = getMarketStatus();
      const bySymbol = /* @__PURE__ */ new Map();
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
        let change = parseOptionalNumber(fields[31]);
        let changePercent = parseOptionalNumber(fields[32]);
        if ((change === null || changePercent === null) && price !== null && preClose !== null && preClose !== 0) {
          change = Number((price - preClose).toFixed(2));
          changePercent = Number(((price - preClose) / preClose * 100).toFixed(2));
        }
        if (preClose === null || preClose === 0) {
          change = null;
          changePercent = null;
        }
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
          marketStatus
        });
      }
      return stocks.map((stock) => {
        const hit = bySymbol.get(stock.symbol);
        if (hit) {
          return {
            ...hit,
            name: hit.name || stock.name || stock.symbol
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
          marketStatus
        };
      });
    }
  };
  function parseOptionalNumber(raw) {
    if (raw === void 0 || raw === null) return null;
    const t = String(raw).trim();
    if (!t || t === "-" || t === "--") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return n;
  }
  function decodeGbk(buffer) {
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
  var defaultProvider = new TencentStockProvider();

  // src/api/stock-api.ts
  var provider = defaultProvider;
  async function fetchStockQuotes(stocks) {
    if (stocks.length === 0) return [];
    return provider.fetchQuotes(stocks);
  }
  async function resolveStockMeta(stock) {
    const [quote] = await provider.fetchQuotes([stock]);
    if (!quote) {
      throw new Error("\u672A\u627E\u5230\u8BE5\u80A1\u7968\u6216\u884C\u60C5\u6E90\u6682\u4E0D\u53EF\u7528");
    }
    if (quote.price === null && quote.preClose === null) {
      throw new Error("\u80A1\u7968\u4EE3\u7801\u65E0\u6548\u6216\u6682\u65E0\u884C\u60C5");
    }
    return {
      ...stock,
      name: quote.name || stock.name || stock.symbol
    };
  }

  // src/types/stock.ts
  var DEFAULT_POSITION = {
    right: 20,
    bottom: 20
  };
  var DEFAULT_SETTINGS = {
    enabled: true,
    opacity: 85,
    refreshInterval: 5,
    showSymbol: false,
    showUpdateTime: true,
    minimized: false,
    position: { ...DEFAULT_POSITION }
  };
  var DEFAULT_WATCHLIST = [
    { symbol: "601318", name: "\u4E2D\u56FD\u5E73\u5B89", board: "SH" },
    { symbol: "600519", name: "\u8D35\u5DDE\u8305\u53F0", board: "SH" },
    { symbol: "600036", name: "\u62DB\u5546\u94F6\u884C", board: "SH" },
    { symbol: "300750", name: "\u5B81\u5FB7\u65F6\u4EE3", board: "SZ" }
  ];
  var MAX_WATCHLIST = 20;

  // src/utils/position.ts
  function normalizePosition(raw) {
    if (!raw) return { ...DEFAULT_POSITION };
    return {
      right: Number.isFinite(raw.right) ? Number(raw.right) : DEFAULT_POSITION.right,
      bottom: Number.isFinite(raw.bottom) ? Number(raw.bottom) : DEFAULT_POSITION.bottom
    };
  }

  // src/storage/storage.ts
  var KEYS = {
    watchlist: "watchlist",
    settings: "settings",
    quoteSnapshot: "quoteSnapshot"
  };
  async function loadState() {
    const raw = await chrome.storage.local.get([KEYS.watchlist, KEYS.settings]);
    const watchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [...DEFAULT_WATCHLIST];
    const settings = mergeSettings(raw.settings);
    return { watchlist, settings };
  }
  async function saveWatchlist(watchlist) {
    await chrome.storage.local.set({ [KEYS.watchlist]: watchlist });
  }
  async function saveSettings(settings) {
    await chrome.storage.local.set({ [KEYS.settings]: settings });
  }
  async function updateSettings(patch) {
    const state = await loadState();
    const next = mergeSettings({ ...state.settings, ...patch });
    if (patch.position) {
      next.position = normalizePosition(patch.position);
    }
    await saveSettings(next);
    return next;
  }
  async function savePosition(position) {
    return updateSettings({ position: normalizePosition(position) });
  }
  function mergeSettings(partial) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...partial ?? {},
      position: normalizePosition(partial?.position ?? DEFAULT_SETTINGS.position)
    };
    if (merged.opacity < 20) merged.opacity = 20;
    if (merged.opacity > 100) merged.opacity = 100;
    if (![5, 10, 30].includes(merged.refreshInterval)) {
      merged.refreshInterval = 5;
    }
    return merged;
  }
  async function saveQuoteSnapshot(snapshot) {
    await chrome.storage.local.set({ [KEYS.quoteSnapshot]: snapshot });
  }

  // src/background/service-worker.ts
  var ALARM_REFRESH = "stock-float-refresh";
  var cachedQuotes = [];
  var lastUpdated = null;
  var lastError = null;
  var lastMarketStatus = "unknown";
  var visibleTabs = /* @__PURE__ */ new Set();
  var refreshInFlight = null;
  var liveTimer = null;
  chrome.runtime.onInstalled.addListener(async () => {
    await loadState();
    await scheduleAlarm();
    await refreshQuotes("startup");
  });
  chrome.runtime.onStartup.addListener(async () => {
    await scheduleAlarm();
    await refreshQuotes("startup");
  });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_REFRESH) return;
    await refreshQuotes("alarm");
    await scheduleAlarm();
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then((response) => sendResponse(response)).catch((err) => {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error });
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (visibleTabs.delete(tabId)) {
      void scheduleAlarm();
    }
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.settings || changes.watchlist) {
      await scheduleAlarm();
      await broadcastState();
      if (changes.watchlist) {
        await refreshQuotes("watchlist-change");
      }
    }
  });
  async function handleMessage(message, sender) {
    switch (message.type) {
      case "GET_STATE": {
        const state = await loadState();
        return {
          ok: true,
          state,
          quotes: cachedQuotes,
          lastError,
          lastUpdated,
          marketStatus: lastMarketStatus
        };
      }
      case "GET_QUOTES": {
        return {
          ok: true,
          quotes: cachedQuotes,
          lastError,
          lastUpdated,
          marketStatus: lastMarketStatus
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
          marketStatus: lastMarketStatus
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
          marketStatus: lastMarketStatus
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
          marketStatus: lastMarketStatus
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
          marketStatus: lastMarketStatus
        };
      }
      case "UPDATE_SETTINGS": {
        const settings = await updateSettings(message.patch);
        const state = await loadState();
        await scheduleAlarm();
        await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
        return {
          ok: true,
          state: { ...state, settings },
          quotes: cachedQuotes,
          lastError,
          lastUpdated,
          marketStatus: lastMarketStatus
        };
      }
      case "SET_POSITION": {
        const settings = await savePosition(message.position);
        return {
          ok: true,
          state: { ...await loadState(), settings },
          quotes: cachedQuotes
        };
      }
      case "TOGGLE_VISIBLE":
      case "SHOW_FLOAT": {
        const settings = await updateSettings({ enabled: true });
        await scheduleAlarm();
        await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
        return { ok: true, state: { ...await loadState(), settings } };
      }
      case "HIDE_FLOAT": {
        const settings = await updateSettings({ enabled: false });
        await scheduleAlarm();
        await notifyExtensionPages({ type: "SETTINGS_UPDATED", settings });
        return { ok: true, state: { ...await loadState(), settings } };
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
        return { ok: false, error: "\u672A\u77E5\u6D88\u606F\u7C7B\u578B" };
    }
  }
  async function addStock(rawSymbol) {
    const validated = validateSymbol(rawSymbol);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    const state = await loadState();
    if (state.watchlist.some((s) => s.symbol === validated.symbol)) {
      throw new Error("\u8BE5\u80A1\u7968\u5DF2\u5728\u81EA\u9009\u5217\u8868\u4E2D");
    }
    if (state.watchlist.length >= MAX_WATCHLIST) {
      throw new Error(`\u81EA\u9009\u6700\u591A ${MAX_WATCHLIST} \u53EA`);
    }
    const draft = {
      symbol: validated.symbol,
      board: validated.board,
      name: validated.symbol
    };
    const resolved = await resolveStockMeta(draft);
    if (!resolved.name) {
      throw new Error("\u80A1\u7968\u4EE3\u7801\u65E0\u6548");
    }
    const watchlist = [...state.watchlist, resolved];
    await saveWatchlist(watchlist);
    await refreshQuotes("add-stock", true);
    return loadState();
  }
  async function removeStock(symbol) {
    const state = await loadState();
    const watchlist = state.watchlist.filter((s) => s.symbol !== symbol);
    await saveWatchlist(watchlist);
    cachedQuotes = cachedQuotes.filter((q) => q.symbol !== symbol);
    await broadcastQuotes();
    return loadState();
  }
  async function moveStock(symbol, direction) {
    const state = await loadState();
    const index = state.watchlist.findIndex((s) => s.symbol === symbol);
    if (index < 0) return state;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= state.watchlist.length) return state;
    const watchlist = [...state.watchlist];
    const [item] = watchlist.splice(index, 1);
    watchlist.splice(target, 0, item);
    await saveWatchlist(watchlist);
    const order = new Map(watchlist.map((s, i) => [s.symbol, i]));
    cachedQuotes = [...cachedQuotes].sort(
      (a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0)
    );
    await broadcastQuotes();
    return loadState();
  }
  async function refreshQuotes(reason, force = false) {
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
      if (!force && !state.settings.enabled && visibleTabs.size === 0) {
        return;
      }
      if (!force && !isTradingSession(lastMarketStatus) && reason === "alarm" && lastUpdated !== null) {
        const elapsed = Date.now() - lastUpdated;
        if (elapsed < 5 * 60 * 1e3) {
          return;
        }
      }
      try {
        const quotes = await fetchStockQuotes(state.watchlist);
        cachedQuotes = quotes;
        lastUpdated = Date.now();
        lastError = null;
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
  async function scheduleAlarm() {
    const state = await loadState();
    const trading = isTradingSession();
    const base = state.settings.refreshInterval;
    restartLiveTimer(state.settings.refreshInterval, state.settings.enabled, trading);
    await chrome.alarms.clear(ALARM_REFRESH);
    const delayInMinutes = !state.settings.enabled || visibleTabs.size === 0 || !trading ? 5 : 1;
    await chrome.alarms.create(ALARM_REFRESH, { delayInMinutes });
  }
  function restartLiveTimer(intervalSec, enabled, trading) {
    if (liveTimer) {
      clearTimeout(liveTimer);
      liveTimer = null;
    }
    if (!enabled || visibleTabs.size === 0) {
      return;
    }
    const ms = (trading ? intervalSec : Math.max(intervalSec * 6, 60)) * 1e3;
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
  async function broadcastState() {
    await broadcastQuotes();
    const state = await loadState();
    await notifyExtensionPages({
      type: "STATE_UPDATED",
      state,
      quotes: cachedQuotes,
      lastError,
      lastUpdated,
      marketStatus: lastMarketStatus
    });
  }
  async function broadcastQuotes() {
    await saveQuoteSnapshot({
      quotes: cachedQuotes,
      lastUpdated,
      lastError,
      marketStatus: lastMarketStatus
    });
    await notifyExtensionPages({
      type: "QUOTES_UPDATED",
      quotes: cachedQuotes,
      lastError,
      lastUpdated,
      marketStatus: lastMarketStatus
    });
  }
  async function notifyExtensionPages(payload) {
    try {
      await chrome.runtime.sendMessage(payload);
    } catch {
    }
  }
  void scheduleAlarm();
  void refreshQuotes("boot");
})();
//# sourceMappingURL=service-worker.js.map
