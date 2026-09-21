// tsudoi の API リクエスト/レスポンス契約。管理者向け・本人向け・部屋など、
// サーバー(src/*)・管理画面(admin-ui/src/*)・アプリ(tsudoi-app/src/*) が import して共有する。
//
// ここには Cloudflare Workers / DOM / React Native 依存の型を書かない（純粋な型のみ）。
// そうすることで、workers-types を持たない admin-ui やアプリからも安全に import でき、
// プロパティ名の食い違い（例: name を title と書く等）をコンパイラが各所で検出できる。

// --- ユーザー（事前登録） ---

// ユーザー1件の公開表現。一覧・作成の応答で使う。
// isAdmin は ADMIN_EMAILS 判定でサーバーが付与する（DB に列は持たない）。
export interface UserDto {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string; // Better Auth が返す日時文字列
  isAdmin: boolean;
  // アバター画像の id（image.id）。未設定なら null。バイナリ・状態は持たない（キーだけ）。
  // Better Auth 既定の image（URL 想定）からリネームした列。id を保持することを明示する。
  avatarImageId: string | null;
}

// GET /admin/api/users の応答。
export interface ListUsersResponse {
  users: UserDto[];
}

// POST /admin/api/users のリクエストボディ。
// email に加えて表示名(name)もまとめて受け取り、登録を 1 回の POST で完結させる。
// name は任意（空許容。normalizeName の既存仕様どおり「空は名無し」運用）。
export interface CreateUserRequest {
  email: string;
  name: string;
}

// POST /admin/api/users の応答。
export interface CreateUserResponse {
  user: UserDto;
}

// GET /admin/api/users/:id の応答。編集パネル（UserEditor）がマウント時に取得する。
// 一覧と同じ UserDto を返す（型を一本化し、食い違いをコンパイラに検出させる）。
export interface GetUserResponse {
  user: UserDto;
}

// ユーザー情報の更新リクエスト。管理者（PATCH /admin/api/users/:id）と、本人（PATCH /api/me）の
// 共通部分（name/email）を表す。本人経路はアバター操作を足した UpdateMeRequest を使う（下記）。
// - name: 表示名。検証は normalizeName が唯一の検証点（型不正だけ invalid_name=400。空・長すぎは正常系）。
// - email: メールアドレス。検証は normalizeEmail が唯一の検証点（形式不正は invalid_email=400、
//   他ユーザーと衝突は already_exists=409、現在値と同じなら no-op）。本人・管理者いずれの経路でも変更可。
//   OTP 再検証は要求しない。email を変更したら emailVerified を false にリセットし、
//   そのユーザーの既存セッションを全削除する（新メールは未検証。再ログインで検証し直す）。
// 更新系はどちらも成功時 204 No Content を返す（応答ボディは持たない）。
// 更新後は呼び出し側が一覧/自分情報の取得処理を再実行して最新状態を反映する
//（サーバーで正規化された確定値をそのまま画面へ反映でき、クライアント側での正規化の二重持ちを避ける）。
export interface UpdateUserRequest {
  name: string;
  email: string;
}

// 本人専用の更新リクエスト（PATCH /api/me）。name/email は UpdateUserRequest と同じ扱い。
// - avatarImageId: アバターの操作。本人だけが持つ概念のため管理者共有の UpdateUserRequest には載せない。
//   - キー自体を省略（undefined）… アバターは変更しない（表示名・メールだけの更新）。
//   - null を明示 … アバターの設定を外す（user.avatarImageId を NULL に戻す。実ファイルは消さない）。
//   ※新規アバターの「設定」はこの経路ではなく POST /api/images(usage='avatar') で行う（ここは解除専用）。
export interface UpdateMeRequest {
  name: string;
  email: string;
  avatarImageId?: null;
}

// --- 本人（ログインユーザー自身） ---

// 本人から見た自分の公開表現。GET /api/me の応答で使う。
// 管理判定(isAdmin)は本人向けには含めない（表示名変更に不要なため最小限に絞る）。
export interface MeDto {
  id: string;
  email: string;
  name: string;
  // 本人のアバター画像 id（image.id）。未設定なら null。設定画面のアイコン表示に使う。
  avatarImageId: string | null;
}

// GET /api/me の応答。
export interface MeResponse {
  user: MeDto;
}

// --- 部屋（Room DO） ---

// 部屋1件の公開表現。一覧・作成の応答で使う。deletedAt など内部列は出さない。
export interface RoomDto {
  id: string;
  name: string;
  createdAt: number; // epoch ms
}

// GET /admin/api/rooms の応答。管理画面の一覧は台帳の素の表現（RoomDto）だけでよい。
export interface ListRoomsResponse {
  rooms: RoomDto[];
}

