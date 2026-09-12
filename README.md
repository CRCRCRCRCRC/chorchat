# chorchat

`chorchat` 是一個只有兩種固定身分的即時聊天網站：`陳` 與 `左`。

## 功能

- 身分選擇頁：以 `陳` 或 `左` 進入聊天室
- 自己訊息靠右，對方訊息靠左
- 純文字與多張圖片訊息，文字和圖片會分開傳送
- 訊息時間顯示
- 圖片固定高度並使用 `object-fit: contain`
- 點擊圖片開啟暗背景原比例預覽
- 可回覆任一訊息，引用區塊可定位並高亮原訊息
- 只能編輯自己 15 分鐘內送出的訊息
- 編輯後標示「已編輯」
- 只能收回自己的訊息，收回後保留位置並隱藏文字與圖片
- PostgreSQL 資料庫儲存訊息
- Pusher Channels 即時同步，未設定 Pusher 時本機用短輪詢 fallback
- 語音通話訊號會同時走 Pusher 與 PostgreSQL 輪詢備援，避免 websocket event 漏接
- 背景分頁收到新訊息時顯示未讀數、favicon 紅點並播放短通知音效
- 語音通話支援來電鈴聲、未接逾時、斷線重連狀態與通話時間
- 可搜尋文字訊息並定位原文
- 媒體資料庫集中顯示聊天圖片與連結
- 訊息支援表情回應與置頂
- 顯示對方在線與最後上線時間
- 可依身分設定新訊息是否自動滑到底
- 新訊息先更新畫面與未讀提示，再播放通知音；開啟自動捲動時立即定位新訊息，背景分頁不等待畫面繪製

## 技術

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma
- Neon/PostgreSQL
- Vercel Blob
- Pusher Channels

## 本機開發

```bash
npm install
cp .env.example .env
```

填入 `.env`：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
# 選填；migration 會優先使用 direct URL。Neon Vercel Integration 通常會提供 DATABASE_URL_UNPOOLED。
DIRECT_URL="postgresql://USER:PASSWORD@DIRECT_HOST:PORT/DATABASE?sslmode=require"
CHORCHAT_AUTH_USER="chorchat"
CHORCHAT_AUTH_PASSWORD="change-this-password"
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxxxxxxxxxxxxxxxx"
PUSHER_APP_ID="0000000"
PUSHER_SECRET="xxxxxxxxxxxxxxxxxxxx"
PUSHER_CLUSTER="ap3"
NEXT_PUBLIC_PUSHER_KEY="xxxxxxxxxxxxxxxxxxxx"
NEXT_PUBLIC_PUSHER_CLUSTER="ap3"
```

初始化資料庫：

```bash
npm run db:deploy
```

如果是本機快速同步 schema，也可用：

```bash
npm run db:push
```

啟動開發伺服器：

```bash
npm run dev
```

開啟 `http://localhost:3000`。

## 部署到 Vercel

1. 將專案推到 GitHub。
2. 建立 Neon PostgreSQL database，取得 `DATABASE_URL`。
3. 在 Vercel 建立 Blob store，取得 `BLOB_READ_WRITE_TOKEN`。
4. 建立 Pusher Channels app，取得 app id、key、secret、cluster。App Settings 的 `Enable client events` 可開啟以加速瀏覽器直接傳送；沒有開啟時也會透過伺服器即時轉送。
5. 在 Vercel 匯入 GitHub repo。
6. 到 Vercel Project Settings 加入 `.env.example` 中的環境變數。
7. 務必設定 `CHORCHAT_AUTH_PASSWORD`，避免公開網址被其他人直接進聊天室或呼叫 API。
8. 專案的 `vercel.json` 已將 Vercel Build Command 設為：

```bash
npm run vercel-build
```

