// UserHub（アプリ全体で 1 本の汎用リアルタイム受信）の配信契約。
// サーバー(src/*)・アプリ(tsudoi-app/src/*) が import して共有する（docs/userhub-do-plan.md）。
//
// UserHub は「1 ユーザー = 1 DO（idFromName(userId)）」で、アプリはログイン中ずっと
// 自分の UserHub へ wss://…/do/hub を 1 本だけ張る。部屋一覧の更新・SNS 通知・運営お知らせ等の
// ユーザー宛リアルタイムを、この 1 本の汎用チャンネルで受ける（用途が増えても WS の本数は増やさない）。
//
// 汎用チャンネルなので配信は必ず type 付きの「封筒（envelope）」で包む。受信側は type で振り分け、
// 未知 type は無視する（前方互換）。用途を増やすときはこの union に type を足すだけ
// （Room DO の body=MessageBody と同じ拡張思想）。ここには Cloudflare Workers / DOM /
// React Native 依存の型を書かない（純粋な型のみ）。
import type { RoomLastMessage } from './api';

// UserHub が配信するイベント（封筒）。待機画面（部屋一覧）の最新化と、自分宛て（返信/メンション）の
// 未読件数更新の 2 種。将来 SNS 通知・運営お知らせ・状態同期などを足すときはこの union を明示的に広げる。
// - room_updated: 部屋 roomId の最新メッセージが更新された（待機画面のプレビュー行を差し替える）。
//   lastMessage はその部屋の最新サマリ。まだ 1 件も投稿が無い状態はこのイベントでは発生しない
//   （メッセージ保存＝配信バッチ末尾がトリガーのため）が、型は RoomListItem に合わせ null も許容する。
//   ※このイベントは部屋メンバー全員へ同一封筒で fan-out する。誰宛てかは載せない（他人に返信/メンションの
//     宛先が漏れないようにする）。自分宛ての未読件数は下の mention_updated で本人にだけ配る。
// - mention_updated: 自分（受信者本人）宛ての返信/メンションによって、部屋 roomId の自分宛て未読件数が
//   count（絶対値）に更新された（待機画面の未読バッジを「数字付き」へ即時反映する）。本人の UserHub にだけ配る
//   （他人へは配らない＝内容も宛先も漏らさない）。本文・送信者などの内容は載せない（roomId と件数だけ）。
//   count は現在の read_cursor.mentionUnread の絶対値なので、受信側は加算ではなく「その値で上書き」する
//   （冪等。取りこぼしても次のイベントやフォーカス再取得で整合する）。真実の源は D1 の read_cursor.mentionUnread。
export type HubEvent =
  | {
      type: 'room_updated';
      roomId: string;
      lastMessage: RoomLastMessage | null;
    }
  | {
      type: 'mention_updated';
      roomId: string;
      count: number;
    };
