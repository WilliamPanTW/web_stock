import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, LineChart, Line, Bar, Cell, XAxis, YAxis,
  ReferenceLine, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import { api, enablePush } from "./api.js";

/* ───────── 設定（與後端 logic.js 保持一致）───────── */
const RULES = { dropFromHigh: 0.10, riseFromLow: 0.15, monthDays: 20 };
const C = {
  bg: "#E9EDF1", side: "#F6F8FA", surface: "#FFFFFF", ink: "#18212C",
  muted: "#66717E", line: "#D3DAE1", up: "#D2283C", down: "#13895A",
  accent: "#2B46A0", amber: "#B7791F",
};

/* ───────── 工具 ───────── */
const fmtP = (p) =>
  p >= 500 ? Math.round(p).toLocaleString("zh-TW") : p >= 50 ? p.toFixed(1) : p.toFixed(2);
const pct = (v) => {
  const s = Math.abs(v * 100).toFixed(1) + "%";
  return v > 0.0005 ? "+" + s : v < -0.0005 ? "−" + s : s;
};
const colorOf = (v) => (v > 0 ? C.up : v < 0 ? C.down : C.muted);
const short = (s) => (s ? s.slice(5).replace("-", "/") : "");

/* ───────── 指標 ───────── */
function ema(arr, n) {
  const k = 2 / (n + 1), out = [];
  arr.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}
function indicators(bars) {
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
    return { date: b.date, c: b.c, dif: dif[i], dea: dea[i], hist: dif[i] - dea[i], k: K, d: D };
  });
}
const cross = (prev, cur) => (prev <= 0 && cur > 0 ? "golden" : prev >= 0 && cur < 0 ? "death" : null);

function lastCross(ind, a, b) {
  for (let i = ind.length - 1; i > 0 && i > ind.length - 60; i--) {
    const t = cross(ind[i - 1][a] - ind[i - 1][b], ind[i][a] - ind[i][b]);
    if (t) return { type: t, date: ind[i].date, ago: ind.length - 1 - i };
  }
  return null;
}

function metrics(entry, bars, i, high) {
  const close = bars[i].c, prevC = i > 0 ? bars[i - 1].c : close;
  const win = bars.slice(Math.max(0, i - RULES.monthDays + 1), i + 1).map((b) => b.c);
  const monthHigh = Math.max(...win), monthLow = Math.min(...win);
  const refHigh = entry.list === "pool" ? high : monthHigh;
  return {
    close, chg: close / prevC - 1, monthHigh, monthLow, refHigh,
    fromHigh: close / refHigh - 1, fromLow: close / monthLow - 1,
  };
}

/* ───────── 通知類型 ───────── */
const KIND = {
  drop: { label: `高點回落 ${RULES.dropFromHigh * 100}%`, color: C.down },
  rise: { label: `低點反彈 ${RULES.riseFromLow * 100}%`, color: C.up },
  high: { label: "高點更新", color: C.up },
  "macd-golden": { label: "MACD 黃金交叉", color: C.up },
  "macd-death": { label: "MACD 死亡交叉", color: C.down },
  "kd-golden": { label: "KD 黃金交叉", color: C.up },
  "kd-death": { label: "KD 死亡交叉", color: C.down },
};

