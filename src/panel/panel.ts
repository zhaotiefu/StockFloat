import type {
  AppSettings,
  AppState,
  MarketStatus,
  StockQuote,
  WatchStock,
} from "../types/stock";
import { DEFAULT_SETTINGS } from "../types/stock";
import {
  formatChangePercent,
  formatPrice,
  formatTime,
  quoteTone,
} from "../utils/format";
import { marketStatusLabel } from "../utils/market";
import { onStorageChanged } from "../storage/storage";

const app = document.getElementById("app") as HTMLElement;

let watchlist: WatchStock[] = [];
let settings: AppSettings = { ...DEFAULT_SETTINGS };
let quotes: StockQuote[] = [];
let lastUpdated: number | null = null;
let lastError: string | null = null;
let marketStatus: MarketStatus = "unknown";
let settingsOpen = false;
let opacityTimer: number | undefined;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let currentWindowId: number | undefined;

async function boot(): Promise<void> {
  const win = await chrome.windows.getCurrent();
  currentWindowId = win.id;

  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (res?.ok) {
    if (res.state) applyState(res.state as AppState);
    quotes = res.quotes ?? [];
    lastUpdated = res.lastUpdated ?? null;
    lastError = res.lastError ?? null;
    marketStatus = res.marketStatus ?? "unknown";
  }
  render();
  await syncWindowSize();

  onStorageChanged((changes) => {
    if (changes.settings) {
      settings = changes.settings;
      render();
      void syncWindowSize();
    }
    if (changes.watchlist) {
      watchlist = changes.watchlist;
      render();
      void syncWindowSize();
    }
    if (changes.quoteSnapshot) {
      quotes = changes.quoteSnapshot.quotes;
      lastUpdated = changes.quoteSnapshot.lastUpdated;
      lastError = changes.quoteSnapshot.lastError;
      marketStatus = changes.quoteSnapshot.marketStatus;
      render();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "QUOTES_UPDATED") {
      quotes = message.quotes ?? [];
      lastUpdated = message.lastUpdated ?? null;
      lastError = message.lastError ?? null;
      marketStatus = message.marketStatus ?? "unknown";
      render();
    }
    if (message?.type === "STATE_UPDATED" && message.state) {
      applyState(message.state as AppState);
      quotes = message.quotes ?? quotes;
      lastUpdated = message.lastUpdated ?? lastUpdated;
      lastError = message.lastError ?? lastError;
      marketStatus = message.marketStatus ?? marketStatus;
      render();
      void syncWindowSize();
    }
  });

  app.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function applyState(state: AppState): void {
  watchlist = state.watchlist;
  settings = state.settings;
}

function render(): void {
  if (!settings.enabled) {
    app.innerHTML = "";
    return;
  }

  const alpha = Math.min(1, Math.max(0.2, settings.opacity / 100));
  app.style.setProperty("--sf-alpha", String(alpha));

  if (settings.minimized) {
    const lead = quotes[0];
    const tone = quoteTone(lead?.changePercent);
    app.innerHTML = `
      <div class="sf-mini" data-action="restore" title="点击恢复">
        <span>STOCK</span>
        <span class="sf-change sf-${tone}">${formatChangePercent(lead?.changePercent ?? null)}</span>
      </div>
    `;
    bindActions();
    return;
  }

  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
  const rows =
    watchlist.length === 0
      ? `<div class="sf-empty">尚未添加自选股票<br/>打开扩展弹窗进行管理</div>`
      : watchlist
          .map((stock) => {
            const q = quoteMap.get(stock.symbol);
            const tone = quoteTone(q?.changePercent ?? null);
            const symbolHtml = settings.showSymbol
              ? `<span class="sf-symbol">${stock.symbol}</span>`
              : "";
            return `
              <div class="sf-row">
                <div class="sf-name">${escapeHtml(stock.name || stock.symbol)}${symbolHtml}</div>
                <div class="sf-price">${formatPrice(q?.price ?? null)}</div>
                <div class="sf-change sf-${tone}">${formatChangePercent(q?.changePercent ?? null)}</div>
              </div>
            `;
          })
          .join("");

  const statusText = lastError
    ? "更新异常"
    : marketStatus === "trading"
      ? "自动刷新中"
      : marketStatusLabel(marketStatus);
  const dotClass = lastError ? "warn" : marketStatus === "trading" ? "" : "off";
  const timeLabel = settings.showUpdateTime
    ? formatTime(lastUpdated)
    : marketStatusLabel(marketStatus);
  const errorBlock = lastError
    ? `<div class="sf-error">网络或行情源异常：${escapeHtml(lastError)}</div>`
    : "";

  app.innerHTML = `
    <div class="sf-panel">
      <div class="sf-header" data-drag="1">
        <div class="sf-title">STOCK FLOAT</div>
        <div class="sf-actions">
          <button class="sf-btn" type="button" data-action="toggle-settings" title="透明度">⚙</button>
          <button class="sf-btn" type="button" data-action="minimize" title="最小化">─</button>
          <button class="sf-btn" type="button" data-action="hide" title="隐藏">×</button>
        </div>
      </div>
      <div class="sf-settings ${settingsOpen ? "open" : ""}">
        <label>
          <span>透明度 ${settings.opacity}%</span>
          <input type="range" min="20" max="100" step="1" value="${settings.opacity}" data-action="opacity" />
        </label>
      </div>
      <div class="sf-list">${rows}</div>
      ${errorBlock}
      <div class="sf-footer">
        <span>${timeLabel}</span>
        <div class="sf-footer-right">
          <span class="sf-status-dot ${dotClass}"></span>
          <span>${statusText}</span>
          <button class="sf-refresh-btn" type="button" data-action="refresh">刷新</button>
        </div>
      </div>
    </div>
  `;
  bindActions();
}

function bindActions(): void {
  app.querySelectorAll("[data-action]").forEach((el) => {
    const action = el.getAttribute("data-action");
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    if (action === "opacity") {
      el.addEventListener("input", (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        settings = { ...settings, opacity: value };
        app.style.setProperty("--sf-alpha", String(value / 100));
        const label = app.querySelector(".sf-settings span");
        if (label) label.textContent = `透明度 ${value}%`;
        window.clearTimeout(opacityTimer);
        opacityTimer = window.setTimeout(() => {
          void send({ type: "UPDATE_SETTINGS", patch: { opacity: value } });
        }, 150);
      });
      return;
    }
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (action === "toggle-settings") {
        settingsOpen = !settingsOpen;
        render();
        void syncWindowSize();
      } else if (action === "minimize") {
        void send({ type: "UPDATE_SETTINGS", patch: { minimized: true } });
      } else if (action === "restore") {
        void send({ type: "UPDATE_SETTINGS", patch: { minimized: false } });
      } else if (action === "hide") {
        void send({ type: "HIDE_FLOAT" });
      } else if (action === "refresh") {
        void send({ type: "REFRESH_NOW" });
      }
    });
  });
}

