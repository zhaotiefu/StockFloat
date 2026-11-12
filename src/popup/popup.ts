import type {
  AppState,
  RuntimeResponse,
  StockQuote,
  WatchStock,
} from "../types/stock";
import { DEFAULT_POSITION, MAX_WATCHLIST } from "../types/stock";
import {
  formatChangePercent,
  formatPrice,
  formatTime,
  quoteTone,
} from "../utils/format";
import { marketStatusLabel } from "../utils/market";

const els = {
  addForm: document.getElementById("addForm") as HTMLFormElement,
  symbolInput: document.getElementById("symbolInput") as HTMLInputElement,
  formError: document.getElementById("formError") as HTMLParagraphElement,
  watchlist: document.getElementById("watchlist") as HTMLUListElement,
  emptyHint: document.getElementById("emptyHint") as HTMLParagraphElement,
  enabled: document.getElementById("enabled") as HTMLInputElement,
  opacity: document.getElementById("opacity") as HTMLInputElement,
  opacityValue: document.getElementById("opacityValue") as HTMLElement,
  refreshInterval: document.getElementById("refreshInterval") as HTMLSelectElement,
  showSymbol: document.getElementById("showSymbol") as HTMLInputElement,
  showUpdateTime: document.getElementById("showUpdateTime") as HTMLInputElement,
  minimized: document.getElementById("minimized") as HTMLInputElement,
  resetPosition: document.getElementById("resetPosition") as HTMLButtonElement,
  refreshBtn: document.getElementById("refreshBtn") as HTMLButtonElement,
  statusLine: document.getElementById("statusLine") as HTMLElement,
};

let state: AppState | null = null;
let quotes: StockQuote[] = [];

async function send(message: Record<string, unknown>): Promise<RuntimeResponse> {
  return (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
}

async function refreshView(): Promise<void> {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok || !res.state) {
    els.statusLine.textContent = res.ok ? "状态加载失败" : res.error;
    return;
  }
  state = res.state;
  quotes = res.quotes ?? [];
  renderAll(res);
}

function renderAll(res: RuntimeResponse): void {
  if (!res.ok || !state) return;
  renderWatchlist(state.watchlist, quotes);
  renderSettings(state);
  const time = formatTime(res.lastUpdated);
  const market = marketStatusLabel(res.marketStatus ?? "unknown");
  if (res.lastError) {
    els.statusLine.textContent = `异常：${res.lastError}`;
  } else {
    els.statusLine.textContent = `${market} · 更新 ${time} · ${state.watchlist.length}/${MAX_WATCHLIST}`;
  }
}

function renderSettings(appState: AppState): void {
  const s = appState.settings;
  els.enabled.checked = s.enabled;
  els.opacity.value = String(s.opacity);
  els.opacityValue.textContent = `${s.opacity}%`;
  els.refreshInterval.value = String(s.refreshInterval);
  els.showSymbol.checked = s.showSymbol;
  els.showUpdateTime.checked = s.showUpdateTime;
  els.minimized.checked = s.minimized;
}

