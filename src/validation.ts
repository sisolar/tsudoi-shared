// ユーザー入力の正規化・検証。サーバー・admin-ui・アプリ（Expo）の全プロジェクトで
// 「同じ 1 つの実装」を共有するための純粋関数群（DOM / Node / Workers いずれにも依存しない）。
//
// 設計思想（docs/user-profile-edit-decisions.md 2.1）:
//   検証はサーバーに一元化し、クライアント側で正規化ロジックを二重に持たない（食い違いを防ぐ）。
// この方針を「実装を 2 つ書かない」= 1 実装を全プロジェクトで共有する、という形で実現する。
// サーバーはこれを唯一の検証点として使い、クライアントは同じ関数で即時フィードバックできる。

// 画像アップロード検証で使う規定値・型（唯一の出所は @shared/image-constraints と ./api）。
import {
  ALLOWED_INPUT_MIMES,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from './image-constraints';
import type { ImageUsage, ImageVariant, MessageBody, RoomVisibility } from './api';
import type { SnsPostBody } from './sns';

// 表示名(name)の最大長。絵文字・多言語を許容し、型不正のみ禁止（空・長すぎは正常系）。
export const NAME_MAX_LENGTH = 40;

// 表示名を正規化する。唯一の検証点として全経路（本人 PATCH /api/me・管理者
// PATCH /admin/api/users/:id・登録 POST /admin/api/users）が通す。
// 正常系として広く受け入れ、型不正だけをエラーにする方針:
// - 文字列でなければ null を返す（呼び出し側は invalid_name = 400）。
// - 前後の空白を落とす。
// - 空文字（空白のみ含む）は「名無しへ戻す」意図として許可し、空文字を返す
//   （表示名は authorId から都度解決し、未設定は '名無し' にフォールバックするため）。
// - NAME_MAX_LENGTH を超えたら切り捨てる（エラーにはしない）。
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  return input.trim().slice(0, NAME_MAX_LENGTH);
}

// メールアドレスを正規化する。唯一の検証点として登録 POST /admin/api/users と
// 更新 PATCH /admin/api/users/:id・PATCH /api/me が通す。
// 前後の空白を落として小文字化し、形式が不正なら null を返す（呼び出し側は invalid_email = 400）。
// 形式判定は簡易チェック（@ の前後に空白なしの文字列とドメイン）。厳密な RFC 準拠は狙わない
// （到達確認は OTP ログインが担うため、ここは明らかな誤りを弾く軽量チェックに留める）。
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return null;
  return normalized;
}

// --- 部屋の公開範囲（docs/room-visibility-decisions.md 2.2） ---
// 公開範囲を正規化する。作成 POST /api/rooms・編集 PATCH /api/rooms/:id が通す唯一の検証点。
// 'public' | 'private' の 2 値だけ受け入れ、それ以外（未知・型不正）は null を返す
// （呼び出し側は invalid_visibility=400）。memberIds の実在確認は D1 参照が要るのでここではやらず、
// サーバー（rooms-routes.ts）が filterExistingUserIds を通して存在しない id を落とす。
export function normalizeVisibility(v: unknown): RoomVisibility | null {
  return v === 'public' || v === 'private' ? v : null;
}

// --- 画像アップロードの検証（サーバーに一元化する唯一の検証点） ---
// 規定値は @shared/image-constraints に集約し、クライアント・サーバーが同じ値で判定する
// （docs/image-upload-decisions.md 6・9 章）。ここは純粋関数のみ（バイナリ処理は持たない）。
// 使用する定数・型は先頭の import 群でまとめて読み込む（import/first）。

// 入力 MIME が受け入れ対象か。想定外（動画・SVG 等）を弾く軽量チェック。
// 実デコード可否・寸法はサーバーが Photon で最終確認するため、ここは前段の軽い門番。
export function isAllowedImageMime(mime: unknown): mime is (typeof ALLOWED_INPUT_MIMES)[number] {
  return typeof mime === 'string' && (ALLOWED_INPUT_MIMES as readonly string[]).includes(mime);
}

