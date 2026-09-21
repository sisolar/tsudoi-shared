// UserHub（アプリ全体で 1 本の汎用リアルタイム受信）の配信契約。
// サーバー(src/*)・アプリ(tsudoi-app/src/*) が import して共有する（docs/userhub-do-plan.md）。
//
// UserHub は「1 ユーザー = 1 DO（idFromName(userId)）」で、アプリはログイン中ずっと
// 自分の UserHub へ wss://…/hub を 1 本だけ張る。部屋一覧の更新・SNS 通知・運営お知らせ等の
// ユーザー宛リアルタイムを、この 1 本の汎用チャンネルで受ける（用途が増えても WS の本数は増やさない）。
//
// 汎用チャンネルなので配信は必ず type 付きの「封筒（envelope）」で包む。受信側は type で振り分け、
// 未知 type は無視する（前方互換）。用途を増やすときはこの union に type を足すだけ
// （Room DO の body=MessageBody と同じ拡張思想）。ここには Cloudflare Workers / DOM /
// React Native 依存の型を書かない（純粋な型のみ）。
import type { RoomLastMessage } from './api';

// UserHub が配信するイベント（封筒）。当面は待機画面（部屋一覧）の最新化 1 種のみ。
// 将来 SNS 通知・運営お知らせ・状態同期などを足すときはこの union を明示的に広げる。
// - room_updated: 部屋 roomId の最新メッセージが更新された（待機画面のプレビュー行を差し替える）。
//   lastMessage はその部屋の最新サマリ。まだ 1 件も投稿が無い状態はこのイベントでは発生しない
//   （メッセージ保存＝配信バッチ末尾がトリガーのため）が、型は RoomListItem に合わせ null も許容する。
export type HubEvent = {
  type: 'room_updated';
  roomId: string;
  lastMessage: RoomLastMessage | null;
};