function renderWatchlist(watchlist: WatchStock[], quoteList: StockQuote[]): void {
  const map = new Map(quoteList.map((q) => [q.symbol, q]));
  els.watchlist.innerHTML = "";
  els.emptyHint.hidden = watchlist.length > 0;

  watchlist.forEach((stock, index) => {
    const q = map.get(stock.symbol);
    const tone = quoteTone(q?.changePercent ?? null);
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="meta">
        <div class="name">${escapeHtml(stock.name)}</div>
        <div class="code">${stock.symbol}</div>
      </div>
      <div class="quote">
        <div class="price">${formatPrice(q?.price ?? null)}</div>
        <div class="chg ${tone}">${formatChangePercent(q?.changePercent ?? null)}</div>
      </div>
      <div class="item-actions">
        <button type="button" data-act="up" data-symbol="${stock.symbol}" ${index === 0 ? "disabled" : ""}>上移</button>
        <button type="button" data-act="down" data-symbol="${stock.symbol}" ${index === watchlist.length - 1 ? "disabled" : ""}>下移</button>
        <button type="button" class="danger" data-act="remove" data-symbol="${stock.symbol}">删除</button>
      </div>
    `;
    els.watchlist.appendChild(li);
  });
}

els.watchlist.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
  if (!btn) return;
  const symbol = btn.dataset.symbol!;
  const act = btn.dataset.act;
  try {
    if (act === "remove") {
      await send({ type: "REMOVE_STOCK", symbol });
    } else if (act === "up" || act === "down") {
      await send({ type: "MOVE_STOCK", symbol, direction: act });
    }
    await refreshView();
  } catch (err) {
    showError(err);
  }
});

els.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const symbol = els.symbolInput.value.trim();
  if (!symbol) {
    showError("请输入股票代码");
    return;
  }
  const res = await send({ type: "ADD_STOCK", symbol });
  if (!res.ok) {
    showError(res.error);
    return;
  }
  els.symbolInput.value = "";
  state = res.state ?? state;
  quotes = res.quotes ?? quotes;
  if (state) renderAll(res);
});

els.enabled.addEventListener("change", async () => {
  if (els.enabled.checked) {
    // Force show + inject into open tabs.
    await send({ type: "SHOW_FLOAT" });
    await refreshView();
  } else {
    await patchSettings({ enabled: false });
  }
});
els.opacity.addEventListener("input", () => {
  els.opacityValue.textContent = `${els.opacity.value}%`;
});
els.opacity.addEventListener("change", async () => {
  await patchSettings({ opacity: Number(els.opacity.value) });
});
els.refreshInterval.addEventListener("change", async () => {
  await patchSettings({
    refreshInterval: Number(els.refreshInterval.value) as 2 | 5 | 10 | 30,
  });
});
els.showSymbol.addEventListener("change", async () => {
  await patchSettings({ showSymbol: els.showSymbol.checked });
});
els.showUpdateTime.addEventListener("change", async () => {
  await patchSettings({ showUpdateTime: els.showUpdateTime.checked });
});
els.minimized.addEventListener("change", async () => {
  await patchSettings({ minimized: els.minimized.checked });
});
els.resetPosition.addEventListener("click", async () => {
  await patchSettings({ position: { ...DEFAULT_POSITION } });
});
els.refreshBtn.addEventListener("click", async () => {
  const res = await send({ type: "REFRESH_NOW" });
  if (!res.ok) {
    showError(res.error);
    return;
  }
  state = res.state ?? state;
  quotes = res.quotes ?? quotes;
  if (state) renderAll(res);
});

async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  const res = await send({ type: "UPDATE_SETTINGS", patch });
  if (!res.ok) {
    showError(res.error);
    return;
  }
  state = res.state ?? state;
  quotes = res.quotes ?? quotes;
  if (state) renderAll(res);
}

function showError(err: unknown): void {
  els.formError.hidden = false;
  els.formError.textContent = err instanceof Error ? err.message : String(err);
}

function hideError(): void {
  els.formError.hidden = true;
  els.formError.textContent = "";
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "QUOTES_UPDATED") {
    quotes = message.quotes ?? [];
    if (state) {
      renderWatchlist(state.watchlist, quotes);
      els.statusLine.textContent = message.lastError
        ? `异常：${message.lastError}`
        : `${marketStatusLabel(message.marketStatus ?? "unknown")} · 更新 ${formatTime(message.lastUpdated)}`;
    }
  }
  if (message?.type === "STATE_UPDATED" && message.state) {
    state = message.state as AppState;
    quotes = message.quotes ?? quotes;
    renderAll({
      ok: true,
      state: message.state as AppState,
      quotes,
      lastError: message.lastError,
      lastUpdated: message.lastUpdated,
      marketStatus: message.marketStatus,
    });
  }
});

void refreshView();