此指令會在每次部署時先使用 Neon direct connection 執行 production migration，再建立 Next.js 正式版本。它會優先使用 `DIRECT_URL` 或 `DATABASE_URL_UNPOOLED`；若兩者都沒有，會自動從 Neon pooled hostname 移除 `-pooler`，不需要額外設定。部署腳本會停用 Prisma advisory lock，避免 Neon 中殘留的 migration lock 阻擋 Vercel 建置。若要手動執行 migration：

```bash
npm run db:deploy
```

不要在 production 使用 `npm run db:push`，production database 應使用 migration。

## 即時傳送與延遲排查

- 多台裝置可以選擇相同身分。即時訊息以本分頁實際送出的訊息 ID 排除回音，不會因為身分相同就忽略另一台裝置的訊息。同身分同步沿用自動捲動設定，不增加對方未讀提醒，也不算對方已讀。
- 歷史訊息仍在載入時，已收到的新訊息仍會立即顯示，不會被載入畫面遮住。
- 送出訊息時，同時呼叫 `/api/realtime` 即時轉送與 `/api/messages` 儲存；即使 Neon 正在啟動，接收端也不需要等資料庫完成才顯示訊息和未讀提醒。預覽尚未儲存時不開放編輯、回覆等操作。
- `/api/realtime` 的 GET 僅提供公開 key 和 cluster。前後端共用伺服器的 cluster 設定，避免兩個 cluster 環境變數不一致而訂閱錯誤的節點；secret 不會傳給瀏覽器。
- 必須成功訂閱聊天室才算即時連線就緒。授權失敗會顯示重連提示，並以 1.5 秒間隔補抓訊息，不會誤用正常連線的 15 秒檢查間隔。這些間隔不含 API 回應時間。
- 同一則訊息的預覽、儲存結果和補抓資料會去重。長中文或多張圖片超過 Pusher 單事件 10KB 限制時，伺服器會分段傳送並由瀏覽器組回。
- `vercel.json` 將 Functions 區域設為新加坡 `sin1`，對應目前 Neon 的新加坡區域。若日後移動資料庫，請一起調整 Functions 區域。[Vercel 區域文件](https://vercel.com/docs/functions/configuring-functions/region)。Build log 的建置機器位置與 Functions 執行位置是兩回事。
- Chrome/Edge 開發者工具的 Network 中，`/api/realtime` 的 `Server-Timing: publish` 是伺服器向 Pusher 發布的時間，`/api/messages` 的 `Server-Timing: persist` 是儲存處理時間；兩者都不是另一支手機實際收到的時間。Pusher 的 Client Events 設定與訂閱事件請見 [Pusher 官方文件](https://pusher.com/docs/channels/using_channels/events/)。

## 回歸測試

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

瀏覽器測試使用兩個獨立身分、桌機和手機視窗，模擬 Pusher 與資料庫，包含關閉 Client Events、儲存延遲 10 秒、訂閱失敗重連、即時未讀提醒和重複事件。測試不會存取正式聊天資料，也不代表正式環境的網路延遲。正式環境仍需兩支手機實測。

Windows 已安裝 Edge 時，可省略 Chromium 下載，改用：

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:e2e
```

## 資料表

Prisma schema 位於 `prisma/schema.prisma`。

核心資料表為 `messages`：

- `id`
- `sender`：`CHEN` 或 `ZUO`
- `text`
- `image_url`
- `image_urls`
- `created_at`
- `updated_at`
- `edited_at`
- `recalled_at`
- `read_at`
- `pinned_at`
- `pinned_by`
- `reply_to_message_id`

訊息表情使用 `message_reactions`，在線狀態使用 `presence`。

語音通話訊號使用 `call_signals`：

- `id`
- `type`
- `call_id`
- `from`
- `to`
- `payload`
- `created_at`

## 行為規則

- 編輯限制由 API server 端檢查，超過 15 分鐘不可編輯。
- 已收回訊息不可再編輯。
- 已收回訊息不再顯示文字與圖片。
- 回覆引用若指向已收回訊息，只顯示「已收回的訊息」。
- 圖片上傳走 `/api/upload`，檔案儲存在 Vercel Blob。
