// プッシュ通知の data から遷移先アプリ内パスを求める純粋関数（docs/web-push-decisions.md）。
// サーバー・アプリで「同じ 1 つの対応表」を共有するため shared へ置く（validation.ts と同じ思想）。
//  - アプリ（tsudoi-app/src/lib/notifications.ts）… 通知タップ時の遷移（ネイティブ）と、
//    Service Worker から受け取った URL での遷移（web）に使う。
//  - サーバー（tsudoi-server/src/push.ts）… Web Push ペイロードに載せる遷移先 URL の算出に使う。
// ここに通知種別→遷移先の対応を 1 箇所へ集約し、二重管理（アプリとサーバーで別実装）を避ける。
//
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存を書かない（純粋関数）。
// PushData 型は @shared/api にある（型と関数で出所を分けるのは、api.ts が純粋な型のみを持つ方針のため）。
import type { PushData } from './api';

// data から遷移すべきアプリ内パスを決める。必ず type で振り分け、未知 type・data 欠落・
// 必須項目欠落は null（＝遷移しない）に倒す（前方互換・防御的）。
// 返り値はアプリ内パス（例: /room/123）。web ではこれにオリジンを付けて絶対 URL にしてから
// ペイロードに載せる（Service Worker の clients.openWindow は絶対 URL を要求するため）。
export function pushDataToPath(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<PushData>;
  switch (d.type) {
    case 'chat_message':
      // 新着チャット通知 → その部屋へ。roomId が無ければ遷移しない。
      // 返信通知（docs/reply-decisions.md 4.4）は threadSeq を持つ。その場合はスレッド画面へ直接遷移する
      //（起点 seq＝返信メッセージ seq。サーバーがそこからルートを辿って全件返す）。
      if (!d.roomId) return null;
      return d.threadSeq != null ? `/room/${d.roomId}/thread/${d.threadSeq}` : `/room/${d.roomId}`;
    case 'sns':
      // SNS 通知 → 相手のプロフィールへ。userId が無ければ遷移しない。
      return d.userId ? `/user/${d.userId}` : null;
    default:
      return null;
  }
}