/* ───────── 元件 ───────── */
function Ruler({ m, pool }) {
  const marks = pool
    ? [
        { v: m.monthLow, label: "一個月低點", pos: "top" },
        { v: m.refHigh * (1 - RULES.dropFromHigh), label: `高點 −${RULES.dropFromHigh * 100}%`, pos: "bottom", alert: true },
        { v: m.refHigh, label: "持有後高點", pos: "top" },
      ]
    : [
        { v: m.monthLow, label: "一個月低點", pos: "top" },
        { v: m.monthLow * (1 + RULES.riseFromLow), label: `低點 +${RULES.riseFromLow * 100}%`, pos: "bottom", alert: true },
        { v: m.monthHigh, label: "一個月高點", pos: "top" },
      ];
  const vals = [...marks.map((x) => x.v), m.close];
  const lo = Math.min(...vals) * 0.985, hi = Math.max(...vals) * 1.015;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const alertMark = marks.find((k) => k.alert);
  const triggered = pool ? m.close <= alertMark.v : m.close >= alertMark.v;
  const zone = pool
    ? { left: x(lo), width: `calc(${x(alertMark.v)})` }
    : { left: x(alertMark.v), width: `calc(100% - ${x(alertMark.v)})` };

  return (
    <div className="ruler" aria-label="價格位置與警示門檻">
      <div className="ruler-track">
        <div className="ruler-zone" style={{ ...zone, background: pool ? "rgba(19,137,90,.14)" : "rgba(210,40,60,.12)" }} />
        {marks.map((k) => (
          <div key={k.label} className={`ruler-mark ${k.pos}`} style={{ left: x(k.v) }}>
            <span className="tick" style={{ background: k.alert ? (pool ? C.down : C.up) : C.muted }} />
            <span className="lbl" style={{ color: k.alert ? (pool ? C.down : C.up) : C.muted }}>
              {k.label}<b>{fmtP(k.v)}</b>
            </span>
          </div>
        ))}
        <div className="ruler-pin" style={{ left: x(m.close), borderColor: triggered ? (pool ? C.down : C.up) : C.ink }}>
          <span>現價 {fmtP(m.close)}</span>
        </div>
      </div>
      <p className="ruler-note">
        {pool
          ? triggered
            ? `已跌破高點 −${RULES.dropFromHigh * 100}% 門檻`
            : `距離回落門檻還有 ${pct(alertMark.v / m.close - 1)}`
          : triggered
            ? `已站上低點 +${RULES.riseFromLow * 100}% 門檻`
            : `距離反彈門檻還差 ${pct(alertMark.v / m.close - 1)}`}
      </p>
    </div>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd style={{ color: color || C.ink }}>{value}</dd>
      {sub && <dd className="stat-sub">{sub}</dd>}
    </div>
  );
}