// 部屋の「最新メッセージのサマリ」。待機画面（部屋一覧）のプレビュー行に使う。
// 真実の源は各 Room DO の履歴だが、一覧で部屋数ぶん DO を叩かずに済むよう、
// メッセージ保存時に D1 の room 台帳へ非正規化キャッシュした写しを返す。
// - body       : 最新メッセージ本文（text はそのまま、image は本文を持たないので表示側で振り分ける）。
// - sentAt     : 送信時刻（epoch ms）。相対表記（"5分前" 等）はクライアント側で算出する
//                （タイムゾーン・現在時刻に依存するためサーバーで固定しない）。
// - authorName : 送信者の表示名（authorId から user.name を解決した値。未設定は「名無し」）。
export interface RoomLastMessage {
  body: MessageBody;
  sentAt: number;
  authorName: string;
}

// 待機画面（部屋一覧）1 行分。台帳の RoomDto に最新メッセージのプレビューを足した表現。
// lastMessage が null の部屋はまだ 1 件も投稿が無い（待機画面は「まだメッセージがありません」を出す）。
export interface RoomListItem extends RoomDto {
  lastMessage: RoomLastMessage | null;
}

// GET /api/rooms（アプリの待機画面向け）の応答。管理向け ListRoomsResponse とは別に、
// 各部屋の最新メッセージ（lastMessage）を載せた行を返す。
export interface ListRoomsForAppResponse {
  rooms: RoomListItem[];
}

// GET /api/rooms/:id の応答（アプリのチャット画面が部屋名を引くのに使う）。
export interface GetRoomResponse {
  room: RoomDto;
}

// POST /api/rooms のリクエストボディ（部屋の新規作成）。
// name は部屋の表示名。検証は normalizeName が唯一の検証点（型不正は invalid_name=400、
// 空は不可＝400、長すぎは切り捨て）。id・createdAt はサーバーが採番する。
// 成功時サーバーは 204（ボディなし）。呼び出し側は GET /api/rooms の再取得で新しい部屋を反映する
//（updateMe と同じく「確定値は再取得で反映」に作法をそろえ、応答型の二重持ちを避ける）。
export interface CreateRoomRequest {
  name: string;
}

// PATCH /api/rooms/:id のリクエストボディ（部屋名の変更）。
// name は新しい表示名。検証は CreateRoomRequest と同じく normalizeName が唯一の検証点
// （型不正は invalid_name=400、空は不可＝400、長すぎは切り捨て）。
// 成功時サーバーは 204。呼び出し側は GET /api/rooms(/:id) の再取得で確定値を反映する。
export interface UpdateRoomRequest {
  name: string;
}

// --- 部屋のメッセージ（Room DO に蓄積されたチャット履歴） ---

// メッセージ本文。当面は text のみ。将来 type を増やして装飾に対応する。
// DO（サーバー）が保存・配信する形をそのまま管理画面へも共有する。
// 本文は text か image の 2 種のみ（未知 type は型レベルで拒否する）。
// - text : プレーンテキスト。
// - image: 本文には画像 id だけを載せる（寸法の真実の源は D1 image 表 = ImageDto）。
//   二重持ちを避けるため width/height は本文に持たせない（docs 5.2）。
// 将来 type を増やすときはこの union を明示的に広げる（素通し用のワイルドカードは持たない）。
export type MessageBody =
  | { type: 'text'; text: string }
  | { type: 'image'; imageId: string };

// POST /api/rooms/:id/messages のリクエストボディ（アプリのテキスト送信）。
// メッセージ送信は HTTP に一本化する（WebSocket は受信=配信専用）。本文は MessageBody を載せる。
// テキストは { type:'text', text } を送る。画像は POST /api/images(usage='chat', roomId) 側で
// サーバーがメッセージ化するため、この経路では送らない（text 専用の入口）。
// authorId はセッションから解決するためクライアントは送らない。
// 送信の可否（WebSocket 接続中のみ送れる等）はクライアントの UX 判断であり、サーバーは関与しない。
export interface SendMessageRequest {
  body: MessageBody;
}

// サーバー(DO)が配信・履歴で吐く「メッセージ1件の公開表現（DTO）」。seq は DO が採番する連番。
// 同じ API（DO の /history・WS 配信）を、サーバー・管理画面・アプリが同じ形で受け取るための
// 唯一の契約。各プロジェクトでワイヤー型を再定義しない（食い違いを構造的に防ぐ）。
// authorName は authorId から D1 の user.name を解決した値（未設定は「名無し」）。
// avatarImageId は authorId から D1 の user.avatarImageId を解決した値（未設定は null）。
//   authorName と同じく保持せず配信・履歴の直前に解決するため、改名・アイコン差し替えが即反映される
//   （バイナリ・状態は持たずキーだけ）。
// sentAt は epoch ms。
export interface ChatMessageDto {
  seq: number;
  authorId: string;
  authorName: string;
  avatarImageId: string | null;
  body: MessageBody;
  sentAt: number;
}

