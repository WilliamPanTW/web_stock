// 外部資料來源：富果（股價）、FinMind（EPS）
const FUGLE = "https://api.fugle.tw/marketdata/v1.0/stock";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";

async function fugle(path, params = {}) {
  const url = new URL(FUGLE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { "X-API-KEY": process.env.FUGLE_API_KEY } });
  if (r.status === 429) throw new Error("富果 API 超過速率限制（429），請拉長更新間隔或升級方案");
  if (r.status === 401) throw new Error("富果 API 金鑰無效（401），請檢查 FUGLE_API_KEY");
  if (!r.ok) throw new Error(`富果 ${path} 回傳 ${r.status}：${await r.text()}`);
  return r.json();
}

// 即時報價
export async function getQuote(symbol) {
  const q = await fugle(`/intraday/quote/${symbol}`);
  return { date: q.date, name: q.name, o: q.openPrice, h: q.highPrice, l: q.lowPrice, c: q.closePrice ?? q.lastPrice };
}

// 股票名稱
export async function getName(symbol) {
  const t = await fugle(`/intraday/ticker/${symbol}`);
  return t.name;
}

// 日 K（單次查詢區間須小於 1 年）
export async function getDailyCandles(symbol, from, to) {
  const d = await fugle(`/historical/candles/${symbol}`, { from, to, timeframe: "D", fields: "open,high,low,close,volume" });
  return (d.data || [])
    .map((b) => ({ date: b.date.slice(0, 10), o: b.open, h: b.high, l: b.low, c: b.close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// 近四季 EPS（ETF 或資料不足時回傳 null）
export async function getEps4Q(symbol, startDate) {
  const url = new URL(FINMIND);
  url.searchParams.set("dataset", "TaiwanStockFinancialStatements");
  url.searchParams.set("data_id", symbol);
  url.searchParams.set("start_date", startDate);
  const headers = process.env.FINMIND_TOKEN ? { Authorization: `Bearer ${process.env.FINMIND_TOKEN}` } : {};
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`FinMind 回傳 ${r.status}`);
  const body = await r.json();
  const eps = (body.data || [])
    .filter((x) => x.type === "EPS")
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-4)
    .map((x) => ({ date: x.date, value: x.value }));
  return eps.length === 4 ? eps : null;
}
