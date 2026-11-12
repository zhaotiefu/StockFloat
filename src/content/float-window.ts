import type {
  AppSettings,
  AppState,
  FloatPosition,
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
import { clampPosition, normalizePosition } from "../utils/position";

export interface FloatWindowModel {
  watchlist: WatchStock[];
  settings: AppSettings;
  quotes: StockQuote[];
  lastUpdated: number | null;
  lastError: string | null;
  marketStatus: MarketStatus;
}

type PositionSaver = (position: FloatPosition) => void;

export class FloatWindow {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private root: HTMLElement;
  private cssText: string;
  private model: FloatWindowModel;
  private onSavePosition: PositionSaver;
  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private settingsOpen = false;
  private opacityTimer: number | undefined;

  constructor(cssText: string, onSavePosition: PositionSaver) {
    this.cssText = cssText;
    this.onSavePosition = onSavePosition;
    this.model = {
      watchlist: [],
      settings: { ...DEFAULT_SETTINGS },
      quotes: [],
      lastUpdated: null,
      lastError: null,
      marketStatus: "unknown",
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

  destroy(): void {
    this.host.remove();
  }

  update(partial: Partial<FloatWindowModel>): void {
    this.model = {
      ...this.model,
      ...partial,
      settings: partial.settings
        ? { ...this.model.settings, ...partial.settings }
        : this.model.settings,
    };
    this.render();
  }

  applyState(state: AppState): void {
    this.update({
      watchlist: state.watchlist,
      settings: state.settings,
    });
  }

  private render(): void {
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
      height: settings.minimized ? 40 : 120,
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

  private renderMini(): string {
    const lead = this.model.quotes[0];
    const tone = quoteTone(lead?.changePercent);
    const change = formatChangePercent(lead?.changePercent ?? null);
    return `
      <div class="sf-mini" data-action="restore" title="点击恢复">
        <span>STOCK</span>
        <span class="sf-change sf-${tone}">${change}</span>
      </div>
    `;
  }

  private renderPanel(): string {
    const { settings, watchlist, quotes, lastError, lastUpdated, marketStatus } =
      this.model;
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
    const rows =
      watchlist.length === 0
        ? `<div class="sf-empty">尚未添加自选股票<br/>点击扩展图标进行管理</div>`
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

    return `
      <div class="sf-panel">
        <div class="sf-header" data-drag="1">
          <div class="sf-title">STOCK FLOAT</div>
          <div class="sf-actions">
            <button class="sf-btn" type="button" data-action="toggle-settings" title="透明度">⚙</button>
            <button class="sf-btn" type="button" data-action="minimize" title="最小化">─</button>
            <button class="sf-btn" type="button" data-action="hide" title="隐藏">×</button>
          </div>
        </div>
        <div class="sf-settings ${this.settingsOpen ? "open" : ""}">
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
  }

  private bindMini(): void {
    const mini = this.root.querySelector(".sf-mini");
    mini?.addEventListener("click", () => {
      void this.send({ type: "UPDATE_SETTINGS", patch: { minimized: false } });
    });
    mini?.addEventListener("pointerdown", (e) => {
      // Allow dragging the mini button via header-less drag.
      const target = e.currentTarget as HTMLElement;
      target.setAttribute("data-drag", "1");
      this.beginDrag(e as PointerEvent);
    });
  }

  private bindPanel(): void {
    this.root.querySelectorAll("[data-action]").forEach((el) => {
      const action = el.getAttribute("data-action");
      if (action === "opacity") {
        el.addEventListener("input", (e) => {
          const value = Number((e.target as HTMLInputElement).value);
          this.model.settings.opacity = value;
          this.root.style.setProperty("--sf-alpha", String(value / 100));
          const label = this.root.querySelector(".sf-settings span");
          if (label) label.textContent = `透明度 ${value}%`;
          window.clearTimeout(this.opacityTimer);
          this.opacityTimer = window.setTimeout(() => {
            void this.send({ type: "UPDATE_SETTINGS", patch: { opacity: value } });
          }, 150);
        });
        return;
      }
      el.addEventListener("click", (e) => {
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

  private onPointerDown(e: Event): void {
    const pe = e as PointerEvent;
    const target = pe.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, input, .sf-row")) return;
    const dragHandle = target.closest("[data-drag='1'], .sf-header, .sf-mini");
    if (!dragHandle) return;
    this.beginDrag(pe);
  }

  private beginDrag(e: PointerEvent): void {
    e.preventDefault();
    this.dragging = true;
    const rect = this.root.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;
  }

  private onPointerMove(e: PointerEvent): void {
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

  private onPointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    const position = normalizePosition(this.model.settings.position);
    this.onSavePosition(position);
  }

  private correctPosition(): void {
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

  private async send(message: Record<string, unknown>): Promise<void> {
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
      // Extension context invalidated on reload.
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
