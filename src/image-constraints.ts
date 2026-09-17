// 画像アップロード基盤の規定値（docs/image-upload-decisions.md 6 章）。
// クライアント（アプリ・admin-ui）とサーバーが「同じ 1 つの値」を使うための一元管理点
// （食い違い防止。検証・規定はサーバーに一元化する既存方針を踏襲）。
//
// ここには Cloudflare Workers / DOM / React Native 依存を書かない（純粋な定数・型のみ）。
// サーバーは受信後にこの規定値へ必ず再圧縮し、3 種（orig / thumb / blur）を生成する。
// クライアントは送信前の一次圧縮（帯域削減）にこの値を使うが、確定はサーバーが握る。

import type { ImageUsage } from './api';

// 受け入れる入力 MIME。出力は必ず WebP に統一する（下の OUTPUT_MIME）。
// サーバーは実デコード可否も併せて検証するため、ここは「明らかに画像でないもの」を弾く軽量チェック。
export const ALLOWED_INPUT_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// サーバー再圧縮後の確定 MIME。3 種すべてこの形式で R2 に置く。
export const OUTPUT_MIME = 'image/webp';

// 入力バイト上限（受信時に弾く）。巨大アップロードで R2/CPU を浪費させない。
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB

// 入力ピクセル上限（幅 × 高さ）。デコード後にこれを超える画像は弾く（デコード爆弾対策）。
export const MAX_INPUT_PIXELS = 40_000_000; // 40 MP

// 配信用オリジナル（orig）の長辺（px）。用途で変える。拡大表示の「本物」。
// Photon の get_bytes_webp は品質指定を持たないため、実質の圧縮制御は長辺（リサイズ）で行う。
export const ORIG_MAX_EDGE: Record<ImageUsage, number> = {
  avatar: 512,
  chat: 1600,
};

// 通常サムネ（thumb）の長辺（px）。一覧・通常表示用。承認後に他ユーザーへも配る。
export const THUMB_MAX_EDGE = 320;

// ぼかしサムネ（blur）の長辺（px）。検閲前の他ユーザー表示用。
// 先に強く縮小してからぼかすことで、拡大しても原画像を復元できないようにする。
export const BLUR_MAX_EDGE = 96;

// ぼかしの強さ（gaussian_blur の radius）。強縮小後にさらに強くかける。
export const BLUR_RADIUS = 25;

// variant → R2 に置くオブジェクト種別の対応。配信の出し分け（api の判定表）で使う。
// 'full' は orig（本物）、'thumb' は thumb（通常サムネ）、'blur' はぼかしサムネ。
export type ImageObjectKind = 'orig' | 'thumb' | 'blur';

// 与えられた usage の orig 長辺を返す。未知の usage はフォールバックせずエラーにする
// （用途は api の ImageUsage で閉じているため、想定外は設定ミスとして即座に気付けるようにする）。
export function origMaxEdge(usage: ImageUsage): number {
  const edge = ORIG_MAX_EDGE[usage];
  if (edge == null) throw new Error(`unknown image usage: ${usage}`);
  return edge;
}
