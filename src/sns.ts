// SNS プロフィール画面の表示用の型。サーバー・管理画面・アプリで共有する契約型。
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存の型を書かない
// （純粋な型のみ）。アバター画像も投稿画像も id だけを持つ（バイナリ・状態は持たない）方針は
// api.ts / chat.ts に合わせる。
//
// つぶやきは「文章＋複数画像を 1 投稿にまとめる」案 B（docs/sns-post-decisions.md 1.2）。チャットの
// MessageBody（text | image の二者択一・画像 1 枚）では表現できないため再利用せず、本文（構造化 JSON の
// SnsPostBody）と画像 id 配列 imageIds を両方持つ SNS 専用モデルにする（本文が空文字かつ画像 0 枚は不可）。
import type { MentionRef } from './api';

// つぶやきの本文（構造化 JSON）。チャットの MessageBody（の text バリアント）と同型にする。
// 「オブジェクトを 1 つの型でサーバー・クライアントが共有し、DB には JSON 文字列で保存する」方針
// （真実の源は型）もチャットと同じ。将来の装飾（強調・リンク・見出し等）は optional フィールドを
// 足すだけで前方互換に拡張できる（version 列は持たない。古い保存済み本文は新フィールドが undefined に
// なるだけで読める）。
// - text     : 素の本文（画像のみ投稿は空文字）。メンショントークン <@userId> を含み得る。
// - mentions : 本文 text から抽出した userId 配列（重複排除・出現順）。空なら省略。サーバーが再生成する
//              （クライアント申告は信用しない＝authorId と同じ「真実はサーバーが作る」）。表示位置は text
//              内トークンが、通知の宛先解決は mentions 配列が担う二層分離（docs/mention-decisions.md 1.2）。
//              今回は投稿 push を送らないため実質未使用の冗長フィールドだが、チャットと同型にして将来の
//              通知にそのまま乗せられるようにしておく。
export interface SnsPostBody {
  text: string;
  mentions?: string[];
}

// つぶやき 1 件（実データ・案 B）。本文（構造化 JSON）と画像配列を両方持つ。
// - id / authorId / createdAt はサーバーが確定する（表示名・アイコンは焼き付けず id で持つ）。
// - 相対時刻・いいね数は持たない（表示側で createdAt から算出／いいねは今回非対象）。
export interface SnsPost {
  id: string;
  // 投稿者（user.id）。表示名・アイコンは焼き付けず id で持ち、都度解決する。
  authorId: string;
  // 本文（構造化 JSON）。DB には JSON 文字列で保存し、API/データアクセス境界でこのオブジェクトに戻す。
  body: SnsPostBody;
  // 添付画像 id（image.id）の配列。position 昇順。0 枚ならテキストのみ投稿。
  imageIds: string[];
  // 投稿時刻（epoch ms）。表示側が relativeTime で相対表記にする。
  createdAt: number;
  // body.text にメンションがある時だけ載る（chat と同じく userId から都度解決した表示情報）。
  mentions?: MentionRef[];
}

// アルバム 1 枚（= 投稿に添付された画像の抜き出し）。専用テーブルは持たず sns_post_image から導出する。
// createdAt / position はカーソルページング（(createdAt, postId, position) 複合カーソル）に使う。
// - postId    : 元の投稿 id（タップで該当投稿へ辿る余地。カーソルの第 2 キー）。
// - imageId   : 画像 id（image.id）。必ず在る（null にならない）。
// - createdAt : 元の投稿の createdAt（epoch ms。カーソルの第 1 キー・並び順）。
// - position  : 投稿内の並び順（0 始まり。カーソルの第 3 キー）。
export interface SnsPhoto {
  postId: string;
  imageId: string;
  createdAt: number;
  position: number;
}

// SNS プロフィール 1 人分（名前・アイコンだけ。posts/photos は別エンドポイントでページング取得するため持たない）。
// - name / avatarImageId は user 表から実データで解決して載せる（未設定なら null）。
export interface SnsProfile {
  userId: string;
  name: string;
  avatarImageId: string | null;
}

// --- SNS つぶやきの I/O 契約（HTTP リクエスト/レスポンス） ---
// これらは SnsPost / SnsProfile を参照するため api.ts ではなくここ（sns.ts）に置く。api.ts へ置くと
// api.ts → sns.ts の循環 import になる。依存の向きは sns.ts → api.ts の一方向に保つ（docs 6 章）。

// POST /api/sns/posts のリクエスト。text（任意）と imageIds（0〜N 枚。事前に POST /api/images で
// アップロード済みの image.id）を同時に送る。text と imageIds が両方空なら 400（空投稿は弾く）。
// text はクライアントの生入力（サーバーが SnsPostBody へ組み立て、メンションを再生成する）。
// POST は成功時 204 No Content（応答ボディを持たない）。作成した投稿は返さず、クライアントは投稿後に
// posts を再取得して反映する（createRoom/updateMe と同じ設計思想）。そのため作成応答型は設けない。
export interface CreateSnsPostRequest {
  text: string;
  imageIds: string[];
}

// GET /api/users/:id/sns の応答（名前・アイコンだけ）。posts/photos は別エンドポイントで取得する。
export interface SnsProfileResponse {
  profile: SnsProfile;
}

// GET /api/users/:id/sns/posts?beforeCreatedAt=&beforeId=&limit= の応答。
// posts は createdAt DESC（同着は id DESC）。hasMore=true なら「末尾の post の (createdAt, id)」を次カーソルに
// 渡して続きを取れる（クライアントが末尾要素から組み立てる。追加の nextCursor は返さない）。
export interface SnsPostsResponse {
  posts: SnsPost[];
  hasMore: boolean;
}

// GET /api/users/:id/sns/photos?beforeCreatedAt=&beforePostId=&beforePosition=&limit= の応答。
// photos は投稿の createdAt DESC → 同着は postId DESC → position ASC で平坦化。hasMore=true なら
// 「末尾の photo の (createdAt, postId, position)」を次カーソルに渡して続きを取れる。
export interface SnsPhotosResponse {
  photos: SnsPhoto[];
  hasMore: boolean;
}
