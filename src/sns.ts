// SNS プロフィール画面の表示用の型。サーバー・管理画面・アプリで共有する契約型。
// ここには特定ランタイム（Cloudflare Workers / DOM / React Native）依存の型を書かない
// （純粋な型のみ）。アバター画像も投稿画像も id だけを持つ（バイナリ・状態は持たない）方針は
// api.ts / chat.ts に合わせる。投稿本文はチャットと同じ MessageBody（text | image）を再利用し、
// 「テキストも画像も投稿できる」を型レベルで一本化する（表現の二重定義を作らない）。
import type { MessageBody } from './api';

// つぶやき 1 件。
// - body は MessageBody（{type:'text'} | {type:'image'}）。チャットのメッセージ本文と同じ形。
// - time は表示用の相対時刻文字列（例: '2時間前'）。
export interface SnsPost {
  id: string;
  body: MessageBody;
  time: string;
  likes: number;
  replies: number;
}

// SNS プロフィール 1 人分。
// - stats は「つぶやき / ご縁 / おとずれ」の 3 指標。
// - posts は DESC（降順・先頭が最新）で持つ。リストは上が最新・下が古い並びでそのまま描く。
// - avatarImageId は user.avatarImageId（未設定なら null）。画像配信は id で参照する。
export interface SnsProfile {
  userId: string;
  name: string;
  handle: string; // @なしのハンドル（表示側で @ を付ける）
  avatarImageId: string | null;
  bio: string;
  location: string;
  joined: string; // 参加時期（例: '2022年 春 から'）
  tags: string[]; // 興味・関心のタグ
  stats: SnsStats;
  posts: SnsPost[];
}

// プロフィールの 3 指標。posts=つぶやき / ties=ご縁 / visits=おとずれ。
export interface SnsStats {
  posts: number;
  ties: number;
  visits: number;
}
