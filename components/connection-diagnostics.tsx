import type { RealtimeHealth } from "@/lib/realtime-health-client";

export type ReceiveDiagnostic = { source: "client" | "server-preview" | "server-stored" | "poll"; renderMs: number };
export type SendDiagnostic = { id: string; relayMs: number | null; saveMs: number | null; relayFailed: boolean };

export function ConnectionDiagnostics({ health, received, sent, onCheck, onReconnect }: {
  health: RealtimeHealth;
  received: ReceiveDiagnostic | null;
  sent: SendDiagnostic | null;
  onCheck: () => void;
  onReconnect: () => void;
}) {
  const ms = (value: number | null | undefined) => value == null ? "尚無紀錄" : `${Math.round(value)} ms`;
  const source = { client: "裝置即時直送", "server-preview": "伺服器推送（儲存前）", "server-stored": "伺服器推送（儲存後）", poll: "輪詢補回" };
  const reason = {
    disconnected: "尚未完成即時訂閱",
    "publish-failed": "探測要求失敗或逾時",
    "receive-timeout": "伺服器已推送，但本機未收到"
  };
  return (
    <details className="shrink-0 border-b border-line bg-white px-4 text-xs text-slate-600">
      <summary className="mx-auto max-w-5xl cursor-pointer py-1.5">連線檢查</summary>
      <div className="mx-auto max-w-5xl space-y-2 pb-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 [&_dd]:break-words">
          <dt>本機版本</dt><dd>{process.env.NEXT_PUBLIC_APP_VERSION}</dd>
          <dt>接收測試</dt><dd>{health.state === "healthy" ? "已驗證收到推送" : health.state === "checking" ? "檢查中" : "即時接收異常"}</dd>
          {health.reason ? <><dt>原因</dt><dd>{reason[health.reason]}</dd></> : null}
          <dt>本機推送來回</dt><dd>{ms(health.roundTripMs)}</dd>
          <dt>最近收件方式</dt><dd>{received ? source[received.source] : "尚無新訊息"}</dd>
          <dt>收件至畫面更新</dt><dd>{ms(received?.renderMs)}</dd>
          <dt>最近送出轉送</dt><dd>{sent?.relayFailed ? "失敗或逾時" : ms(sent?.relayMs)}</dd>
          <dt>最近送出儲存</dt><dd>{ms(sent?.saveMs)}</dd>
        </dl>
        <div className="flex gap-4">
          <button type="button" className="underline" onClick={onCheck}>測試接收</button>
          <button type="button" className="underline" onClick={onReconnect}>重建連線</button>
        </div>
      </div>
    </details>
  );
}
