import { getDb, save, addAlert, pruneFired } from "./store.js";
import { getQuote, getName, getDailyCandles, getEps4Q } from "./sources.js";
import { checkIntraday, detectAtClose } from "./logic.js";
import { notify } from "./push.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
export const nowHM = () =>
  new Date().toLocaleTimeString("sv-SE", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" });
const daysAgo = (n) => {
  const d = new Date(today());
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

function mergeBars(old = [], incoming = []) {
  const map = new Map(old.map((b) => [b.date, b]));
  for (const b of incoming) if (b.c != null) map.set(b.date, b);
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-300);
}

// 新股票：抓一年日 K、名稱、EPS
export async function ensureSymbol(id) {
  const db = getDb();
  if (db.bars[id]?.length) return;
  const bars = await getDailyCandles(id, daysAgo(360), today());
  if (bars.length < 30) throw new Error(`查不到 ${id} 足夠的歷史股價，請確認代號`);
  const [name, eps] = await Promise.all([
    getName(id).catch(() => id),
    getEps4Q(id, daysAgo(730)).catch(() => null),
  ]);
  db.bars[id] = bars;
  db.meta[id] = { name, eps };
  save();
}

// 盤中每 10 分鐘：更新今天的 K 棒、檢查門檻
export async function intradayTick() {
  const db = getDb(), t = today();
  let fired = 0;
  for (const id of Object.keys(db.lists)) {
    try {
      const q = await getQuote(id);
      if (q.date !== t || q.c == null) continue; // 休市或尚未成交
      db.bars[id] = mergeBars(db.bars[id], [{ date: t, o: q.o, h: q.h, l: q.l, c: q.c }]);
      const alerts = checkIntraday({
        id, name: db.meta[id]?.name || id, entry: db.lists[id], bars: db.bars[id], price: q.c, date: t,
      });
      for (const a of alerts) if (addAlert(a)) { await notify(db, a); fired++; }
    } catch (e) {
      console.error(`[tick] ${id}`, e.message);
    }
    await sleep(250);
  }
  db.lastUpdate = new Date().toISOString();
  save();
  return fired;
}

// 收盤後：補齊近期日 K、更新高點、判斷交叉
export async function closeJob() {
  const db = getDb(), t = today();
  let fired = 0;
  for (const id of Object.keys(db.lists)) {
    try {
      const recent = await getDailyCandles(id, daysAgo(15), t).catch(() => []);
      db.bars[id] = mergeBars(db.bars[id], recent);
      const q = await getQuote(id);
      if (q.date === t && q.c != null) db.bars[id] = mergeBars(db.bars[id], [{ date: t, o: q.o, h: q.h, l: q.l, c: q.c }]);
      if (db.bars[id].at(-1)?.date !== t) continue; // 今天休市
      const alerts = detectAtClose({ id, name: db.meta[id]?.name || id, entry: db.lists[id], bars: db.bars[id] });
      for (const a of alerts) if (addAlert(a)) { await notify(db, a); fired++; }
    } catch (e) {
      console.error(`[close] ${id}`, e.message);
    }
    await sleep(250);
  }
  pruneFired(t);
  db.lastUpdate = new Date().toISOString();
  save();
  return fired;
}

// 每週更新 EPS
export async function refreshEps() {
  const db = getDb();
  for (const id of Object.keys(db.lists)) {
    try {
      const eps = await getEps4Q(id, daysAgo(730));
      db.meta[id] = { ...db.meta[id], eps };
    } catch (e) {
      console.error(`[eps] ${id}`, e.message);
    }
    await sleep(500);
  }
  save();
}
