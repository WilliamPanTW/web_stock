import express from "express";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, save } from "./store.js";
import { ensureSymbol, intradayTick, closeJob, refreshEps, nowHM } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());

/* ── 登入 ── */
app.post("/api/login", (req, res) => {
  if (!process.env.APP_TOKEN || req.body?.token !== process.env.APP_TOKEN)
    return res.status(401).json({ error: "密碼錯誤" });
  res.cookie("t", process.env.APP_TOKEN, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 365 * 864e5 });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  if (process.env.APP_TOKEN && req.cookies.t === process.env.APP_TOKEN) return next();
  res.status(401).json({ error: "請先登入" });
});

/* ── 狀態（格式與前端雛形相同）── */
function state() {
  const db = getDb();
  const ids = Object.keys(db.lists);
  const days = ids.map((id) => db.bars[id]?.at(-1)?.date).filter(Boolean).sort();
  return {
    day: days.at(-1) || null,
    lastUpdate: db.lastUpdate,
    lists: db.lists,
    alerts: db.alerts,
    universe: ids.map((id) => ({
      id,
      name: db.meta[id]?.name || id,
      eps: db.meta[id]?.eps ? db.meta[id].eps.map((e) => e.value) : null,
    })),
    stocks: Object.fromEntries(ids.map((id) => [id, { bars: (db.bars[id] || []).slice(-180) }])),
  };
}
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
};

app.get("/api/state", (req, res) => res.json(state()));

app.post("/api/watch", wrap(async (req, res) => {
  const id = String(req.body?.id || "").trim().toUpperCase();
  if (!/^\d{4,6}[A-Z]?$/.test(id)) throw new Error("股票代號格式不正確");
  await ensureSymbol(id);
  const db = getDb();
  db.lists[id] ||= { list: "watch" };
  save();
  res.json(state());
}));

app.post("/api/buy", wrap(async (req, res) => {
  const { id, price, shares } = req.body || {};
  const db = getDb();
  if (!db.lists[id]) throw new Error("請先加入觀察清單");
  if (!(price > 0 && shares > 0)) throw new Error("買入價與股數必須大於 0");
  const last = db.bars[id].at(-1);
  db.lists[id] = { list: "pool", holding: { price, shares, date: last.date, high: Math.max(price, last.c) } };
  save();
  res.json(state());
}));

app.post("/api/sell", wrap(async (req, res) => {
  const db = getDb();
  if (!db.lists[req.body?.id]) throw new Error("找不到這檔股票");
  db.lists[req.body.id] = { list: "watch" };
  save();
  res.json(state());
}));

app.delete("/api/lists/:id", wrap(async (req, res) => {
  delete getDb().lists[req.params.id];
  save();
  res.json(state());
}));

app.post("/api/alerts/read", wrap(async (req, res) => {
  const db = getDb();
  const key = req.body?.key;
  db.alerts = db.alerts.map((a) => (!key || a.key === key ? { ...a, read: true } : a));
  save();
  res.json(state());
}));

/* ── 推播訂閱 ── */
app.get("/api/push/key", (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || null }));
app.post("/api/push/subscribe", wrap(async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) throw new Error("訂閱資料不完整");
  const db = getDb();
  db.subs = [...db.subs.filter((s) => s.endpoint !== sub.endpoint), sub];
  save();
  res.json({ ok: true });
}));

/* ── 排程 ── */
const jobs = { tick: intradayTick, close: closeJob, eps: refreshEps };
let running = false;
async function run(name) {
  if (running) return console.log(`[cron] 上一個工作還在跑，略過 ${name}`);
  running = true;
  const t0 = Date.now();
  try {
    const n = await jobs[name]();
    console.log(`[cron] ${name} 完成 ${Date.now() - t0}ms${typeof n === "number" ? `，通知 ${n} 則` : ""}`);
  } catch (e) {
    console.error(`[cron] ${name} 失敗`, e);
  } finally {
    running = false;
  }
}

// 手動執行（測試用）：POST /api/admin/run/tick | close | eps
app.post("/api/admin/run/:job", wrap(async (req, res) => {
  if (!jobs[req.params.job]) throw new Error("job 只能是 tick、close、eps");
  await run(req.params.job);
  res.json(state());
}));

const tz = { timezone: "Asia/Taipei" };
cron.schedule("*/10 9-13 * * 1-5", () => { if (nowHM() <= "13:30") run("tick"); }, tz); // 盤中每 10 分鐘
cron.schedule("45 13 * * 1-5", () => run("close"), tz); // 收盤後
cron.schedule("0 7 * * 1", () => run("eps"), tz); // 每週一更新 EPS

/* ── 前端靜態檔 ── */
const dist = path.join(__dirname, "../../web/dist");
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`盯盤伺服器啟動：http://localhost:${port}`));