async function syncWindowSize(): Promise<void> {
  if (!currentWindowId) return;
  const height = settings.minimized
    ? 56
    : Math.min(420, Math.max(120, 90 + watchlist.length * 34 + (settingsOpen ? 50 : 0) + (lastError ? 36 : 0)));
  try {
    await chrome.windows.update(currentWindowId, {
      width: settings.minimized ? 160 : 320,
      height,
    });
  } catch {
    // ignore
  }
}

function onPointerDown(e: PointerEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("button, input, .sf-row, .sf-actions")) return;
  if (!target.closest("[data-drag='1'], .sf-header, .sf-mini")) return;
  dragging = true;
  dragOffsetX = e.screenX;
  dragOffsetY = e.screenY;
}

async function onPointerMove(e: PointerEvent): Promise<void> {
  if (!dragging || !currentWindowId) return;
  const dx = e.screenX - dragOffsetX;
  const dy = e.screenY - dragOffsetY;
  dragOffsetX = e.screenX;
  dragOffsetY = e.screenY;
  try {
    const win = await chrome.windows.get(currentWindowId);
    await chrome.windows.update(currentWindowId, {
      left: (win.left ?? 0) + dx,
      top: (win.top ?? 0) + dy,
    });
  } catch {
    dragging = false;
  }
}

function onPointerUp(): void {
  if (!dragging || !currentWindowId) {
    dragging = false;
    return;
  }
  dragging = false;
  void chrome.windows.get(currentWindowId).then((win) => {
    void send({
      type: "SET_PANEL_BOUNDS",
      bounds: {
        left: win.left ?? 0,
        top: win.top ?? 0,
        width: win.width ?? 320,
        height: win.height ?? 200,
      },
    });
  });
}

async function send(message: Record<string, unknown>): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // ignore
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

void boot();
