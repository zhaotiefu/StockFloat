import {
  loadQuoteSnapshot,
  loadState,
  onStorageChanged,
} from "../storage/storage";
import type { AppSettings, FloatPosition } from "../types/stock";
import { FloatWindow } from "./float-window";

const HOST_ID = "stock-float-root";

function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

async function safeSend(message: Record<string, unknown>): Promise<unknown> {
  if (!extensionAlive()) return null;
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    // Extension reloaded/disabled — old content script is stale.
    return null;
  }
}

async function main(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;
  // Skip exotic schemes just in case.
  if (!/^https?:$/.test(location.protocol)) return;
  if (!extensionAlive()) return;

  let cssText = "";
  try {
    const cssUrl = chrome.runtime.getURL("content/float.css");
    cssText = await fetch(cssUrl).then((r) => r.text());
  } catch {
    return;
  }

  let saveTimer: number | undefined;
  const float = new FloatWindow(cssText, (position: FloatPosition) => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void safeSend({ type: "SET_POSITION", position });
    }, 120);
  });

  const boot = (await safeSend({ type: "GET_STATE" })) as
    | {
        ok?: boolean;
        state?: Parameters<FloatWindow["applyState"]>[0];
        quotes?: Parameters<FloatWindow["update"]>[0]["quotes"];
        lastUpdated?: number | null;
        lastError?: string | null;
        marketStatus?: Parameters<FloatWindow["update"]>[0]["marketStatus"];
      }
    | null;

  if (boot?.ok) {
    if (boot.state) float.applyState(boot.state);
    float.update({
      quotes: boot.quotes ?? [],
      lastUpdated: boot.lastUpdated ?? null,
      lastError: boot.lastError ?? null,
      marketStatus: boot.marketStatus ?? "unknown",
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
          marketStatus: snapshot.marketStatus,
        });
      }
    } catch {
      // storage unavailable after reload
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
          marketStatus: changes.quoteSnapshot.marketStatus,
        });
      }
    });
  } catch {
    // ignore
  }

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!extensionAlive()) return;
      if (message?.type === "QUOTES_UPDATED") {
        float.update({
          quotes: message.quotes ?? [],
          lastUpdated: message.lastUpdated ?? null,
          lastError: message.lastError ?? null,
          marketStatus: message.marketStatus ?? "unknown",
        });
      }
      if (message?.type === "STATE_UPDATED" && message.state) {
        float.applyState(message.state);
        float.update({
          quotes: message.quotes ?? [],
          lastUpdated: message.lastUpdated ?? null,
          lastError: message.lastError ?? null,
          marketStatus: message.marketStatus ?? "unknown",
        });
      }
      if (message?.type === "SETTINGS_UPDATED" && message.settings) {
        float.update({ settings: message.settings as AppSettings });
      }
    });
  } catch {
    // ignore
  }

  let lastVisible: boolean | null = null;
  const reportVisibility = (next: boolean) => {
    if (lastVisible === next) return;
    lastVisible = next;
    void safeSend({
      type: "PAGE_VISIBILITY",
      visible: next,
    });
  };
  document.addEventListener("visibilitychange", () => {
    reportVisibility(document.visibilityState === "visible");
  });
  reportVisibility(document.visibilityState === "visible");
  window.addEventListener("pagehide", () => reportVisibility(false));
}

void main().catch(() => {
  // Never let content-script boot failures bubble as page errors.
});
