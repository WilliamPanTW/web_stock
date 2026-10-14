# 盯盤：串接真實資料

```
stock-app/
├── server/            後端：抓行情、排程、判斷通知、推播
│   ├── src/sources.js   富果（股價）、FinMind（EPS）
│   ├── src/logic.js     高低點、MACD、KD、通知判斷
│   ├── src/jobs.js      盤中每 10 分鐘、收盤後、每週 EPS
│   ├── src/push.js      Web Push
│   ├── src/store.js     資料存在 data/db.json
│   └── src/index.js     API + 排程 + 提供前端網頁
└── web/               前端 PWA（由雛形改成向後端拿資料）
    ├── src/App.jsx
    ├── src/api.js       呼叫 API、開啟推播
    └── public/          manifest、service worker、圖示
```

## 1. 申請金鑰

| 用途 | 去哪裡申請 | 填到 `.env` |
|---|---|---|
| 股價（即時、日 K、名稱） | 富果 developer.fugle.tw，登入後建立 API 金鑰 | `FUGLE_API_KEY` |
| 近四季 EPS | FinMind finmindtrade.com，註冊並驗證信箱後取得 token | `FINMIND_TOKEN` |
| 推播 | 在 server 資料夾執行 `npm run vapid` | `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` |
| App 登入密碼 | 自己設一組長字串 | `APP_TOKEN` |

富果與 FinMind 都有免費方案，速率限制依方案而定。這個 App 每 10 分鐘對每檔股票打 1 次，追蹤 20 檔以內通常不會超過免費額度。

## 2. 本機跑起來

需要 Node.js 20.6 以上。

```bash
cd server
npm install
cp .env.example .env      # 填入上面的金鑰
npm run dev               # 後端跑在 http://localhost:3000

# 另開一個終端機
cd web
npm install
npm run dev               # 前端跑在 http://localhost:5173，/api 會自動轉到後端
```

打開 http://localhost:5173，輸入 `APP_TOKEN` 登入，到觀察清單輸入代號（例如 2330）加入。

**不用等排程就能測試**：登入後在瀏覽器 Console 執行

```js
fetch("/api/admin/run/tick", { method: "POST" })   // 盤中更新
fetch("/api/admin/run/close", { method: "POST" })  // 收盤判斷
```

## 3. 排程（台北時間，週一到週五）

| 時間 | 工作 | 內容 |
|---|---|---|
| 09:00–13:30 每 10 分鐘 | tick | 抓即時價，更新今天的 K 棒；盤中跌破高點 −10% 或站上低點 +15% 就先通知 |
| 13:45 | close | 補齊近期日 K，用收盤價更新持有後高點，判斷門檻與 MACD/KD 交叉 |
| 週一 07:00 | eps | 更新近四季 EPS |

國定假日不用另外設定：報價日期不是今天就自動略過。同一天、同一檔、同一種通知只發一次。

## 4. 上線（iPad 推播一定要 HTTPS）

**先在自己電腦測 iPad**：用 Cloudflare Tunnel 拿到暫時的 HTTPS 網址

```bash
cd web && npm run build          # 產生 web/dist，後端會直接提供這個網頁
cd ../server && npm start
cloudflared tunnel --url http://localhost:3000
```

**正式上線**：一台小 VPS（或公司內可對外的機器）＋ Caddy 自動 HTTPS

```bash
# VPS 上
git clone <你的 repo> && cd stock-app
cd web && npm ci && npm run build
cd ../server && npm ci && cp .env.example .env   # 填金鑰
npx pm2 start "npm start" --name dingpan         # 背景常駐、當機自動重啟

# /etc/caddy/Caddyfile
dingpan.你的網域.com {
  reverse_proxy localhost:3000
}
```

資料存在 `server/data/db.json`，記得定期備份這個檔案。

## 5. 在 iPad 上安裝

1. 用 Safari 打開網址，登入。
2. 分享按鈕 →「加入主畫面」。
3. 從主畫面的「盯盤」圖示開啟（一定要從這裡開，Safari 分頁裡收不到推播）。
4. 再登入一次（主畫面 App 與 Safari 的登入狀態是分開的）。
5. 按右上角「開啟通知」→ 允許。

需要 iPadOS 16.4 以上。

## 6. 常見問題

- **加入股票顯示「查不到足夠的歷史股價」**：代號錯誤，或富果金鑰沒填。看後端終端機的錯誤訊息。
- **本益比顯示「—」**：ETF 沒有 EPS，或 FinMind 查不到；確認 `FINMIND_TOKEN`。
- **收不到推播**：確認是從主畫面開啟、iPad 設定 → 通知 → 盯盤 已開啟、後端有設 VAPID 金鑰。
- **後端出現 429**：超過富果速率限制，減少追蹤檔數或升級方案。
- **要改門檻**：同時改 `server/src/logic.js` 與 `web/src/App.jsx` 最上面的 `RULES`。
