/**
 * Smoke-test the Tencent quote endpoint + GBK parse path used by the extension.
 */
const url = "https://qt.gtimg.cn/q=sh601318,sh600519,sz300750,sz999999";

const res = await fetch(url, { cache: "no-store" });
if (!res.ok) {
  console.error("HTTP", res.status);
  process.exit(1);
}

const buf = await res.arrayBuffer();
const text = new TextDecoder("gbk").decode(buf);
const quotes = [];

for (const line of text.split(";")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const match = /^v_([a-z]{2})(\d{6})="(.*)"$/.exec(trimmed);
  if (!match) continue;
  const fields = match[3].split("~");
  quotes.push({
    symbol: match[2],
    name: fields[1],
    price: Number(fields[3]),
    preClose: Number(fields[4]),
    changePercent: Number(fields[32]),
    time: fields[30],
  });
}

console.log(JSON.stringify(quotes, null, 2));
if (quotes.length < 3) {
  console.error("Expected at least 3 valid quotes");
  process.exit(1);
}
if (quotes.some((q) => !q.name || !Number.isFinite(q.price))) {
  console.error("Invalid quote payload");
  process.exit(1);
}
console.log("smoke-quote: ok");
