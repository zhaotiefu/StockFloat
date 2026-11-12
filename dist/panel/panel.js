"use strict";
(() => {
  // src/types/stock.ts
  var DEFAULT_POSITION = {
    right: 20,
    bottom: 20
  };
  var DEFAULT_SETTINGS = {
    enabled: true,
    opacity: 92,
    refreshInterval: 2,
    showSymbol: false,
    showUpdateTime: true,
    minimized: false,
    position: { ...DEFAULT_POSITION },
    panelBounds: null
  };

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
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(d);
    const hh = parts.find((p) => p.type === "hour")?.value ?? "--";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "--";
    const ss = parts.find((p) => p.type === "second")?.value ?? "--";
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

  // src/utils/position.ts
  function normalizePosition(raw) {
    if (!raw) return { ...DEFAULT_POSITION };
    return {
      right: Number.isFinite(raw.right) ? Number(raw.right) : DEFAULT_POSITION.right,
      bottom: Number.isFinite(raw.bottom) ? Number(raw.bottom) : DEFAULT_POSITION.bottom
    };
  }

  // src/storage/storage.ts
  function mergeSettings(partial) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...partial ?? {},
      position: normalizePosition(partial?.position ?? DEFAULT_SETTINGS.position),
      panelBounds: partial?.panelBounds ?? DEFAULT_SETTINGS.panelBounds
    };
    if (merged.opacity < 20) merged.opacity = 20;
    if (merged.opacity > 100) merged.opacity = 100;
    if (![2, 5, 10, 30].includes(merged.refreshInterval)) {
      merged.refreshInterval = 2;
    }
    return merged;
  }
  function onStorageChanged(listener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (!chrome.runtime?.id) return;
        if (area !== "local") return;
        const payload = {};
        if (changes.watchlist) {
          payload.watchlist = changes.watchlist.newValue;
        }
        if (changes.settings) {
          payload.settings = mergeSettings(changes.settings.newValue);
        }
        if (changes.quoteSnapshot) {
          payload.quoteSnapshot = changes.quoteSnapshot.newValue;
        }
        if (payload.watchlist || payload.settings || payload.quoteSnapshot) {
          listener(payload);
        }
      } catch {
      }
    });
  }

  // src/panel/panel.ts
  var app = document.getElementById("app");
  var watchlist = [];
  var settings = { ...DEFAULT_SETTINGS };
  var quotes = [];
  var lastUpdated = null;
  var lastError = null;
  var marketStatus = "unknown";
  var settingsOpen = false;
  var opacityTimer;
  var dragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var currentWindowId;
  async function boot() {
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id;
    const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (res?.ok) {
      if (res.state) applyState(res.state);
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
        applyState(message.state);
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
  function applyState(state) {
    watchlist = state.watchlist;
    settings = state.settings;
  }
  function render() {
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
      <div class="sf-mini" data-action="restore" title="\u70B9\u51FB\u6062\u590D">
        <span>STOCK</span>
        <span class="sf-change sf-${tone}">${formatChangePercent(lead?.changePercent ?? null)}</span>
      </div>
    `;
      bindActions();
      return;
    }
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
    const rows = watchlist.length === 0 ? `<div class="sf-empty">\u5C1A\u672A\u6DFB\u52A0\u81EA\u9009\u80A1\u7968<br/>\u6253\u5F00\u6269\u5C55\u5F39\u7A97\u8FDB\u884C\u7BA1\u7406</div>` : watchlist.map((stock) => {
      const q = quoteMap.get(stock.symbol);
      const tone = quoteTone(q?.changePercent ?? null);
      const symbolHtml = settings.showSymbol ? `<span class="sf-symbol">${stock.symbol}</span>` : "";
      return `
              <div class="sf-row">
                <div class="sf-name">${escapeHtml(stock.name || stock.symbol)}${symbolHtml}</div>
                <div class="sf-price">${formatPrice(q?.price ?? null)}</div>
                <div class="sf-change sf-${tone}">${formatChangePercent(q?.changePercent ?? null)}</div>
              </div>
            `;
    }).join("");
    const statusText = lastError ? "\u66F4\u65B0\u5F02\u5E38" : marketStatus === "trading" ? "\u81EA\u52A8\u5237\u65B0\u4E2D" : marketStatusLabel(marketStatus);
    const dotClass = lastError ? "warn" : marketStatus === "trading" ? "" : "off";
    const timeLabel = settings.showUpdateTime ? formatTime(lastUpdated) : marketStatusLabel(marketStatus);
    const errorBlock = lastError ? `<div class="sf-error">\u7F51\u7EDC\u6216\u884C\u60C5\u6E90\u5F02\u5E38\uFF1A${escapeHtml(lastError)}</div>` : "";
    app.innerHTML = `
    <div class="sf-panel">
      <div class="sf-header" data-drag="1">
        <div class="sf-title">STOCK FLOAT</div>
        <div class="sf-actions">
          <button class="sf-btn" type="button" data-action="toggle-settings" title="\u900F\u660E\u5EA6">\u2699</button>
          <button class="sf-btn" type="button" data-action="minimize" title="\u6700\u5C0F\u5316">\u2500</button>
          <button class="sf-btn" type="button" data-action="hide" title="\u9690\u85CF">\xD7</button>
        </div>
      </div>
      <div class="sf-settings ${settingsOpen ? "open" : ""}">
        <label>
          <span>\u900F\u660E\u5EA6 ${settings.opacity}%</span>
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
          <button class="sf-refresh-btn" type="button" data-action="refresh">\u5237\u65B0</button>
        </div>
      </div>
    </div>
  `;
    bindActions();
  }
  function bindActions() {
    app.querySelectorAll("[data-action]").forEach((el) => {
      const action = el.getAttribute("data-action");
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      if (action === "opacity") {
        el.addEventListener("input", (e) => {
          const value = Number(e.target.value);
          settings = { ...settings, opacity: value };
          app.style.setProperty("--sf-alpha", String(value / 100));
          const label = app.querySelector(".sf-settings span");
          if (label) label.textContent = `\u900F\u660E\u5EA6 ${value}%`;
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
  async function syncWindowSize() {
    if (!currentWindowId) return;
    const height = settings.minimized ? 56 : Math.min(420, Math.max(120, 90 + watchlist.length * 34 + (settingsOpen ? 50 : 0) + (lastError ? 36 : 0)));
    try {
      await chrome.windows.update(currentWindowId, {
        width: settings.minimized ? 160 : 320,
        height
      });
    } catch {
    }
  }
  function onPointerDown(e) {
    const target = e.target;
    if (!target) return;
    if (target.closest("button, input, .sf-row, .sf-actions")) return;
    if (!target.closest("[data-drag='1'], .sf-header, .sf-mini")) return;
    dragging = true;
    dragOffsetX = e.screenX;
    dragOffsetY = e.screenY;
  }
  async function onPointerMove(e) {
    if (!dragging || !currentWindowId) return;
    const dx = e.screenX - dragOffsetX;
    const dy = e.screenY - dragOffsetY;
    dragOffsetX = e.screenX;
    dragOffsetY = e.screenY;
    try {
      const win = await chrome.windows.get(currentWindowId);
      await chrome.windows.update(currentWindowId, {
        left: (win.left ?? 0) + dx,
        top: (win.top ?? 0) + dy
      });
    } catch {
      dragging = false;
    }
  }
  function onPointerUp() {
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
          height: win.height ?? 200
        }
      });
    });
  }
  async function send(message) {
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
    }
  }
  function escapeHtml(input) {
    return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  void boot();
})();
//# sourceMappingURL=panel.js.map
