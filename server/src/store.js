// 單人使用，資料存在一個 JSON 檔
import fs from "node:fs";
import path from "node:path";

const FILE = process.env.DB_FILE || "./data/db.json";
const empty = () => ({ meta: {}, bars: {}, lists: {}, alerts: [], subs: [], fired: {}, lastUpdate: null });

let db = (() => {
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; }
  catch { return empty(); }
})();

export const getDb = () => db;

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// 新增通知（同一天、同一檔、同一種只發一次）
export function addAlert(a) {
  if (db.fired[a.key]) return false;
  db.fired[a.key] = true;
  db.alerts.unshift(a);
  db.alerts = db.alerts.slice(0, 300);
  return true;
}

// 清掉 14 天前的去重紀錄
export function pruneFired(today) {
  const d = new Date(today);
  d.setDate(d.getDate() - 14);
  const cutoff = d.toISOString().slice(0, 10);
  for (const k of Object.keys(db.fired)) if (k.slice(0, 10) < cutoff) delete db.fired[k];
}
