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
- 未讀分隔線標示這次進入聊天室後的新訊息，可一鍵查看第一則，仍保留進站自動捲到最底的行為
- 永久通話紀錄：撥出、來電、未接、拒接、取消、連線中斷與接通時長；可點擊回撥
- 圖片預覽支援原檔下載、整組 ZIP 下載；照片庫可勾選多張批次儲存
- 桌機側欄與手機精簡工具列；連線檢查收在「更多選項」中

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

此次新增的 `20261007000000_add_call_records` migration 只建立 `call_records` 資料表與索引，不刪除既有訊息。不需要新增環境變數。推送後由 Vercel 原有的 `vercel-build` 執行 migration；舊版沒有儲存完整通話紀錄，因此只能記錄更新後的新通話。

## 未讀、通話與下載

- 進站時依 `read_at` 建立未讀分隔線，這次停留期間會保留定位，即使訊息隨後被標記為已讀，也不會突然跳動或消失。同身分裝置之間的同步不算對方未讀。
- 通話紀錄與訊號分開儲存，清理一小時前的訊號不會刪除通話紀錄。清單載入最近 100 筆紀錄，舊紀錄仍保留在資料庫。
- 通話時長從 WebRTC 真正接通開始，不包含等待接聽的時間。通話中每 20 秒送出心跳；無人接聽 30 秒、連線建立逾時或長時間沒有心跳，會在下次同步紀錄時結束該筆通話。
- 圖片放大後可下載單張原檔，或下載整組 ZIP。在「照片與連結」點選「選取照片」，即可跨訊息勾選下載。每批最多 100 張、原圖合計最多 100MB，超過請分批處理。
- ZIP 在瀏覽器產生，最多同時下載三張，不重新壓縮圖片；任何一張失敗都會顯示錯誤，不提供不完整 ZIP。打包套件只在批次下載時載入。下載可取消，關閉視窗也會中止。
- Safari 若未自動開始下載，點選「再次下載」；iPad 可從下載項目將圖片或 ZIP 儲存到「檔案」，解壓縮後再儲存到「照片」。網站不會未經操作直接寫入系統相簿。
- 語音通話沿用 WebRTC 與 STUN，未加入 TURN 服務；某些嚴格 NAT 或公司網路仍可能無法接通，通話紀錄會標示連線中斷。

## 即時傳送與延遲排查

- 多台裝置可以選擇相同身分。即時訊息以本分頁實際送出的訊息 ID 排除回音，不會因為身分相同就忽略另一台裝置的訊息。同身分同步沿用自動捲動設定，不增加對方未讀提醒，也不算對方已讀。
- 歷史訊息仍在載入時，已收到的新訊息仍會立即顯示，不會被載入畫面遮住。
- 送出訊息時，同時呼叫 `/api/realtime` 即時轉送與 `/api/messages` 儲存；即使 Neon 正在啟動，接收端也不需要等資料庫完成才顯示訊息和未讀提醒。預覽尚未儲存時不開放編輯、回覆等操作。
- `/api/realtime` 的 GET 僅提供公開 key 和 cluster。前後端共用伺服器的 cluster 設定，避免兩個 cluster 環境變數不一致而訂閱錯誤的節點；secret 不會傳給瀏覽器。
- 即時連線必須成功訂閱，且本機實際收到 `/api/realtime/probe` 發送的隨機測試事件才算就緒。前景每 20 秒複查，回到分頁或輪詢發現漏接訊息時也會檢查；背景不發出探測。探測不存取 Neon。
- 伺服器確認推送成功後，本機 1.5 秒仍未收到測試事件便重建 WebSocket，重建至少間隔 10 秒。探測 API 本身失敗時只啟用備援，不反覆切斷連線。異常時以 1.5 秒間隔補抓訊息，正常時每 15 秒核對資料；輪詢間隔不含 API 回應時間，不能保證故障期間仍是秒內送達。
- 聊天室的「連線檢查」會顯示本機版本、接收測試、最近收件來源，以及本機轉送、儲存和畫面更新耗時。若 A 到 B 慢、反向正常，請傳送一則純文字後截下兩台的檢查資訊。收件來源區分裝置直送、儲存前推送、儲存後推送和輪詢補回；`輪詢補回` 表示補抓資料先抵達，可能是即時漏接或推送較慢。版本不同則先更新舊分頁。本機推送來回時間使用單一裝置的計時器，不受兩台時鐘不同步影響，但不是 A 到 B 的送達時間。
- 同一則訊息的預覽、儲存結果和補抓資料會去重。長中文或多張圖片超過 Pusher 單事件 10KB 限制時，伺服器會分段傳送並由瀏覽器組回。
- `vercel.json` 將 Functions 區域設為新加坡 `sin1`，對應目前 Neon 的新加坡區域。若日後移動資料庫，請一起調整 Functions 區域。[Vercel 區域文件](https://vercel.com/docs/functions/configuring-functions/region)。Build log 的建置機器位置與 Functions 執行位置是兩回事。
- Chrome/Edge 開發者工具的 Network 中，`/api/realtime` 的 `Server-Timing: publish` 是伺服器向 Pusher 發布的時間，`/api/messages` 的 `Server-Timing: persist` 是儲存處理時間；兩者都不是另一支手機實際收到的時間。Pusher 的 Client Events 設定與訂閱事件請見 [Pusher 官方文件](https://pusher.com/docs/channels/using_channels/events/)。

## 回歸測試

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

瀏覽器測試使用兩個獨立分頁、桌機和手機視窗，模擬 Pusher 與資料庫，包含同身分登入、關閉 Client Events、儲存延遲 10 秒、訂閱失敗與靜默漏接重連、即時未讀提醒和重複事件。另包含未讀分隔線、通話紀錄與回撥、圖片原檔與 ZIP 下載，以及桌機、平板、窄手機版排版。Chromium 使用假的麥克風音源測試真正的本機 WebRTC 連線。測試不會存取正式聊天資料，也不代表正式環境的網路延遲或跨網路通話品質。正式環境仍需兩台裝置實測。

Windows 已安裝 Edge 時，可省略 Chromium 下載，改用：

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:e2e
```

WebKit 引擎回歸測試（不能取代實機 iPad Safari）：

```powershell
npx playwright install webkit
$env:PLAYWRIGHT_BROWSER = "webkit"
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

永久通話紀錄使用 `call_records`：`id`、`caller`、`callee`、`status`、`started_at`、`answered_at`、`ended_at`、`ended_by`、`last_activity_at` 與 `updated_at`。`/api/call` 在交易與列鎖保護下更新狀態，已結束的紀錄不會被延遲訊號重新開啟；`/api/calls` 取得紀錄並結束逾時通話。

## 行為規則

- 編輯限制由 API server 端檢查，超過 15 分鐘不可編輯。
- 已收回訊息不可再編輯。
- 已收回訊息不再顯示文字與圖片。
- 回覆引用若指向已收回訊息，只顯示「已收回的訊息」。
- 圖片上傳走 `/api/upload`，檔案儲存在 Vercel Blob。
