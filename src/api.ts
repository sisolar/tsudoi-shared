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

// ユーザー情報の更新リクエスト。本人（PATCH /api/me）と管理者（PATCH /admin/api/users/:id）で共有する。
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

// GET /admin/api/rooms の応答。
export interface ListRoomsResponse {
  rooms: RoomDto[];
}

// GET /api/rooms/:id の応答（アプリのチャット画面が部屋名を引くのに使う）。
export interface GetRoomResponse {
  room: RoomDto;
}

// POST /admin/api/rooms のリクエストボディ。
export interface CreateRoomRequest {
  name: string;
}

// POST /admin/api/rooms の応答。
export interface CreateRoomResponse {
  room: RoomDto;
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

// メッセージ1件の公開表現。seq は DO が採番する連番。
// authorName は authorId から D1 の user.name を解決した値（未設定は「名無し」）。
// sentAt は epoch ms。管理画面の一覧・アプリの配信/履歴で同じ形を共有する。
export interface AdminChatMessage {
  seq: number;
  authorId: string;
  authorName: string;
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
  messages: AdminChatMessage[];
  hasMore: boolean;
}

// --- 画像アップロード基盤（avatar / chat 共通。docs/image-upload-decisions.md） ---

// 画像の用途。同じ 1 つの基盤で扱い、用途を増やすときはここへ足すだけにする。
// - 'avatar': ユーザーアイコン（user.avatarImageId から 1 枚を参照）。
// - 'chat'  : チャット画像（MessageBody の image から imageId で参照）。
// （将来）'album' などを足す場合もこの union を広げるだけで基盤に載る。
export type ImageUsage = 'avatar' | 'chat';

// 検閲状態（状態の真実の源は D1 image 表）。
// - 'pending' : 検閲待ち。他ユーザーへはぼかしサムネのみ、本人には通常サムネ/原寸。
// - 'approved': 承認済み。全員へ通常サムネ/原寸を公開。
// - 'rejected': 却下。アプリ配信（/api/images）は本人・他人とも全 variant で停止する。
//   実体（R2 の 3 種・D1 行）は削除しない（再審査・監査のため残す）。管理者の raw 経路でのみ閲覧可。
export type ImageStatus = 'pending' | 'approved' | 'rejected';

// アプリ配信 GET /api/images/:id?variant=... の variant。
// - 'thumb': 一覧・チャット内などの通常表示用サムネ。
// - 'full' : タップ等の拡大表示用オリジナル。
// variant は省略不可（クライアントは必ず指定する。省略はサーバーで 400）。
export type ImageVariant = 'thumb' | 'full';

// 画像 1 件の公開表現（メタ）。バイナリは含まない（配信は GET /api/images/:id）。
// width/height/bytes は「配信用オリジナル（orig）」の確定値（真実の源は D1）。
export interface ImageDto {
  id: string;
  ownerId: string;
  usage: ImageUsage;
  status: ImageStatus;
  mime: string; // サーバー再圧縮後の確定 MIME（image/webp）
  width: number; // orig の幅（px）
  height: number; // orig の高さ（px）
  bytes: number; // orig のサイズ（byte）
  createdAt: number; // epoch ms
  reviewedAt: number | null; // 検閲時刻。未検閲は null
  reviewedBy: string | null; // 検閲した管理者の user.id。未検閲は null
}

// POST /api/images の応答。id・status・width/height 等を ImageDto で返す。
export interface UploadImageResponse {
  image: ImageDto;
}

// GET /admin/api/images の応答（検閲キュー／一覧）。古い順（検閲待ちを先に）。
export interface ListImagesResponse {
  images: ImageDto[];
}

// GET /admin/api/images/:id の応答（検閲パネル用の 1 件メタ取得）。
export interface GetImageResponse {
  image: ImageDto;
}
