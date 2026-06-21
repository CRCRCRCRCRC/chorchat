# chorchat

`chorchat` 是一個只有兩種固定身分的即時聊天網站：`陳` 與 `左`。

## 功能

- 身分選擇頁：以 `陳` 或 `左` 進入聊天室
- 自己訊息靠右，對方訊息靠左
- 純文字訊息、圖片訊息、文字加圖片訊息
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
4. 建立 Pusher Channels app，取得 app id、key、secret、cluster。
5. 在 Vercel 匯入 GitHub repo。
6. 到 Vercel Project Settings 加入 `.env.example` 中的環境變數。
7. 務必設定 `CHORCHAT_AUTH_PASSWORD`，避免公開網址被其他人直接進聊天室或呼叫 API。
8. 對 production database 執行 migration：

```bash
npm run db:deploy
```

Vercel build command 使用：

```bash
npm run build
```

不要在 production 使用 `npm run db:push`，production database 應使用 migration。

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
- `reply_to_message_id`

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
