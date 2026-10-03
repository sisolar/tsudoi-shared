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
// - 相対時刻は持たない（表示側で createdAt から算出）。いいねは likeCount／likedByMe を実データで載せる
//   （docs/sns-post-decisions.md 1.5。集計値は焼き付けず配信直前に sns_like から解決する）。
export interface SnsPost {
  id: string;
  // 投稿者（user.id）。表示名・アイコンは焼き付けず id で持ち、都度解決する。
  authorId: string;
  // 投稿者の表示名（authorId から user.name を解決した生の値。未設定は空文字＝表示境界で「名無し」に倒す）。
  // 本体に焼き付けず配信直前に都度解決するため、改名が過去分含め即反映される（chat の authorName と同じ思想）。
  authorName: string;
  // 投稿者のアイコン画像 id（authorId から user.avatarImageId を解決した値。未設定は null＝頭文字円）。
  // authorName と同じく保持せず都度解決するため、アイコン差し替えが即反映される（バイナリは持たずキーだけ）。
  avatarImageId: string | null;
  // 本文（構造化 JSON）。DB には JSON 文字列で保存し、API/データアクセス境界でこのオブジェクトに戻す。
  body: SnsPostBody;
  // 添付画像 id（image.id）の配列。position 昇順。0 枚ならテキストのみ投稿。
  imageIds: string[];
  // 投稿時刻（epoch ms）。表示側が relativeTime で相対表記にする。
  createdAt: number;
  // body.text にメンションがある時だけ載る（chat と同じく userId から都度解決した表示情報）。
  mentions?: MentionRef[];
  // いいね数（sns_like を postId で COUNT した実データ。docs/sns-post-decisions.md 1.5）。
  // 「誰が押したか」は焼き付けず、集計値だけを配信直前に載せる（authorName を都度解決するのと同じ思想）。
  likeCount: number;
  // 自分がこの投稿へいいねしているか（ハートの塗り分けに使う。EXISTS(postId=? AND userId=自分)）。
  // 閲覧者依存の状態なので投稿本体には焼き付けず、取得を要求した本人視点でサーバーが載せる。
  likedByMe: boolean;
  // 返信（コメント）の親投稿 id（docs/sns-reply-decisions.md 2 章。sns_post.replyToPostId に対応）。
  // トップレベル投稿では省略（undefined）。返信ならその直接の親（トップレベル or 別の返信）の id。
  // スレッド画面が祖先チェーン・子一覧をこの id から組み立てる（threadAncestors / threadChildren）。
  replyToPostId?: string;
  // 返信数（焼き付けず取得のたびに数え直す。likeCount と同じ思想）。意味は取得経路で異なる:
  //  - プロフィール一覧（GET /users/:id/posts）… そのスレッドの子孫総数（countDescendantsByRoot）。
  //  - スレッド（GET .../thread の posts）… 直下の子数（countRepliesByParent）。クライアントが
  //    threadDescendantCount で子孫合算に組み替えて描く。
  replyCount: number;
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

// POST /api/sns/posts/:id/like の応答（いいねのトグル結果。docs/sns-post-decisions.md 1.5）。
// トグルは冪等（押していなければ付ける＝liked:true、押していれば外す＝liked:false）。サーバーは操作後の
// 確定状態を返すので、クライアントは楽観更新した値をこの応答で上書きして真実に合わせられる。
// - liked     : 操作後、自分がこの投稿へいいねしているか（SnsPost.likedByMe と同じ視点）。
// - likeCount : 操作後のいいね総数（SnsPost.likeCount と同じ集計）。
export interface SnsLikeResponse {
  liked: boolean;
  likeCount: number;
}

// --- SNS 返信（コメント）機能（docs/sns-reply-decisions.md） ---

// POST /api/sns/posts/:id/replies のリクエスト。指定投稿（トップレベル or 返信）への返信を作る。
// 投稿（CreateSnsPostRequest）と同じく本文 text＋画像 imageIds を送れる（返信も画像添付可）。
// authorId・親の rootPostId 継承はサーバーが確定する。POST は成功時 204（作成応答型なし）。
export interface CreateSnsReplyRequest {
  text: string;
  imageIds: string[];
}

// GET /api/sns/posts/:id/thread の応答（docs/sns-reply-decisions.md 3.2）。
// - root : スレッドの根（トップレベル投稿）。
// - posts: スレッド全件（根を含む）を createdAt 昇順で。各投稿は replyToPostId / replyCount（直下の子数）を持つ。
// フォーカス投稿を起点にした「祖先チェーン＋子一覧」と子孫合算の返信数は、クライアントが純ロジックで組み立てる
//（threadAncestors / threadChildren / threadDescendantCount）。サーバーはスレッド全件をフラットに返すだけ。
export interface SnsThreadResponse {
  root: SnsPost;
  posts: SnsPost[];
}

// スレッド全件（posts）から、フォーカス投稿の「根→…→自分」の祖先チェーンを返す純ロジック（React 非依存）。
// replyToPostId を親へ辿るだけ（id → post の Map で O(深さ)）。先頭が根、末尾がフォーカス自身。
// フォーカスが posts に無ければ空配列（存在しない id の防御）。posts は DAG 前提のため循環は考慮しない。
export function threadAncestors(posts: SnsPost[], focusId: string): SnsPost[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const chain: SnsPost[] = [];
  let cur = byId.get(focusId);
  while (cur) {
    chain.unshift(cur); // 先頭へ積む＝根が先・自分が末尾。
    cur = cur.replyToPostId ? byId.get(cur.replyToPostId) : undefined;
  }
  return chain;
}

// スレッド全件（posts）から、指定 id への直接の返信（子）を createdAt 昇順で返す純ロジック（React 非依存）。
export function threadChildren(posts: SnsPost[], parentId: string): SnsPost[] {
  return posts
    .filter((p) => p.replyToPostId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// スレッド全件（posts）から、指定 id 配下の子孫すべて（子・孫・ひ孫…）の件数を返す純ロジック（React 非依存）。
// parentId → 子配列の索引を 1 度作り、深さ優先で子孫を数える（スレッドは全件取得済みなので追加クエリ不要）。
// 各カードの吹き出しバッジに「スレッドとしての返信総数」を出すのに使う。
export function threadDescendantCount(posts: SnsPost[], id: string): number {
  const childrenByParent = new Map<string, SnsPost[]>();
  for (const p of posts) {
    if (!p.replyToPostId) continue;
    const list = childrenByParent.get(p.replyToPostId);
    if (list) list.push(p);
    else childrenByParent.set(p.replyToPostId, [p]);
  }
  let count = 0;
  const stack = [...(childrenByParent.get(id) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop() as SnsPost;
    count += 1;
    const kids = childrenByParent.get(node.id);
    if (kids) stack.push(...kids);
  }
  return count;
}

