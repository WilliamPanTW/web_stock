import webpush from "web-push";
import { KIND_LABEL } from "./logic.js";

const ready = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (ready) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} else {
  console.warn("[push] 尚未設定 VAPID 金鑰，推播停用");
}

export async function notify(db, a) {
  if (!ready || db.subs.length === 0) return;
  const payload = JSON.stringify({
    title: `${a.name} ${a.sym}｜${KIND_LABEL[a.kind]}`,
    body: a.text,
    tag: a.key,
    url: `/?sym=${a.sym}`,
  });
  const keep = [];
  for (const s of db.subs) {
    try {
      await webpush.sendNotification(s, payload);
      keep.push(s);
    } catch (e) {
      // 404/410 代表裝置已取消訂閱，移除
      if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(s);
      console.error("[push] 失敗", e.statusCode, e.body);
    }
  }
  db.subs = keep;
}