function Detail({ v, onBuy, onSell, onRemove }) {
  const [form, setForm] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setForm(null); setConfirmRemove(false); }, [v.u.id]);

  const { u, m, ind, entry } = v;
  const pool = entry.list === "pool";
  const h = entry.holding;
  const data = ind.slice(-60);
  const epsSum = u.eps ? u.eps.reduce((a, b) => a + b, 0) : null;
  const pe = epsSum ? m.close / epsSum : null;
  const mc = lastCross(ind, "dif", "dea"), kc = lastCross(ind, "k", "d");
  const crossText = (c) =>
    c ? `${c.type === "golden" ? "黃金交叉" : "死亡交叉"}（${short(c.date)}${c.ago === 0 ? "，今天" : `，${c.ago} 個交易日前`}）` : "近 60 日無交叉";

  const refs = pool
    ? [
        { v: m.refHigh, label: "持有後高點", color: C.muted },
        { v: m.refHigh * (1 - RULES.dropFromHigh), label: `−${RULES.dropFromHigh * 100}%`, color: C.down },
        { v: h.price, label: "成本", color: C.accent },
      ]
    : [
        { v: m.monthLow, label: "一個月低點", color: C.muted },
        { v: m.monthLow * (1 + RULES.riseFromLow), label: `+${RULES.riseFromLow * 100}%`, color: C.up },
      ];

  return (
    <section className="detail">
      <header className="d-head">
        <div>
          <h2>{u.name} <span className="sym">{u.id}</span></h2>
          <div className="price-row">
            <span className="price" style={{ color: colorOf(m.chg) }}>{fmtP(m.close)}</span>
            <span className="chg" style={{ color: colorOf(m.chg) }}>
              {m.chg > 0 ? "▲" : m.chg < 0 ? "▼" : ""} {pct(m.chg)}
            </span>
            <span className="in-list">{pool ? "投資 pool" : "觀察清單"}</span>
          </div>
        </div>
        <div className="d-actions">
          {pool ? (
            <button className="btn btn-line" onClick={() => onSell(u.id)}>賣出並移回觀察清單</button>
          ) : (
            !form && <button className="btn btn-primary" onClick={() => setForm({ price: String(m.close), shares: "1000" })}>買入</button>
          )}
          <button
            className="btn btn-danger-line"
            onClick={() => (confirmRemove ? onRemove(u.id) : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
          >
            {confirmRemove ? "再按一次確認移除" : "移除"}
          </button>
        </div>
      </header>

      {form && (
        <div className="buy-form">
          <label>買入價<input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
          <label>股數<input inputMode="numeric" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} /></label>
          <button
            className="btn btn-primary"
            disabled={!(parseFloat(form.price) > 0 && parseInt(form.shares) > 0)}
            onClick={() => onBuy(u.id, parseFloat(form.price), parseInt(form.shares))}
          >確認買入，移到投資 pool</button>
          <button className="btn btn-line" onClick={() => setForm(null)}>取消</button>
        </div>
      )}

      <Ruler m={m} pool={pool} />

      <dl className="stats">
        {pool ? (
          <>
            <Stat label="持有後高點（收盤）" value={fmtP(m.refHigh)} sub={`距高點 ${pct(m.fromHigh)}`} />
            <Stat label="成本" value={fmtP(h.price)} sub={`${h.shares.toLocaleString()} 股・${short(h.date)} 買入`} />
            <Stat
              label="未實現損益"
              value={`${(m.close - h.price) * h.shares >= 0 ? "+" : "−"}${Math.abs(Math.round((m.close - h.price) * h.shares)).toLocaleString()}`}
              color={colorOf(m.close - h.price)}
              sub={pct(m.close / h.price - 1)}
            />
          </>
        ) : (
          <>
            <Stat label="一個月低點（收盤）" value={fmtP(m.monthLow)} sub={`距低點 ${pct(m.fromLow)}`} />
            <Stat label="一個月高點（收盤）" value={fmtP(m.monthHigh)} sub={`距高點 ${pct(m.fromHigh)}`} />
          </>
        )}
        <Stat
          label="近四季 EPS"
          value={epsSum ? epsSum.toFixed(2) : "—"}
          sub={u.eps ? u.eps.map((x) => x.toFixed(2)).join(" + ") : "ETF 無 EPS"}
        />
        <Stat label="本益比" value={pe ? pe.toFixed(1) + " 倍" : "—"} sub={pe ? "收盤價 ÷ 近四季 EPS" : "不適用"} />
      </dl>

      <div className="chart-block">
        <h3>收盤價　近 60 個交易日</h3>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EDF0F3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} minTickGap={32} tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} />
            <YAxis domain={["auto", "auto"]} width={58} tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={fmtP} />
            <Tooltip formatter={(val) => [fmtP(val), "收盤"]} labelFormatter={short} />
            {refs.map((r) => (
              <ReferenceLine key={r.label} y={r.v} stroke={r.color} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: `${r.label} ${fmtP(r.v)}`, position: "insideTopLeft", fontSize: 11, fill: r.color }} />
            ))}
            <Line dataKey="c" stroke={C.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-pair">
        <div className="chart-block">
          <h3>MACD（12, 26, 9）</h3>
          <p className="signal" style={{ color: mc ? (mc.type === "golden" ? C.up : C.down) : C.muted }}>{crossText(mc)}</p>
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis width={58} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(x) => x.toFixed(1)} />
              <Tooltip formatter={(val, n) => [val.toFixed(2), n]} labelFormatter={short} />
              <ReferenceLine y={0} stroke={C.line} />
              <Bar dataKey="hist" name="柱狀體" isAnimationActive={false}>
                {data.map((d, i) => <Cell key={i} fill={d.hist >= 0 ? "rgba(210,40,60,.45)" : "rgba(19,137,90,.45)"} />)}
              </Bar>
              <Line dataKey="dif" name="DIF" stroke={C.accent} dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Line dataKey="dea" name="MACD" stroke={C.amber} dot={false} strokeWidth={1.6} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="legend"><i style={{ background: C.accent }} />DIF　<i style={{ background: C.amber }} />MACD</p>
        </div>
        <div className="chart-block">
          <h3>KD（9, 3, 3）</h3>
          <p className="signal" style={{ color: kc ? (kc.type === "golden" ? C.up : C.down) : C.muted }}>{crossText(kc)}</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[0, 100]} ticks={[20, 50, 80]} width={58} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(val, n) => [val.toFixed(1), n]} labelFormatter={short} />
              <ReferenceLine y={80} stroke={C.line} strokeDasharray="3 3" />
              <ReferenceLine y={20} stroke={C.line} strokeDasharray="3 3" />
              <Line dataKey="k" name="K" stroke={C.accent} dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Line dataKey="d" name="D" stroke={C.amber} dot={false} strokeWidth={1.6} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="legend"><i style={{ background: C.accent }} />K　<i style={{ background: C.amber }} />D</p>
        </div>
      </div>
    </section>
  );
}