// GET /admin/api/rooms/:id/messages のクエリ。DO の履歴カーソルをそのまま公開する。
// - limit: 取得件数（1〜100）。省略時はサーバー既定の直近 N 件。
// - before: この seq より古い側へ遡る（履歴ページング）。省略時は最新側から。
// サーバーの内部取得（fetchRoomMessagesDO）とクライアント（listRoomMessages）で共有し、
// 引数の形の出所を一本化する（片方だけ変えて食い違う事故をコンパイラが検出する）。
export interface ListRoomMessagesQuery {
  limit?: number;
  before?: number;
}

// GET /admin/api/rooms/:id/messages の応答。
// DO の履歴取得（/history）をそのまま束ねる。messages は seq 昇順（古い→新しい）。
// hasMore は「まだ古いメッセージが残っているか」（true なら before で遡れる）。
export interface ListRoomMessagesResponse {
  messages: ChatMessageDto[];
  hasMore: boolean;
}

// --- 画像アップロード基盤（avatar / chat 共通。docs/image-upload-decisions.md） ---

// 画像の用途。同じ 1 つの基盤で扱い、用途を増やすときはここへ足すだけにする。
// - 'avatar': ユーザーアイコン（user.avatarImageId から 1 枚を参照）。
// - 'chat'  : チャット画像（MessageBody の image から imageId で参照）。
// （将来）'album' などを足す場合もこの union を広げるだけで基盤に載る。
export type ImageUsage = 'avatar' | 'chat';

// アプリ配信 GET /api/images/:id?variant=... の variant。
// - 'thumb': 一覧・チャット内などの通常表示用サムネ。
// - 'full' : タップ等の拡大表示用オリジナル。
// variant は省略不可（クライアントは必ず指定する。省略はサーバーで 400）。
export type ImageVariant = 'thumb' | 'full';

// 画像 1 件の公開表現（メタ）。バイナリは含まない（配信は GET /api/images/:id）。
// width/height/bytes は「配信用オリジナル（orig）」の確定値（真実の源は D1）。
// 検閲は行わず、アップロード直後から全員へ公開する（状態・検閲メタは持たない）。
export interface ImageDto {
  id: string;
  ownerId: string;
  usage: ImageUsage;
  mime: string; // サーバー再圧縮後の確定 MIME（image/webp）
  width: number; // orig の幅（px）
  height: number; // orig の高さ（px）
  bytes: number; // orig のサイズ（byte）
  createdAt: number; // epoch ms
}

// POST /api/images の応答。id・width/height 等を ImageDto で返す。
export interface UploadImageResponse {
  image: ImageDto;
}

// --- プッシュ通知（端末登録・管理者からの送信。docs/push-notification-poc-decisions.md） ---

// 端末（Expo Push Token）のプラットフォーム。記録用（配信の出し分けには使わない）。
export type PushPlatform = 'ios' | 'android';

// POST /api/devices のリクエストボディ（本人の端末を通知有効化＝登録する）。
// token はアプリが取得した Expo Push Token（ExponentPushToken[...]）。
// userId はサーバーがセッションから解決するためクライアントは送らない。
// 通知の「無効化」はこの経路ではなく DELETE /api/devices（token 指定）で行う（物理削除）。
export interface RegisterDeviceRequest {
  token: string;
  platform: PushPlatform;
}

// DELETE /api/devices のリクエストボディ（本人の端末を通知無効化＝物理削除する）。
// 自分が所有する token だけ消せる（userId はセッションで確定し、一致しない token は消さない）。
export interface UnregisterDeviceRequest {
  token: string;
}

// GET /api/devices/status?token=... の応答。設定画面が現在の端末の状態を初期表示するのに使う。
// enabled は「この token が push_token 台帳に存在するか（＝通知有効か）」。存在＝有効の一元表現。
export interface DeviceStatusResponse {
  enabled: boolean;
}

// POST /admin/api/users/:id/push のリクエストボディ（管理者が指定ユーザーの全端末へ送る）。
// title / body は通知の見出し・本文。PoC では管理者が任意の文言で送信できる。
export interface AdminPushRequest {
  title: string;
  body: string;
}

// POST /admin/api/users/:id/push の応答。
// sent は Expo へ送信を試みた端末数、removed は DeviceNotRegistered で掃除した端末数。
export interface AdminPushResponse {
  sent: number;
  removed: number;
}

// --- 部屋ごと・ユーザー個別の通知ミュート（docs/room-mute-notification-decisions.md） ---

// GET /api/rooms/:id/notification の応答。チャット画面ヘッダーのベル表示の初期値に使う。
// muted は「この部屋を自分がミュートしているか（＝通知 OFF か）」。既定は false（通知 ON）。
// 判定は userId 単位（サーバーがセッションから解決する。端末ではなくユーザーの意思）。
export interface RoomNotificationResponse {
  muted: boolean;
}

// PUT /api/rooms/:id/notification のリクエストボディ（この部屋の通知 ON/OFF を切り替える）。
// muted=true でミュート（通知 OFF）、false で解除（通知 ON）。userId はセッションで確定するため送らない。
export interface UpdateRoomNotificationRequest {
  muted: boolean;
}
