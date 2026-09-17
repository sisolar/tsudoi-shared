// 管理APIのリクエスト/レスポンス契約。サーバー(src/admin.ts, src/rooms.ts)と
// 管理画面(admin-ui/src/api.ts)の「両方」から import して共有する。
//
// ここには Cloudflare Workers / DOM 依存の型を書かない（純粋な型のみ）。
// そうすることで、workers-types を持たない admin-ui からも安全に import でき、
// プロパティ名の食い違い（例: name を title と書く等）をコンパイラが両側で検出できる。

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
