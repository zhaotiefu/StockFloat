"use strict";
(() => {
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
  var MAX_WATCHLIST = 20;

  // src/utils/format.ts
  function formatPrice(price) {
    if (price === null || price === void 0 || Number.isNaN(price)) {
      return "--";
    }
    return price.toFixed(2);
  }
  function formatChangePercent(changePercent) {
    if (changePercent === null || changePercent === void 0 || Number.isNaN(changePercent)) {
      return "--";
    }
    const sign = changePercent > 0 ? "+" : "";
    return `${sign}${changePercent.toFixed(2)}%`;
  }
  function formatTime(timestamp) {
    if (!timestamp) return "--:--:--";
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return "--:--:--";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  function quoteTone(changePercent) {
    if (changePercent === null || changePercent === void 0 || Number.isNaN(changePercent)) {
      return "flat";
    }
    if (changePercent > 0) return "up";
    if (changePercent < 0) return "down";
    return "flat";
  }

  // src/utils/market.ts
  function marketStatusLabel(status) {
    switch (status) {
      case "trading":
        return "\u4EA4\u6613\u4E2D";
      case "lunch_break":
        return "\u5348\u4F11";
      case "pre_market":
        return "\u76D8\u524D";
      case "after_hours":
        return "\u5DF2\u6536\u76D8";
      case "weekend":
        return "\u4F11\u5E02";
      default:
        return "\u672A\u77E5";
    }
  }

  // src/popup/popup.ts
  var els = {
    addForm: document.getElementById("addForm"),
    symbolInput: document.getElementById("symbolInput"),
    formError: document.getElementById("formError"),
    watchlist: document.getElementById("watchlist"),
    emptyHint: document.getElementById("emptyHint"),
    enabled: document.getElementById("enabled"),
    opacity: document.getElementById("opacity"),
    opacityValue: document.getElementById("opacityValue"),
    refreshInterval: document.getElementById("refreshInterval"),
    showSymbol: document.getElementById("showSymbol"),
    showUpdateTime: document.getElementById("showUpdateTime"),
    minimized: document.getElementById("minimized"),
    resetPosition: document.getElementById("resetPosition"),
    refreshBtn: document.getElementById("refreshBtn"),
    statusLine: document.getElementById("statusLine")
  };
  var state = null;
  var quotes = [];
  async function send(message) {
    return await chrome.runtime.sendMessage(message);
  }
  async function refreshView() {
    const res = await send({ type: "GET_STATE" });
    if (!res.ok || !res.state) {
      els.statusLine.textContent = res.ok ? "\u72B6\u6001\u52A0\u8F7D\u5931\u8D25" : res.error;
      return;
    }
    state = res.state;
    quotes = res.quotes ?? [];
    renderAll(res);
  }
  function renderAll(res) {
    if (!res.ok || !state) return;
    renderWatchlist(state.watchlist, quotes);
    renderSettings(state);
    const time = formatTime(res.lastUpdated);
    const market = marketStatusLabel(res.marketStatus ?? "unknown");
    if (res.lastError) {
      els.statusLine.textContent = `\u5F02\u5E38\uFF1A${res.lastError}`;
    } else {
      els.statusLine.textContent = `${market} \xB7 \u66F4\u65B0 ${time} \xB7 ${state.watchlist.length}/${MAX_WATCHLIST}`;
    }
  }
  function renderSettings(appState) {
    const s = appState.settings;
    els.enabled.checked = s.enabled;
    els.opacity.value = String(s.opacity);
    els.opacityValue.textContent = `${s.opacity}%`;
    els.refreshInterval.value = String(s.refreshInterval);
    els.showSymbol.checked = s.showSymbol;
    els.showUpdateTime.checked = s.showUpdateTime;
    els.minimized.checked = s.minimized;
  }
  function renderWatchlist(watchlist, quoteList) {
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
        <button type="button" data-act="up" data-symbol="${stock.symbol}" ${index === 0 ? "disabled" : ""}>\u4E0A\u79FB</button>
        <button type="button" data-act="down" data-symbol="${stock.symbol}" ${index === watchlist.length - 1 ? "disabled" : ""}>\u4E0B\u79FB</button>
        <button type="button" class="danger" data-act="remove" data-symbol="${stock.symbol}">\u5220\u9664</button>
      </div>
    `;
      els.watchlist.appendChild(li);
    });
  }
  els.watchlist.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const symbol = btn.dataset.symbol;
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
      showError("\u8BF7\u8F93\u5165\u80A1\u7968\u4EE3\u7801");
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
    await patchSettings({ enabled: els.enabled.checked });
  });
  els.opacity.addEventListener("input", () => {
    els.opacityValue.textContent = `${els.opacity.value}%`;
  });
  els.opacity.addEventListener("change", async () => {
    await patchSettings({ opacity: Number(els.opacity.value) });
  });
  els.refreshInterval.addEventListener("change", async () => {
    await patchSettings({
      refreshInterval: Number(els.refreshInterval.value)
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
  async function patchSettings(patch) {
    const res = await send({ type: "UPDATE_SETTINGS", patch });
    if (!res.ok) {
      showError(res.error);
      return;
    }
    state = res.state ?? state;
    quotes = res.quotes ?? quotes;
    if (state) renderAll(res);
  }
  function showError(err) {
    els.formError.hidden = false;
    els.formError.textContent = err instanceof Error ? err.message : String(err);
  }
  function hideError() {
    els.formError.hidden = true;
    els.formError.textContent = "";
  }
  function escapeHtml(input) {
    return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "QUOTES_UPDATED") {
      quotes = message.quotes ?? [];
      if (state) {
        renderWatchlist(state.watchlist, quotes);
        els.statusLine.textContent = message.lastError ? `\u5F02\u5E38\uFF1A${message.lastError}` : `${marketStatusLabel(message.marketStatus ?? "unknown")} \xB7 \u66F4\u65B0 ${formatTime(message.lastUpdated)}`;
      }
    }
    if (message?.type === "STATE_UPDATED" && message.state) {
      state = message.state;
      quotes = message.quotes ?? quotes;
      renderAll({
        ok: true,
        state: message.state,
        quotes,
        lastError: message.lastError,
        lastUpdated: message.lastUpdated,
        marketStatus: message.marketStatus
      });
    }
  });
  void refreshView();
})();
//# sourceMappingURL=popup.js.map
