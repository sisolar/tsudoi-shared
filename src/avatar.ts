// アバターの配色ユーティリティ（純粋関数）。サーバー・管理画面・アプリで共有する。
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存を書かない。
//
// 「id / 名前 → 安定した配色」を 1 か所に集約する。以前は app 側の lib/chat.ts（avatarTint）と
// (tabs)/index.tsx（avatarGradient）に hashInt が別々に重複していたが、同じ畳み込みなので
// ここへ寄せた（実装を 1 つにして食い違いを防ぐ。validation.ts / chat.ts と同じ方針）。

// 配色スキーム。light/dark で彩度・明度を抑えめに出し分ける（和の落ち着き）。
export type ColorScheme = 'light' | 'dark';

// 文字列から決定論的な非負整数ハッシュを作る（同じ文字列なら常に同じ値）。
// h*31+charCode の畳み込み。| 0 で 32bit へ丸め、Math.abs で非負にする。
export function hashInt(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ユーザー id からその人固有のアバター地色（単色 HSL）を作る。
// id が同じなら常に同じ色になる（表示名を変えても色は変わらない）。
// id が空のときは色相 0 に倒す（描画は保証する）。チャットの発言者アイコン・SNS・ユーザー一覧で共有。
export function avatarTint(id: string, scheme: ColorScheme): string {
  const hue = id ? hashInt(id) % 360 : 0;
  return scheme === 'dark' ? `hsl(${hue}, 42%, 46%)` : `hsl(${hue}, 58%, 62%)`;
}

// 部屋名からアバター用のグラデ 2 色（HSL）を作る。単色を「その部屋らしい 2 色グラデ」へ引き上げる。
// 色相を 32 度ずらした 2 色を返す。彩度・明度はスキームに合わせて抑えめ（和の落ち着き）。
export function avatarGradient(name: string, scheme: ColorScheme): [string, string] {
  const hue = hashInt(name) % 360;
  const hue2 = (hue + 32) % 360;
  return scheme === 'dark'
    ? [`hsl(${hue}, 42%, 46%)`, `hsl(${hue2}, 46%, 34%)`]
    : [`hsl(${hue}, 58%, 62%)`, `hsl(${hue2}, 62%, 50%)`];
}
