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
import type { ImageUsage, ImageVariant, MessageBody } from './api';

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
  return input === 'avatar' || input === 'chat';
}

// variant 文字列が既知か（GET /api/images/:id?variant= の検証点）。
// 省略不可・未知不可（呼び出し側は invalid_variant=400）。
export function isImageVariant(input: unknown): input is ImageVariant {
  return input === 'thumb' || input === 'full';
}

// --- メッセージ本文の検証（保存・配信の唯一の検証点） ---
// メッセージ送信は HTTP に一本化したため、入口は POST /api/rooms/:id/messages（text）と
// POST /api/images（image）の 2 つ。どちらも { body } を渡し、検証点をこの関数 1 つに集約する。
// Room DO 側の内部保存（防御的な二重検証）も同じ関数を通す。
//
// 受信入力（{ body: MessageBody }）から保存用の body を検証・整形する。壊れ・未対応は null。
// text は前後空白を落とし、空なら null。image は imageId が非空文字列でなければ null
// （寸法の真実の源は D1 image 表。存在確認・検閲状態は配信側が担う）。未知 type は拒否する。
export function normalizeMessageBody(data: { body?: unknown }): MessageBody | null {
  const raw = data.body;
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.type === 'text') {
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    return text ? { type: 'text', text } : null;
  }
  if (b.type === 'image') {
    const imageId = typeof b.imageId === 'string' ? b.imageId.trim() : '';
    return imageId ? { type: 'image', imageId } : null;
  }
  // text / image 以外の type は受け付けない（未知 type は型・実装ともに拒否する）。
  return null;
}