/* ───────── 登入 ───────── */
function Login({ onDone }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState(null);
  const submit = async () => {
    try { await api("POST", "/api/login", { token }); onDone(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="app login">
      <style>{CSS}</style>
      <div className="login-box">
        <div className="brand-dark">盯盤</div>
        <label>登入密碼
          <input type="password" value={token} autoFocus
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn btn-primary" onClick={submit} disabled={!token}>登入</button>
      </div>
    </div>
  );
}

/* ───────── 主程式 ───────── */
export default function App() {
  const [state, setState] = useState(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState("pool");
  const [sel, setSel] = useState(() => new URLSearchParams(location.search).get("sym"));
  const [toast, setToast] = useState(null);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);

  const pickDefault = (s, cur) =>
    cur && s.lists[cur] ? cur
      : Object.keys(s.lists).find((id) => s.lists[id].list === "pool") || Object.keys(s.lists)[0] || null;

  const load = async () => {
    try {
      const s = await api("GET", "/api/state");
      setState(s); setNeedLogin(false); setLoadErr(null);
      setSel((cur) => pickDefault(s, cur));
    } catch (e) {
      if (e.status === 401) setNeedLogin(true);
      else setLoadErr(e.message);
    }
  };

  // 開著時每分鐘向後端拿最新資料；切回 App 時也立即更新
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const view = useMemo(() => {
    if (!state) return {};
    const out = {};
    for (const u of state.universe) {
      const entry = state.lists[u.id];
      const bars = state.stocks[u.id]?.bars;
      if (!entry || !bars || bars.length < 2) continue;
      out[u.id] = { u, bars, ind: indicators(bars), entry, m: metrics(entry, bars, bars.length - 1, entry.holding?.high) };
    }
    return out;
  }, [state]);

  if (needLogin) return <Login onDone={load} />;
  if (!state) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", color: C.muted }}>
        {loadErr ? <>無法連線到伺服器：{loadErr}　<button onClick={load}>重試</button></> : "載入資料中…"}
      </div>
    );
  }

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { const s = await fn(); setState(s); if (okMsg) setToast(okMsg); return s; }
    catch (e) { setToast(e.message); return null; }
    finally { setBusy(false); }
  };

  const ids = (list) => Object.keys(state.lists).filter((id) => state.lists[id].list === list && view[id]);
  const poolIds = ids("pool"), watchIds = ids("watch");
  const unread = state.alerts.filter((a) => !a.read).length;
  const unreadBy = (id) => state.alerts.some((a) => a.sym === id && !a.read);
  const current = sel && view[sel] ? view[sel] : null;
  const nameOf = (id) => view[id]?.u.name || id;

  const buy = async (id, price, shares) => {
    if (await act(() => api("POST", "/api/buy", { id, price, shares }), `${nameOf(id)} 已買入，移到投資 pool`)) setTab("pool");
  };
  const sell = async (id) => {
    if (await act(() => api("POST", "/api/sell", { id }), `${nameOf(id)} 已賣出，移回觀察清單`)) setTab("watch");
  };
  const remove = async (id) => {
    const s = await act(() => api("DELETE", `/api/lists/${id}`), `${nameOf(id)} 已移除`);
    if (s) setSel(pickDefault(s, null));
  };
  const addWatch = async () => {
    const id = addId.trim().toUpperCase();
    if (!id) return;
    const s = await act(() => api("POST", "/api/watch", { id }));
    if (s) { setToast(`${s.universe.find((u) => u.id === id)?.name || id} 已加入觀察清單`); setSel(id); setTab("watch"); setAddId(""); }
  };
  const openAlert = (a) => {
    if (state.lists[a.sym]) setSel(a.sym);
    if (!a.read) act(() => api("POST", "/api/alerts/read", { key: a.key }));
  };
  const readAll = () => act(() => api("POST", "/api/alerts/read", {}));
  const turnOnPush = async () => {
    try { await enablePush(); setToast("通知已開啟"); }
    catch (e) { setToast(e.message); }
  };

  const Row = ({ id }) => {
    const v = view[id], pool = v.entry.list === "pool";
    const near = pool ? v.m.fromHigh <= -RULES.dropFromHigh : v.m.fromLow >= RULES.riseFromLow;
    return (
      <button className="row" aria-current={sel === id} onClick={() => setSel(id)}>
        <span className="r-name">
          {unreadBy(id) && <i className="dot" aria-label="有未讀通知" />}
          {v.u.name}<span className="r-sym">{id}</span>
        </span>
        <span className="r-price">{fmtP(v.m.close)}</span>
        <span className={`chip ${near ? (pool ? "chip-down" : "chip-up") : ""}`}>
          {pool ? `距高點 ${pct(v.m.fromHigh)}` : `距一個月低點 ${pct(v.m.fromLow)}`}
        </span>
        <span className="r-chg" style={{ color: colorOf(v.m.chg) }}>{pct(v.m.chg)}</span>
      </button>
    );
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="top">
        <div>
          <div className="brand">盯盤</div>
          <div className="meta">
            資料日期 {state.day || "—"}　上次更新 {state.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"}　盤中每 10 分鐘更新
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={turnOnPush}>開啟通知</button>
        <button className="btn btn-ghost" onClick={load}>重新整理</button>
      </header>

      <div className="main">
        <aside className="side">
          <div className="seg" role="tablist">
            {[["pool", "投資 pool", poolIds.length], ["watch", "觀察清單", watchIds.length], ["alerts", "通知", unread]].map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} className="seg-btn" onClick={() => setTab(k)}>
                {label}
                {n > 0 && <span className={k === "alerts" ? "badge badge-alert" : "badge"}>{n}</span>}
              </button>
            ))}
          </div>

          {tab !== "alerts" ? (
            <div className="list">
              <p className="list-rule">
                {tab === "pool"
                  ? `已買入。收盤創新高時更新高點，自高點回落 ${RULES.dropFromHigh * 100}% 時通知。`
                  : `尚未買入。自一個月低點上漲 ${RULES.riseFromLow * 100}% 時通知。`}
              </p>
              {(tab === "pool" ? poolIds : watchIds).map((id) => <Row key={id} id={id} />)}
              {(tab === "pool" ? poolIds : watchIds).length === 0 && (
                <p className="empty">
                  {tab === "pool" ? "還沒有持股。到觀察清單選一檔股票按「買入」。" : "觀察清單是空的。輸入股票代號加入。"}
                </p>
              )}
              {tab === "watch" && (
                <div className="add">
                  <input value={addId} placeholder="股票代號，例如 2330" inputMode="numeric" aria-label="股票代號"
                    onChange={(e) => setAddId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWatch()} />
                  <button className="btn btn-line" disabled={!addId.trim() || busy} onClick={addWatch}>
                    {busy ? "抓取資料中…" : "加入觀察清單"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="list">
              <div className="alerts-head">
                <span>{state.alerts.length} 則通知</span>
                {unread > 0 && <button className="link" onClick={readAll}>全部標為已讀</button>}
              </div>
              {state.alerts.length === 0 && <p className="empty">目前沒有通知。觸發條件時會出現在這裡，也會推播到 iPad。</p>}
              {state.alerts.map((a) => (
                <button key={a.key} className={`alert ${a.read ? "" : "unread"}`} onClick={() => openAlert(a)}>
                  <span className="a-bar" style={{ background: KIND[a.kind]?.color || C.muted }} />
                  <span className="a-top">
                    <b style={{ color: KIND[a.kind]?.color || C.muted }}>{KIND[a.kind]?.label || a.kind}</b>
                    <span className="a-date">{short(a.date)}</span>
                  </span>
                  <span className="a-name">{a.name} {a.sym}</span>
                  <span className="a-text">{a.text}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="pane">
          {current ? (
            <Detail v={current} onBuy={buy} onSell={sell} onRemove={remove} />
          ) : (
            <p className="empty big">到觀察清單輸入股票代號，開始追蹤高低點、本益比和技術指標。</p>
          )}
        </main>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap');
.app{font-family:"IBM Plex Sans","Noto Sans TC",system-ui,sans-serif;background:${C.bg};color:${C.ink};min-height:100vh;font-variant-numeric:tabular-nums;font-size:15px;line-height:1.5}
.app *{box-sizing:border-box}
:focus-visible{outline:3px solid #6C8CFF;outline-offset:2px}
.top{display:flex;align-items:center;gap:14px;padding:12px 24px;background:${C.ink};color:#fff;flex-wrap:wrap}
.brand{font-size:21px;font-weight:700;letter-spacing:.06em}
.meta{font-size:12.5px;color:#AEB8C4}
.sim{font-size:12px;padding:2px 8px;border:1px solid #5B6878;border-radius:4px;color:#D5DCE4;align-self:flex-start;margin-top:4px}
.spacer{flex:1}
.btn{font:inherit;font-size:14px;border-radius:8px;padding:9px 14px;border:1px solid transparent;cursor:pointer;font-weight:500;white-space:nowrap}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:${C.accent};color:#fff}
.btn-primary:hover:not(:disabled){background:#22398A}
.btn-ghost{background:transparent;color:#D5DCE4;border-color:#4A5768}
.btn-line{background:#fff;color:${C.ink};border-color:#C9D1DA}
.btn-danger-line{background:#fff;color:#B42318;border-color:#E6C7C3}
.main{display:grid;grid-template-columns:360px 1fr;min-height:calc(100vh - 66px)}
.side{background:${C.side};border-right:1px solid ${C.line};display:flex;flex-direction:column;min-width:0}
.seg{display:flex;gap:4px;margin:14px 14px 6px;padding:4px;background:#E2E7EC;border-radius:10px}
.seg-btn{flex:1;font:inherit;font-size:14px;border:0;background:transparent;border-radius:7px;padding:8px 4px;cursor:pointer;color:${C.muted};display:flex;align-items:center;justify-content:center;gap:6px}
.seg-btn[aria-selected=true]{background:#fff;color:${C.ink};font-weight:600;box-shadow:0 1px 2px rgba(24,33,44,.12)}
.badge{font-size:11.5px;min-width:20px;padding:0 6px;border-radius:10px;background:#D3DAE1;color:${C.ink};line-height:18px}
.badge-alert{background:${C.up};color:#fff}
.list{overflow:auto;flex:1}
.list-rule{font-size:12.5px;color:${C.muted};margin:6px 16px 8px}
.row{display:grid;grid-template-columns:1fr auto;gap:4px 12px;width:100%;text-align:left;padding:13px 16px;border:0;border-top:1px solid #E1E6EB;background:transparent;font:inherit;color:inherit;cursor:pointer}
.row:hover{background:#EEF2F5}
.row[aria-current=true]{background:#fff;box-shadow:inset 4px 0 0 ${C.accent}}
.r-name{font-weight:600;display:flex;align-items:center;gap:6px}
.r-sym{font-weight:400;color:${C.muted};font-size:13px;margin-left:4px}
.r-price{font-weight:600;text-align:right;font-size:16px}
.r-chg{text-align:right;font-size:13px}
.chip{font-size:12px;color:${C.muted};justify-self:start}
.chip-down{color:#fff;background:${C.down};padding:1px 7px;border-radius:4px}
.chip-up{color:#fff;background:${C.up};padding:1px 7px;border-radius:4px}
.dot{width:7px;height:7px;border-radius:50%;background:${C.up};display:inline-block}
.add{display:flex;gap:8px;padding:14px 16px;border-top:1px solid #E1E6EB}
.add select{flex:1;font:inherit;font-size:14px;padding:8px;border:1px solid #C9D1DA;border-radius:8px;background:#fff;min-width:0}
.empty{color:${C.muted};font-size:14px;padding:16px}
.empty.big{padding:48px}
.alerts-head{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;font-size:13px;color:${C.muted}}
.link{font:inherit;font-size:13px;background:none;border:0;color:${C.accent};cursor:pointer;padding:0}
.alert{position:relative;display:grid;gap:2px;width:100%;text-align:left;padding:12px 16px 12px 22px;border:0;border-top:1px solid #E1E6EB;background:transparent;font:inherit;color:inherit;cursor:pointer}
.alert:hover{background:#EEF2F5}
.alert.unread{background:#fff}
.alert:not(.unread){opacity:.7}
.a-bar{position:absolute;left:0;top:0;bottom:0;width:4px}
.a-top{display:flex;justify-content:space-between;font-size:13.5px}
.a-date{color:${C.muted};font-size:12.5px}
.a-name{font-weight:600;font-size:14px}
.a-text{font-size:13px;color:${C.muted}}
.pane{min-width:0;padding:24px 32px 40px}
.detail{max-width:1040px}
.d-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.d-head h2{font-size:22px;margin:0;font-weight:700}
.sym{font-weight:400;color:${C.muted};font-size:16px;margin-left:6px}
.price-row{display:flex;align-items:baseline;gap:12px;margin-top:2px;flex-wrap:wrap}
.price{font-size:44px;font-weight:600;letter-spacing:-.01em;line-height:1.1}
.chg{font-size:17px;font-weight:500}
.in-list{font-size:12.5px;color:${C.muted};border:1px solid ${C.line};border-radius:4px;padding:1px 7px}
.d-actions{display:flex;gap:8px;flex-wrap:wrap}
.buy-form{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;background:#fff;border:1px solid ${C.line};border-radius:10px;padding:14px 16px;margin-top:16px}
.buy-form label{display:grid;gap:4px;font-size:12.5px;color:${C.muted}}
.buy-form input{font:inherit;font-size:16px;padding:8px 10px;border:1px solid #C9D1DA;border-radius:8px;width:140px;color:${C.ink}}
.ruler{background:#fff;border:1px solid ${C.line};border-radius:12px;padding:44px 28px 14px;margin-top:20px}
.ruler-track{position:relative;height:10px;background:#E6EAEE;border-radius:5px;margin:0 6px 40px}
.ruler-zone{position:absolute;top:0;bottom:0;border-radius:5px}
.ruler-mark{position:absolute;top:0;height:10px;transform:translateX(-50%)}
.ruler-mark .tick{position:absolute;left:50%;width:2px;height:18px;top:-4px;transform:translateX(-50%)}
.ruler-mark .lbl{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;text-align:center;display:grid}
.ruler-mark .lbl b{font-weight:600;font-size:13px}
.ruler-mark.top .lbl{bottom:18px}
.ruler-mark.bottom .lbl{top:18px}
.ruler-pin{position:absolute;top:50%;width:18px;height:18px;border-radius:50%;background:#fff;border:4px solid;transform:translate(-50%,-50%);z-index:2}
.ruler-pin span{position:absolute;top:22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12.5px;font-weight:600;background:${C.ink};color:#fff;padding:1px 7px;border-radius:4px}
.ruler-note{margin:0;font-size:13px;color:${C.muted}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:${C.line};border:1px solid ${C.line};border-radius:12px;overflow:hidden;margin:16px 0 0}
.stat{background:#fff;padding:12px 16px;margin:0}
.stat dt{font-size:12.5px;color:${C.muted}}
.stat dd{margin:2px 0 0;font-size:20px;font-weight:600}
.stat dd.stat-sub{font-size:12.5px;font-weight:400;color:${C.muted}}
.chart-block{background:#fff;border:1px solid ${C.line};border-radius:12px;padding:14px 16px 10px;margin-top:16px;min-width:0}
.chart-block h3{margin:0 0 6px;font-size:14px;font-weight:600}
.chart-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.chart-pair .chart-block{margin-top:16px}
.signal{margin:-2px 0 6px;font-size:13px;font-weight:500}
.legend{margin:4px 0 0;font-size:12px;color:${C.muted}}
.legend i{display:inline-block;width:10px;height:3px;vertical-align:middle;margin-right:5px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:${C.ink};color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;box-shadow:0 6px 20px rgba(24,33,44,.25);animation:rise .25s ease-out}
@keyframes rise{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.toast{animation:none}}
.add input{flex:1;font:inherit;font-size:15px;padding:8px 10px;border:1px solid #C9D1DA;border-radius:8px;background:#fff;min-width:0}
.login{display:grid;place-items:center}
.login-box{background:#fff;border:1px solid ${C.line};border-radius:14px;padding:28px;display:grid;gap:14px;width:min(360px,90vw)}
.brand-dark{font-size:24px;font-weight:700;letter-spacing:.06em}
.login-box label{display:grid;gap:6px;font-size:13px;color:${C.muted}}
.login-box input{font:inherit;font-size:16px;padding:10px 12px;border:1px solid #C9D1DA;border-radius:8px}
.err{color:#B42318;margin:0;font-size:13px}
.top{padding-top:max(12px, env(safe-area-inset-top))}
@media (max-width:900px){
  .main{grid-template-columns:1fr}
  .side{border-right:0;border-bottom:1px solid ${C.line};max-height:52vh}
  .pane{padding:18px}
  .chart-pair{grid-template-columns:1fr}
  .price{font-size:36px}
}
`;
