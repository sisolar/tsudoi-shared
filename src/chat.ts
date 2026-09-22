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
  // 本文トークン <@userId> の表示名解決情報（ChatMessageDto.mentions をそのまま引き継ぐ）。
  // body が text かつメンションを持つ時だけ載る。描画側は splitMentionSegments に渡して
  // <@userId> を @名前 のハイライト表示へ置換する（authorName と同じく都度解決＝改名即反映）。
  mentions?: MentionRef[];
  // 返信（リプライ。docs/reply-decisions.md）先メッセージの seq。通常メッセージでは省略。
  // ChatMessageDto.replyTo をそのまま引き継ぐ。描画側（MessageRow）はこの seq を単一メッセージ取得
  // API（GET /api/rooms/:id/messages/:seq。reply-cache でキャッシュ）で引いて「引用チップ
  // （→ ◯◯さんへ: 本文プレビュー）」を吹き出しの上に描く（引用元は焼き付けず都度解決）。
  replyTo?: number;
}

// 返信の引用チップに出す本文プレビュー文字列を作る（docs/reply-decisions.md 3 章）。
// 引用元メッセージ（seq から取得した ChatMessage）を渡すと 1 行のプレビューを返す。
// text はメンション解決込みのサマリ（bodyText。長い本文は呼び出し側の Text で省略記号にする）、
// image は本文を持たないため「写真」に振り分ける。null（引用元が取得できない）なら空文字を返し、
// 呼び出し側は簡易表示（「返信」等）にフォールバックする。
export function replyPreviewText(msg: ChatMessage | null | undefined): string {
  if (!msg) return '';
  if (msg.body.type === 'image') return '写真';
  return bodyText(msg.body, msg.mentions);
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

// --- チャット画面の行ビューモデル・入力補助（アプリ/管理画面で共有する純ロジック。docs/reply-decisions.md 7） ---

// 行の描画に必要な値だけを事前計算した「ビューモデル」。
// これを作っておくことで、行コンポーネントは messages 配列や index を参照せずに済み、
// 各行の再描画を props の浅い比較（memo）だけで抑えられる。
export interface RowVM {
  message: ChatMessage;
  mine: boolean;
  showDay: boolean;
  dayText: string;
  grouped: boolean;
}

// 送信時刻を「今日 / 昨日 / M月D日(曜)」の日付区切りラベルへ変換する（buildRowVMs 内部でも使う）。
// 相対表記はデバイスの現在時刻・タイムゾーン依存のため表示側で算出する。now は既定で現在時刻。
export function dayLabel(ms: number, now: number = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = day(now) - day(ms);
  if (diff === 0) return '今日';
  if (diff === 86_400_000) return '昨日';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
}

// 送信時刻を時計表記（H:MM）へ。吹き出し脇の時刻に使う。
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// messages（seq 昇順）から行 VM 配列を作る。1回の走査で prev 参照を解決する。
// 日付区切り・連続グルーピングは「時系列で1つ前のメッセージ」（index-1）を基準にする。
export function buildRowVMs(messages: ChatMessage[], meId: string | undefined): RowVM[] {
  const out: RowVM[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i += 1) {
    const item = messages[i];
    const prev = messages[i - 1];
    const day = dayLabel(item.sentAt);
    const showDay = !prev || dayLabel(prev.sentAt) !== day;
    out[i] = {
      message: item,
      mine: item.authorId === meId,
      showDay,
      dayText: day,
      grouped: !!prev && prev.authorId === item.authorId && !showDay,
    };
  }
  return out;
}

// 送信直前に、入力欄の読みやすい「@名前」を機械可読なトークン「<@userId>」へ変換する
//（docs/mention-decisions.md の割り切り。ワイヤー・保存は <@userId>、表示は都度解決）。
// map は「@名前 → userId」の対応表（コンポーザが選択時に貯める）。長い名前から先に置換し、
// 短い名前が長い名前の一部を食い違って潰さないようにする（例: @はる と @はると の共存）。
// ユーザーが @名前 部分を手で編集・削除して一致しなくなったものは置換されない＝メンション扱いに
// ならない（トークン化しない）。正規表現の特殊文字は名前に混ざり得るのでエスケープしてから探す。
export function tokenizeMentions(text: string, map: Map<string, string>): string {
  const labels = [...map.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const label of labels) {
    const userId = map.get(label);
    if (!userId) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), `<@${userId}>`);
  }
  return out;
}
