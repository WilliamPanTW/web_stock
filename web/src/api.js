// 呼叫後端 API
export async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || `伺服器錯誤 ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// 開啟推播：必須由按鈕點擊觸發
export async function enablePush() {
  if (isIOS() && !isStandalone())
    throw new Error("iPad 要先按分享 →「加入主畫面」，再從主畫面開啟盯盤，才能開啟通知");
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error("這個瀏覽器不支援推播通知");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("通知權限沒有開啟，請到 iPad 設定 → 通知 → 盯盤 開啟");
  const { key } = await api("GET", "/api/push/key");
  if (!key) throw new Error("伺服器尚未設定推播金鑰");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) }));
  await api("POST", "/api/push/subscribe", sub.toJSON());
}
