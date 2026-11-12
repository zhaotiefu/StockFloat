export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) {
    return "--";
  }
  return price.toFixed(2);
}

export function formatChangePercent(
  changePercent: number | null | undefined
): string {
  if (
    changePercent === null ||
    changePercent === undefined ||
    Number.isNaN(changePercent)
  ) {
    return "--";
  }
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

export function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "--:--:--";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  // A-share tool: always show Asia/Shanghai wall clock.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "--";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "--";
  const ss = parts.find((p) => p.type === "second")?.value ?? "--";
  return `${hh}:${mm}:${ss}`;
}

export type QuoteTone = "up" | "down" | "flat";

export function quoteTone(
  changePercent: number | null | undefined
): QuoteTone {
  if (
    changePercent === null ||
    changePercent === undefined ||
    Number.isNaN(changePercent)
  ) {
    return "flat";
  }
  if (changePercent > 0) return "up";
  if (changePercent < 0) return "down";
  return "flat";
}
