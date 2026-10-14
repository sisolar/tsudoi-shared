// 通話（LiveKit）まわりの純粋関数と型（docs/livekit-decisions.md D10・D26・D27・D31）。
// サーバー・アプリで 1 つの実装を共有する。特定ランタイム（Workers / React Native）や livekit-client には依存しない。
// LiveKit の切断理由などは、アプリ側が下の共有の型（文字列のユニオン）へ変換してから渡す。

// ---- ルーム名（D10）----------------------------------------------------------------------------

// LiveKit ルーム名 = `{prefix}:{roomId}`。prefix は環境ごとの接頭辞（dev / prod）で、同じ LiveKit プロジェクトを
// 共有しても部屋 ID が衝突しないようにする。prefix に ':' を含めない前提（呼び出し側が検証する）。
export function roomNameFromId(prefix: string, roomId: string): string {
  return `${prefix}:${roomId}`;
}

// ルーム名を {prefix, roomId} に分解する。部屋 ID 側に ':' が入っても壊れないよう「最初の ':'」で 2 つに分ける。
// 区切りが無い・どちらかが空のときは null。
export function parseRoomName(roomName: string): { prefix: string; roomId: string } | null {
  const i = roomName.indexOf(':');
  if (i <= 0 || i === roomName.length - 1) return null;
  return { prefix: roomName.slice(0, i), roomId: roomName.slice(i + 1) };
}

// ---- 入室の可否（D27）--------------------------------------------------------------------------

export type JoinDecision = 'join' | 'already_in_this_room' | 'busy_other_room';

// アプリでは同時に 1 つの通話しか持たない。今の通話の部屋（無ければ null）と入室したい部屋から判定する。
//  - join                : 通話していない → 入室する
//  - already_in_this_room: すでにその部屋で通話中 → 何もしない（パネルを開くだけ）
//  - busy_other_room     : 別の部屋で通話中 → 入室せず「他の部屋で通話中」のダイアログ
export function decideJoin(currentRoomId: string | null, targetRoomId: string): JoinDecision {
  if (currentRoomId == null) return 'join';
  return currentRoomId === targetRoomId ? 'already_in_this_room' : 'busy_other_room';
}

// ---- 通話ボタンの色（D21）----------------------------------------------------------------------

// ヘッダーの通話アイコンを「通話中の色」にするか。今いる部屋が通話中の部屋のときだけ。
export function isCallActiveHere(callRoomId: string | null, hereRoomId: string): boolean {
  return callRoomId != null && callRoomId === hereRoomId;
}

// ---- エラーの分類（D26）------------------------------------------------------------------------

// ダイアログの種類（D26・D27）。画面側はこの種類から文言を引く。
export type CallDialogKind =
  | 'join_failed'
  | 'disconnected'
  | 'duplicate'
  | 'publish_failed'
  | 'unavailable'
  | 'no_access'
  | 'ended'
  | 'busy_other_room';

// アプリ側が livekit-client の DisconnectReason から変換して渡す切断理由（共有の型）。
export type CallDisconnectReason =
  | 'duplicate_identity' // 同じ identity が別の端末で参加した（D11）
  | 'room_closed' // 部屋が閉じられた・削除された
  | 'participant_removed' // 退出させられた
  | 'client_initiated' // 自分から退出した
  | 'other'; // それ以外（ネットワーク断で戻れなかった等）

// 切断理由 → ダイアログ。自分から退出した場合はダイアログを出さない（null）。
export function dialogForDisconnect(reason: CallDisconnectReason): CallDialogKind | null {
  switch (reason) {
    case 'client_initiated':
      return null;
    case 'duplicate_identity':
      return 'duplicate';
    case 'room_closed':
      return 'ended';
    case 'participant_removed':
      return 'no_access';
    default:
      return 'disconnected';
  }
}

// トークン発行 API の HTTP ステータス → ダイアログ（D17・D26）。
//  - 404: 存在しない・非メンバー（no_access）／ 503: 通話機能が未設定（unavailable）／ それ以外: 入室失敗。
export function dialogForTokenStatus(status: number): CallDialogKind {
  if (status === 404) return 'no_access';
  if (status === 503) return 'unavailable';
  return 'join_failed';
}

// ---- 映像の排他（D24）--------------------------------------------------------------------------

// 発信している映像の種類。カメラと画面共有は同時に発信できない（排他）ので 1 人につき 3 値のどれか 1 つ。
export type VideoMode = 'none' | 'camera' | 'screen';

// 映像の状態を「画面共有 > カメラ > なし」の優先で 1 つに決める（タイルの中身の優先順と同じ）。
// LiveKit が両方 true を返す一瞬（切り替えの途中）があっても、常に 1 つに畳める。
export function resolveVideoMode(opts: { screenOn: boolean; cameraOn: boolean }): VideoMode {
  if (opts.screenOn) return 'screen';
  if (opts.cameraOn) return 'camera';
  return 'none';
}

// 現在の映像から、次の映像へ切り替えるために「止める必要があるもの」と「始めるもの」を返す。
// 排他なので、新しい映像を始める前に、今出している別の映像を必ず止める。
//  - 同じ種類への切り替えは何もしない。
//  - 'none' への切り替えは、今出している映像を止めるだけ。
export function planVideoSwitch(
  current: VideoMode,
  next: VideoMode,
): { stop: Exclude<VideoMode, 'none'>[]; start: Exclude<VideoMode, 'none'> | null } {
  if (current === next) return { stop: [], start: null };
  const stop: Exclude<VideoMode, 'none'>[] = current === 'none' ? [] : [current];
  const start = next === 'none' ? null : next;
  return { stop, start };
}

// ---- 映像ボタンの選択肢（D24）------------------------------------------------------------------

export type VideoSourceChoice = 'camera' | 'screen';

// 「映像」ボタンを押したときに出す選択肢。画面共有は、開始に対応した環境だけ（D2: スマホのブラウザは出さない）。
// カメラも画面共有も選べないときは空配列（呼び出し側はボタンを無効にする）。
export function videoChoices(opts: { hasCamera: boolean; canScreenShare: boolean }): VideoSourceChoice[] {
  const choices: VideoSourceChoice[] = [];
  if (opts.hasCamera) choices.push('camera');
  if (opts.canScreenShare) choices.push('screen');
  return choices;
}
