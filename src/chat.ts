// チャットの画面表示用の型・ヘルパー。本文の型は api.ts の MessageBody を唯一の出所にする。
// サーバー(src/*)・管理画面(admin-ui/src/*)・アプリ(tsudoi-app/src/*) が import して共有する。
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存の型を書かない（純粋な型・関数のみ）。
import type { MessageBody } from './api';

// クライアントの一覧描画で使うメッセージ1件の表現。
// seq をキーに履歴取得/新着マージ・重複排除を行い、id は描画の keyExtractor に使う。
export interface ChatMessage {
  id: string;
  seq?: number; // サーバー採番。履歴取得/新着マージのカーソルに使う。
  authorId: string;
  authorName: string;
  // 送信者のアバター画像 id（user.avatarImageId）。未設定なら null。
  // authorName と同じく DO が配信・履歴の直前に authorId から解決して載せる（キーだけ）。
  avatarImageId: string | null;
  body: MessageBody;
  sentAt: number; // epoch ms
  read?: boolean; // outgoing only
}

// body から表示用テキストを取り出す。text 以外（image 等）は空文字（描画側で別表示に切り替える）。
export const bodyText = (b: MessageBody): string => (b.type === 'text' ? b.text : '');