// アップロードのバイト数が上限内か（0 より大きく MAX_UPLOAD_BYTES 以下）。
export function isAllowedImageBytes(bytes: unknown): boolean {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_UPLOAD_BYTES;
}

// デコード後のピクセル数（幅 × 高さ）が上限内か（デコード爆弾対策）。
export function isAllowedImagePixels(width: unknown, height: unknown): boolean {
  if (typeof width !== 'number' || typeof height !== 'number') return false;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return width * height <= MAX_INPUT_PIXELS;
}

// usage 文字列が既知の用途か（POST /api/images の usage 検証点）。
// 未知はフォールバックせずここで弾く（呼び出し側は invalid_usage=400）。
export function isImageUsage(input: unknown): input is ImageUsage {
  return input === 'avatar' || input === 'chat' || input === 'sns';
}

// variant 文字列が既知か（GET /api/images/:id?variant= の検証点）。
// 省略不可・未知不可（呼び出し側は invalid_variant=400）。
export function isImageVariant(input: unknown): input is ImageVariant {
  return input === 'thumb' || input === 'full';
}

// --- メンション（docs/mention-decisions.md） ---
// 本文テキストに埋め込むメンションのトークン書式は <@userId>。userId は Better Auth 採番
// （英数・ハイフン・アンダースコア想定）。表示テキストに現れにくく素のテキストと衝突しにくい書式。
export const MENTION_TOKEN_RE = /<@([A-Za-z0-9_-]+)>/g;

// 本文テキストから <@userId> トークンの userId を抽出する（重複排除・出現順）。
// 純粋関数（D1 非依存）。実在ユーザーかの確認はしない（宛先の実在確認は呼び出し側＝サーバーの責務）。
export function extractMentions(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(MENTION_TOKEN_RE)) ids.add(m[1]);
  return [...ids];
}

// --- 返信（リプライ。docs/reply-decisions.md） ---
// 返信先メッセージの seq を正規化する。送信ルート（POST /api/rooms/:id/messages）が通す唯一の検証点。
// seq は DO が採番する正の整数（1 始まりの連番）。正の整数だけ受け入れ、それ以外（非数・0・負・小数・
// NaN 等）は undefined を返す（＝返信ではない扱い）。
// 実在確認（その seq が本当にその部屋にあるか）はここではしない（validation.ts はランタイム非依存の
// 純粋関数という制約を守る。DO の SQLite を参照できない）。実在確認は DO 側が行い、存在しない seq は
// 落とす（authorId 同様「真実はサーバーが確定」）。
export function normalizeReplyTo(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isInteger(input) && input > 0 ? input : undefined;
}

// --- メッセージ本文の検証（保存・配信の唯一の検証点） ---
// メッセージ送信は HTTP に一本化したため、入口は POST /api/rooms/:id/messages（text）と
// POST /api/images（image）の 2 つ。どちらも { body } を渡し、検証点をこの関数 1 つに集約する。
// Room DO 側の内部保存（防御的な二重検証）も同じ関数を通す。
//
// type ごとの整形は専用ヘルパー（normalizeTextBody / normalizeImageBody）へ分離し、
// この関数は「入力を検証済み union へ振り分ける」ディスパッチに徹する（分岐の見通しを保つ）。

// text 本文を整形する。前後空白を落とし、空なら null（送信不可）。
// メンションは本文の <@userId> トークンから「サーバーが」再生成する（クライアント申告 b.mentions は
// 信用しない＝authorId 同様、真実はサーバーが確定）。mentions が空なら省略して載せない（後方互換）。
function normalizeTextBody(b: Record<string, unknown>): MessageBody | null {
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return null;
  const mentions = extractMentions(text);
  return mentions.length ? { type: 'text', text, mentions } : { type: 'text', text };
}

