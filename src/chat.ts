// チャットの画面表示用の型・ヘルパー。本文の型は api.ts の MessageBody を唯一の出所にする。
// サーバー(src/*)・管理画面(admin-ui/src/*)・アプリ(tsudoi-app/src/*) が import して共有する。
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存の型を書かない（純粋な型・関数のみ）。
import type { MentionRef, MessageBody, RoomListItem } from './api';
import { MENTION_TOKEN_RE } from './validation';

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
}

// body から表示用テキストを取り出す。text 以外（image 等）は空文字（描画側で別表示に切り替える）。
// メンショントークン <@userId> は生のまま出さず、表示名解決情報 refs があれば @名前 へ、無ければ
// トークンを取り除いて素の文字列にする（プレビュー・SNS 等、ハイライト描画をしない場所で使う）。
// ハイライト表示（色付き）が要る場所は splitMentionSegments を使う。
export const bodyText = (b: MessageBody, refs?: MentionRef[]): string => {
  if (b.type !== 'text') return '';
  if (!b.mentions || b.mentions.length === 0) return b.text;
  const nameOf = new Map((refs ?? []).map((r) => [r.userId, r.name]));
  return b.text.replace(MENTION_TOKEN_RE, (_m, userId: string) => {
    const name = nameOf.get(userId);
    // 解決名があれば @名前、無ければトークンを消す（生の <@id> を表示に漏らさない）。
    return name ? `@${name || '名無し'}` : '';
  });
};

// メンションハイライト描画用に、本文テキストを「素テキスト断片」と「メンション断片」の列へ分割する。
// 描画側（アプリの MessageRow）は text 断片を通常色、mention 断片をアクセント色の <Text> で描く。
// refs は ChatMessageDto.mentions（userId→name の解決済み情報）。userId が refs に無いトークンは
// 素の断片として無害に落とす（表示名が引けないメンションは表示しない）。
export type MentionSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; userId: string; name: string };

export function splitMentionSegments(text: string, refs?: MentionRef[]): MentionSegment[] {
  const nameOf = new Map((refs ?? []).map((r) => [r.userId, r.name]));
  const out: MentionSegment[] = [];
  let lastIndex = 0;
  // matchAll は g フラグ前提。lastIndex を跨いだ素テキストを都度切り出しながら分割する。
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const start = m.index ?? 0;
    const userId = m[1];
    const name = nameOf.get(userId);
    // 表示名が引けないトークンはメンション扱いにしない（素テキストにも出さず、単に無視する）。
    if (start > lastIndex) out.push({ type: 'text', text: text.slice(lastIndex, start) });
    if (name != null) out.push({ type: 'mention', userId, name: name || '名無し' });
    lastIndex = start + m[0].length;
  }
  if (lastIndex < text.length) out.push({ type: 'text', text: text.slice(lastIndex) });
  return out;
}

// 待機画面（部屋一覧）1 行の未読件数を計算する（docs/read-receipt-decisions.md）。
// 未読件数はサーバーで計算せずクライアントが出す方針のため、ここに純粋関数として集約する
//（roomPreviewText と同粒度。表示ロジックを 3 プロジェクトで共有する）。
// - 部屋の最新 seq は RoomLastMessage.seq。未投稿部屋は lastMessage:null なので未読 0。
// - lastReadSeq は自分の既読 seq（GET /api/rooms/reads で取得。カーソル未取得の部屋は 0＝全件未読）。
// max(0, ...) で負にならないようにする（既読 seq が最新 seq を上回る一時的なズレでもバッジは 0）。
export function unreadCount(item: RoomListItem, lastReadSeq: number): number {
  const lastSeq = item.lastMessage?.seq ?? 0;
  return Math.max(0, lastSeq - lastReadSeq);
}

// 待機画面（部屋一覧）の最新メッセージ本文プレビュー文字列を作る。
// text はそのまま、image は本文を持たないため「写真を送信しました」に振り分ける。
// lastMessage が無い（まだ 1 件も投稿が無い）部屋は「まだメッセージがありません」を返す。
export function roomPreviewText(item: RoomListItem): string {
  const last = item.lastMessage;
  if (!last) return 'まだメッセージがありません';
  if (last.body.type === 'image') return '写真を送信しました';
  return bodyText(last.body);
}

// 送信時刻（epoch ms）を待機画面向けの相対表記へ変換する。
// 相対表記はデバイスの現在時刻・タイムゾーンに依存するためサーバーでは固定せず、表示側でここを呼ぶ。
// 目安: 1分未満=たった今 / 60分未満=n分前 / 24時間未満=n時間前 / 7日未満=n日前 / それ以上=年月日。
// now は既定で現在時刻。テスト等で基準時刻を差し込めるよう引数で受ける。
export function relativeTime(sentAt: number, now: number = Date.now()): string {
  const min = Math.floor((now - sentAt) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  const d = new Date(sentAt);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
