// 與前端雛形相同的計算邏輯：高低點、MACD、KD、通知判斷
export const RULES = { dropFromHigh: 0.10, riseFromLow: 0.15, monthDays: 20 };

export const KIND_LABEL = {
  drop: `高點回落 ${RULES.dropFromHigh * 100}%`,
  rise: `低點反彈 ${RULES.riseFromLow * 100}%`,
  high: "高點更新",
  "macd-golden": "MACD 黃金交叉",
  "macd-death": "MACD 死亡交叉",
  "kd-golden": "KD 黃金交叉",
  "kd-death": "KD 死亡交叉",
};

export const fmtP = (p) =>
  p >= 500 ? Math.round(p).toLocaleString("zh-TW") : p >= 50 ? p.toFixed(1) : p.toFixed(2);
export const pct = (v) => {
  const s = Math.abs(v * 100).toFixed(1) + "%";
  return v > 0.0005 ? "+" + s : v < -0.0005 ? "−" + s : s;
};

function ema(arr, n) {
  const k = 2 / (n + 1), out = [];
  arr.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

export function indicators(bars) {
  const c = bars.map((b) => b.c);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const dif = c.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif, 9);
  let K = 50, D = 50;
  return bars.map((b, i) => {
    const s = bars.slice(Math.max(0, i - 8), i + 1);
    const hh = Math.max(...s.map((x) => x.h)), ll = Math.min(...s.map((x) => x.l));
    const rsv = hh === ll ? 50 : ((b.c - ll) / (hh - ll)) * 100;
    K = (K * 2) / 3 + rsv / 3;
    D = (D * 2) / 3 + K / 3;
    return { dif: dif[i], dea: dea[i], k: K, d: D };
  });
}

export const cross = (prev, cur) =>
  prev <= 0 && cur > 0 ? "golden" : prev >= 0 && cur < 0 ? "death" : null;

// 以收盤價計算第 i 天的一個月高低點
export function monthRange(bars, i) {
  const win = bars.slice(Math.max(0, i - RULES.monthDays + 1), i + 1).map((b) => b.c);
  return { high: Math.max(...win), low: Math.min(...win) };
}

/**
 * 盤中檢查：用即時價判斷是否觸發門檻（高點只在收盤後更新）
 * bars 的最後一根是今天（由即時報價暫存）
 */
export function checkIntraday({ id, name, entry, bars, price, date }) {
  const i = bars.length - 1;
  if (i < 1) return [];
  const out = [];
  const add = (kind, text) => out.push({ key: `${date}-${id}-${kind}`, date, sym: id, name, kind, text, read: false });

  if (entry.list === "pool") {
    const high = entry.holding.high;
    const now = price / high - 1, before = bars[i - 1].c / high - 1;
    if (now <= -RULES.dropFromHigh && before > -RULES.dropFromHigh)
      add("drop", `盤中 ${fmtP(price)}，自高點 ${fmtP(high)} 回落 ${pct(now)}`);
  } else {
    const low = monthRange(bars, i).low;
    const prevLow = monthRange(bars, i - 1).low;
    const now = price / low - 1, before = bars[i - 1].c / prevLow - 1;
    if (now >= RULES.riseFromLow && before < RULES.riseFromLow)
      add("rise", `盤中 ${fmtP(price)}，自一個月低點 ${fmtP(low)} 上漲 ${pct(now)}`);
  }
  return out;
}

/**
 * 收盤後判斷：更新持有後高點、門檻、MACD/KD 交叉
 * 會直接更新 entry.holding.high
 */
export function detectAtClose({ id, name, entry, bars }) {
  const i = bars.length - 1;
  if (i < 30) return [];
  const date = bars[i].date, close = bars[i].c;
  const out = [];
  const add = (kind, text) => out.push({ key: `${date}-${id}-${kind}`, date, sym: id, name, kind, text, read: false });

  if (entry.list === "pool") {
    const h = entry.holding;
    const prevHigh = h.high, newHigh = Math.max(prevHigh, close);
    if (newHigh > prevHigh) add("high", `收盤 ${fmtP(newHigh)} 創持有後新高，參考高點已更新`);
    const now = close / newHigh - 1, before = bars[i - 1].c / prevHigh - 1;
    if (now <= -RULES.dropFromHigh && before > -RULES.dropFromHigh)
      add("drop", `收盤 ${fmtP(close)}，自高點 ${fmtP(newHigh)} 回落 ${pct(now)}`);
    h.high = newHigh;
  } else {
    const low = monthRange(bars, i).low, prevLow = monthRange(bars, i - 1).low;
    const now = close / low - 1, before = bars[i - 1].c / prevLow - 1;
    if (now >= RULES.riseFromLow && before < RULES.riseFromLow)
      add("rise", `收盤 ${fmtP(close)}，自一個月低點 ${fmtP(low)} 上漲 ${pct(now)}`);
  }

  const ind = indicators(bars);
  const a = ind[i - 1], b = ind[i];
  const mc = cross(a.dif - a.dea, b.dif - b.dea);
  if (mc) add(`macd-${mc}`, `DIF ${b.dif.toFixed(2)} ${mc === "golden" ? "向上穿越" : "向下穿越"} MACD ${b.dea.toFixed(2)}`);
  const kc = cross(a.k - a.d, b.k - b.d);
  if (kc) add(`kd-${kc}`, `K ${b.k.toFixed(1)} ${kc === "golden" ? "向上穿越" : "向下穿越"} D ${b.d.toFixed(1)}`);
  return out;
}