// image 本文を整形する。imageId が非空文字列でなければ null
// （寸法の真実の源は D1 image 表。存在確認・検閲状態は配信側が担う）。
function normalizeImageBody(b: Record<string, unknown>): MessageBody | null {
  const imageId = typeof b.imageId === 'string' ? b.imageId.trim() : '';
  return imageId ? { type: 'image', imageId } : null;
}

// 受信入力（{ body: MessageBody }）から保存用の body を検証・整形する。壊れ・未対応は null。
// text / image 以外の type は受け付けない（未知 type は型・実装ともに拒否する）。
export function normalizeMessageBody(data: { body?: unknown }): MessageBody | null {
  const raw = data.body;
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.type === 'text') return normalizeTextBody(b);
  if (b.type === 'image') return normalizeImageBody(b);
  return null;
}

// --- SNS つぶやきの検証（docs/sns-post-decisions.md。保存の唯一の検証点） ---
// つぶやきは「本文（構造化 JSON SnsPostBody）＋画像複数枚」を 1 投稿にまとめる案 B。チャットの
// normalizeMessageBody（text | image の二者択一）は流用できないため、SNS 専用の検証点をここに 1 つ足す。
// 上限はこの定数へ集約し、クライアント（即時フィードバック）とサーバー（確定）が同じ値で判定する。

// 本文テキストの最大長。normalizeName（超過は切り捨て）とは異なり、投稿本文は超過を切り捨てず不正扱いにする
// （呼び出し側は 400）。クライアントは同じ定数で投稿前にガードし、超過分のアップロードを走らせない（孤児画像
// を実運用で減らす。docs/sns-post-decisions.md 4.2）。
export const SNS_TEXT_MAX_LENGTH = 500;
// 1 投稿に添付できる画像の最大枚数（X 風の 4 枚）。0〜4 枚が正常系（0 枚はテキストのみ投稿）。
export const SNS_MAX_IMAGES = 4;

// SNS つぶやきの入力（text＋imageIds）を検証・整形し、保存用の { body, imageIds } を返す。壊れ・不正は null
// （呼び出し側は 400）。検証点をこの 1 関数に集約する（チャットの normalizeMessageBody と同じ思想）。
// - text: 文字列でなければ空文字扱い。前後空白を落とし、SNS_TEXT_MAX_LENGTH 超過は null（＝切り捨てず弾く）。
// - imageIds: 文字列の配列に整え（非文字列・空文字は落とす）、重複は残す（同じ画像を並べる指定は許容）。
//   SNS_MAX_IMAGES 超過は null。実在確認はここではしない（validation.ts はランタイム非依存の純粋関数という制約を
//   守る。D1 参照はできない）。実在確認はサーバーが filterExistingImageIds で行い、存在しない id を落とす
//   （メンション先・メンバーの実在確認と同じ作法）。
// - body.mentions は本文 text の <@userId> トークンから「サーバーが」再生成する（クライアント申告は信用しない
//   ＝authorId 同様、真実はサーバーが確定）。空なら省略して載せない（後方互換）。
// - text 空文字かつ imageIds 0 枚は空投稿として null（弾く）。
export function normalizeSnsPostInput(data: {
  text?: unknown;
  imageIds?: unknown;
}): { body: SnsPostBody; imageIds: string[] } | null {
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (text.length > SNS_TEXT_MAX_LENGTH) return null;

  const rawIds = Array.isArray(data.imageIds) ? data.imageIds : [];
  const imageIds = rawIds
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (imageIds.length > SNS_MAX_IMAGES) return null;

  // 空投稿（本文も画像も無い）は弾く。
  if (!text && imageIds.length === 0) return null;

  const mentions = extractMentions(text);
  const body: SnsPostBody = mentions.length ? { text, mentions } : { text };
  return { body, imageIds };
}
