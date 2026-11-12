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
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
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
