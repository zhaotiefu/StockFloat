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
    refreshInterval: 2,
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

  // src/utils/position.ts
  var FLOAT_WIDTH = 300;
  var FLOAT_MIN_HEIGHT = 90;
  var EDGE_PAD = 8;
  function clampPosition(position, size = {
    width: FLOAT_WIDTH,
    height: FLOAT_MIN_HEIGHT
  }) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxRight = Math.max(EDGE_PAD, vw - size.width - EDGE_PAD);
    const maxBottom = Math.max(EDGE_PAD, vh - size.height - EDGE_PAD);
    return {
      right: clamp(position.right, EDGE_PAD, maxRight),
      bottom: clamp(position.bottom, EDGE_PAD, maxBottom)
    };
  }
  function normalizePosition(raw) {
    if (!raw) return { ...DEFAULT_POSITION };
    return {
      right: Number.isFinite(raw.right) ? Number(raw.right) : DEFAULT_POSITION.right,
      bottom: Number.isFinite(raw.bottom) ? Number(raw.bottom) : DEFAULT_POSITION.bottom
    };
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
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
  function mergeSettings(partial) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...partial ?? {},
      position: normalizePosition(partial?.position ?? DEFAULT_SETTINGS.position)
    };
    if (merged.opacity < 20) merged.opacity = 20;
    if (merged.opacity > 100) merged.opacity = 100;
    if (![2, 5, 10, 30].includes(merged.refreshInterval)) {
      merged.refreshInterval = 2;
    }
    return merged;
  }
  async function loadQuoteSnapshot() {
    const raw = await chrome.storage.local.get(KEYS.quoteSnapshot);
    return raw.quoteSnapshot ?? null;
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

  // src/content/float-window.ts
  var FloatWindow = class {
    host;
    shadow;
    root;
    cssText;
    model;
    onSavePosition;
    dragging = false;
    dragOffsetX = 0;
    dragOffsetY = 0;
    settingsOpen = false;
    opacityTimer;
    constructor(cssText, onSavePosition) {
      this.cssText = cssText;
      this.onSavePosition = onSavePosition;
      this.model = {
        watchlist: [],
        settings: { ...DEFAULT_SETTINGS },
        quotes: [],
        lastUpdated: null,
        lastError: null,
        marketStatus: "unknown"
      };
      this.host = document.createElement("div");
      this.host.id = "stock-float-root";
      this.host.style.all = "initial";
      this.host.style.position = "fixed";
      this.host.style.zIndex = "2147483646";
      this.shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = this.cssText;
      this.root = document.createElement("div");
      this.root.className = "sf-root";
      this.shadow.append(style, this.root);
      document.documentElement.appendChild(this.host);
      this.root.addEventListener("pointerdown", (e) => this.onPointerDown(e));
      window.addEventListener("pointermove", (e) => this.onPointerMove(e));
      window.addEventListener("pointerup", () => this.onPointerUp());
      window.addEventListener("resize", () => this.correctPosition());
    }
    destroy() {
      this.host.remove();
    }
    update(partial) {
      this.model = {
        ...this.model,
        ...partial,
        settings: partial.settings ? { ...this.model.settings, ...partial.settings } : this.model.settings
      };
      this.render();
    }
    applyState(state) {
      this.update({
        watchlist: state.watchlist,
        settings: state.settings
      });
    }
    render() {
      const { settings } = this.model;
      if (!settings.enabled) {
        this.root.innerHTML = "";
        this.root.classList.add("sf-hidden");
        return;
      }
      this.root.classList.remove("sf-hidden");
      const alpha = Math.min(1, Math.max(0.2, settings.opacity / 100));
      this.root.style.setProperty("--sf-alpha", String(alpha));
      const pos = clampPosition(normalizePosition(settings.position), {
        width: 300,
        height: settings.minimized ? 40 : 120
      });
      this.root.style.right = `${pos.right}px`;
      this.root.style.bottom = `${pos.bottom}px`;
      this.root.style.left = "auto";
      this.root.style.top = "auto";
      if (settings.minimized) {
        this.root.innerHTML = this.renderMini();
        this.bindMini();
        return;
      }
      this.root.innerHTML = this.renderPanel();
      this.bindPanel();
    }
    renderMini() {
      const lead = this.model.quotes[0];
      const tone = quoteTone(lead?.changePercent);
      const change = formatChangePercent(lead?.changePercent ?? null);
      return `
      <div class="sf-mini" data-action="restore" title="\u70B9\u51FB\u6062\u590D">
        <span>STOCK</span>
        <span class="sf-change sf-${tone}">${change}</span>
      </div>
    `;
    }
    renderPanel() {
      const { settings, watchlist, quotes, lastError, lastUpdated, marketStatus } = this.model;
      const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
      const rows = watchlist.length === 0 ? `<div class="sf-empty">\u5C1A\u672A\u6DFB\u52A0\u81EA\u9009\u80A1\u7968<br/>\u70B9\u51FB\u6269\u5C55\u56FE\u6807\u8FDB\u884C\u7BA1\u7406</div>` : watchlist.map((stock) => {
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
      return `
      <div class="sf-panel">
        <div class="sf-header" data-drag="1">
          <div class="sf-title">STOCK FLOAT</div>
          <div class="sf-actions">
            <button class="sf-btn" type="button" data-action="toggle-settings" title="\u900F\u660E\u5EA6">\u2699</button>
            <button class="sf-btn" type="button" data-action="minimize" title="\u6700\u5C0F\u5316">\u2500</button>
            <button class="sf-btn" type="button" data-action="hide" title="\u9690\u85CF">\xD7</button>
          </div>
        </div>
        <div class="sf-settings ${this.settingsOpen ? "open" : ""}">
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
    }
    bindMini() {
      const mini = this.root.querySelector(".sf-mini");
      mini?.addEventListener("click", () => {
        void this.send({ type: "UPDATE_SETTINGS", patch: { minimized: false } });
      });
      mini?.addEventListener("pointerdown", (e) => {
        const target = e.currentTarget;
        target.setAttribute("data-drag", "1");
        this.beginDrag(e);
      });
    }
    bindPanel() {
      this.root.querySelectorAll("[data-action]").forEach((el) => {
        const action = el.getAttribute("data-action");
        el.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
        });
        if (action === "opacity") {
          el.addEventListener("input", (e) => {
            const value = Number(e.target.value);
            this.model.settings.opacity = value;
            this.root.style.setProperty("--sf-alpha", String(value / 100));
            const label = this.root.querySelector(".sf-settings span");
            if (label) label.textContent = `\u900F\u660E\u5EA6 ${value}%`;
            window.clearTimeout(this.opacityTimer);
            this.opacityTimer = window.setTimeout(() => {
              void this.send({ type: "UPDATE_SETTINGS", patch: { opacity: value } });
            }, 150);
          });
          return;
        }
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (action === "toggle-settings") {
            this.settingsOpen = !this.settingsOpen;
            this.render();
          } else if (action === "minimize") {
            void this.send({ type: "UPDATE_SETTINGS", patch: { minimized: true } });
          } else if (action === "hide") {
            void this.send({ type: "HIDE_FLOAT" });
          } else if (action === "refresh") {
            void this.send({ type: "REFRESH_NOW" });
          }
        });
      });
    }
    onPointerDown(e) {
      const pe = e;
      const target = pe.target;
      if (!target) return;
      if (target.closest("button, input, .sf-row, .sf-actions")) return;
      const dragHandle = target.closest("[data-drag='1'], .sf-header, .sf-mini");
      if (!dragHandle) return;
      this.beginDrag(pe);
    }
    beginDrag(e) {
      e.preventDefault();
      this.dragging = true;
      const rect = this.root.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
    }
    onPointerMove(e) {
      if (!this.dragging) return;
      const width = this.root.offsetWidth || 300;
      const height = this.root.offsetHeight || 90;
      const left = e.clientX - this.dragOffsetX;
      const top = e.clientY - this.dragOffsetY;
      const right = window.innerWidth - left - width;
      const bottom = window.innerHeight - top - height;
      const next = clampPosition({ right, bottom }, { width, height });
      this.root.style.right = `${next.right}px`;
      this.root.style.bottom = `${next.bottom}px`;
      this.model.settings.position = next;
    }
    onPointerUp() {
      if (!this.dragging) return;
      this.dragging = false;
      const position = normalizePosition(this.model.settings.position);
      this.onSavePosition(position);
    }
    correctPosition() {
      const width = this.root.offsetWidth || 300;
      const height = this.root.offsetHeight || 90;
      const next = clampPosition(
        normalizePosition(this.model.settings.position),
        { width, height }
      );
      this.model.settings.position = next;
      this.root.style.right = `${next.right}px`;
      this.root.style.bottom = `${next.bottom}px`;
      this.onSavePosition(next);
    }
    async send(message) {
      try {
        if (!chrome.runtime?.id) return;
        await chrome.runtime.sendMessage(message);
      } catch {
      }
    }
  };
  function escapeHtml(input) {
    return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/content/content.ts
  var HOST_ID = "stock-float-root";
  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }
  async function safeSend(message) {
    if (!extensionAlive()) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }
  async function main() {
    if (document.getElementById(HOST_ID)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!extensionAlive()) return;
    let cssText = "";
    try {
      const cssUrl = chrome.runtime.getURL("content/float.css");
      cssText = await fetch(cssUrl).then((r) => r.text());
    } catch {
      return;
    }
    let saveTimer;
    const float = new FloatWindow(cssText, (position) => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        void safeSend({ type: "SET_POSITION", position });
      }, 120);
    });
    const boot = await safeSend({ type: "GET_STATE" });
    if (boot?.ok) {
      if (boot.state) float.applyState(boot.state);
      float.update({
        quotes: boot.quotes ?? [],
        lastUpdated: boot.lastUpdated ?? null,
        lastError: boot.lastError ?? null,
        marketStatus: boot.marketStatus ?? "unknown"
      });
    } else if (extensionAlive()) {
      try {
        const state = await loadState();
        const snapshot = await loadQuoteSnapshot();
        float.applyState(state);
        if (snapshot) {
          float.update({
            quotes: snapshot.quotes,
            lastUpdated: snapshot.lastUpdated,
            lastError: snapshot.lastError,
            marketStatus: snapshot.marketStatus
          });
        }
      } catch {
      }
    }
    try {
      onStorageChanged((changes) => {
        if (!extensionAlive()) return;
        if (changes.settings) {
          float.update({ settings: changes.settings });
        }
        if (changes.watchlist) {
          float.update({ watchlist: changes.watchlist });
        }
        if (changes.quoteSnapshot) {
          float.update({
            quotes: changes.quoteSnapshot.quotes,
            lastUpdated: changes.quoteSnapshot.lastUpdated,
            lastError: changes.quoteSnapshot.lastError,
            marketStatus: changes.quoteSnapshot.marketStatus
          });
        }
      });
    } catch {
    }
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!extensionAlive()) return;
        if (message?.type === "QUOTES_UPDATED") {
          float.update({
            quotes: message.quotes ?? [],
            lastUpdated: message.lastUpdated ?? null,
            lastError: message.lastError ?? null,
            marketStatus: message.marketStatus ?? "unknown"
          });
        }
        if (message?.type === "STATE_UPDATED" && message.state) {
          float.applyState(message.state);
          float.update({
            quotes: message.quotes ?? [],
            lastUpdated: message.lastUpdated ?? null,
            lastError: message.lastError ?? null,
            marketStatus: message.marketStatus ?? "unknown"
          });
        }
        if (message?.type === "SETTINGS_UPDATED" && message.settings) {
          float.update({ settings: message.settings });
        }
      });
    } catch {
    }
    let lastVisible = null;
    const reportVisibility = (next) => {
      if (lastVisible === next) return;
      lastVisible = next;
      void safeSend({
        type: "PAGE_VISIBILITY",
        visible: next
      });
    };
    document.addEventListener("visibilitychange", () => {
      reportVisibility(document.visibilityState === "visible");
    });
    reportVisibility(document.visibilityState === "visible");
    window.addEventListener("pagehide", () => reportVisibility(false));
  }
  void main().catch(() => {
  });
})();
//# sourceMappingURL=content.js.map
