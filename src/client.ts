// tsudoi の HTTP API クライアント。サーバー（GET/PATCH /api/me・GET /api/rooms(/:id)）を
// 叩く実装を 1 つに集約し、サーバー・管理画面（admin-ui）・アプリ（tsudoi-app）で共有する
// （fetch とエラー処理の二重持ちを避ける）。
//
// ランタイム差（接続先・認証ヘッダ）は依存注入で吸収する:
// - baseUrl:    接続先オリジン（例: `https://${HOST}`）。末尾スラッシュは付けない。
// - getHeaders: 各リクエストに合流させる追加ヘッダを返す注入点。呼ばれる度に評価する。
//   ネイティブ（アプリ）には Cookie ストアが無いため、Better Auth が SecureStore に保管した
//   セッション Cookie を手動で Cookie ヘッダへ載せる。ブラウザ（admin-ui）は Cookie が
//   自動送信されるため省略できる。
//
// 契約型は公開エイリアス @shared/api を経由して取り込む（相対 ./api への直 import はしない）。
// これで消費側 3 プロジェクトすべてが同じ入口で型を共有し、参照の出所を一本化できる。
//
// fetch / Response はどのランタイム（RN・ブラウザ・Workers・Node18+）にもグローバルで存在する。
// 型解決のためだけに shared の tsconfig の lib に "dom" を含めている（実行時依存は無い）。
import type {
  AllUsersResponse,
  ChatMessageDto,
  DeviceStatusResponse,
  GetAppUserResponse,
  GetRoomResponse,
  ImageDto,
  ImageUsage,
  ImageVariant,
  ListRoomsForAppResponse,
  MarkReadRequest,
  MeDto,
  MentionCandidate,
  MeResponse,
  MessageResponse,
  ThreadResponse,
  MutedRoomsResponse,
  RoomMembersResponse,
  MyReadsResponse,
  PushPlatform,
  ReadCursor,
  ReadReceipt,
  RegisterDeviceRequest,
  RoomSummary,
  RoomNotificationResponse,
  RoomReadsResponse,
  RoomVisibility,
  CreateRoomRequest,
  SendMessageRequest,
  UnregisterDeviceRequest,
  UpdateMeRequest,
  UpdateRoomNotificationRequest,
  UpdateRoomRequest,
  UploadImageResponse,
} from '@shared/api';
import type {
  CreateSnsPostRequest,
  SnsProfile,
  SnsProfileResponse,
  SnsPostsResponse,
  SnsPhotosResponse,
} from '@shared/sns';

// 追加ヘッダの型。Cookie など単純なキー・値だけを扱う（スプレッドで合流できる形に絞る）。
export type ExtraHeaders = Record<string, string>;

export interface ApiClientOptions {
  baseUrl: string;
  getHeaders?: () => Promise<ExtraHeaders> | ExtraHeaders;
}

export interface ApiClient {
  // 自分の情報を取得する（設定画面の初期値など）。失敗時は例外を投げる。
  fetchMe(): Promise<MeDto>;
  // 自分のプロフィール（表示名・メール・アバター解除）を更新する。成功時サーバーは 204。
  // avatarImageId に null を渡すとアバターの設定を外す（省略時はアバターを変更しない）。
  updateMe(req: UpdateMeRequest): Promise<void>;
  // 有効な部屋を新しい順に取得する（待機画面用に各部屋の最新メッセージ lastMessage 付き）。
  fetchRooms(): Promise<RoomSummary[]>;
  // 単一の部屋情報を取得する（部屋の素データ room ＋ 限定公開部屋のメンバー数 memberCount）。
  // memberCount は public 部屋では null（数える意味がない）。存在しない id は 404 → 例外。
  fetchRoom(id: string): Promise<GetRoomResponse>;
  // メンション候補ユーザーの一覧を取得する（コンポーザの「メンション追加」シート用。
  // docs/mention-decisions.md）。public 部屋は全登録ユーザー、private 部屋はその部屋の参加者だけを返す
  // （サーバーが visibility で絞る。呼び出し側で自分を除外して表示する）。
  fetchRoomMembers(roomId: string): Promise<MentionCandidate[]>;
  // 全登録ユーザーの一覧を取得する（メンバー選択画面の候補＝部屋非依存。docs/room-visibility-decisions.md 5.1）。
  // UserPickerSheet の候補として親（RoomSettings）が渡す。メンション用途は fetchRoomMembers を使い分ける。
  fetchAllUsers(): Promise<MentionCandidate[]>;
  // 単一ユーザーを取得する（部屋非依存。SNS プロフィール画面が userId から名前・アイコンを実データで
  // 解決するのに使う）。存在しない id は 404 → 例外。全登録一覧（fetchAllUsers）と同じ公開表現を返す。
  fetchUser(id: string): Promise<MentionCandidate>;
  // 部屋を新規作成する（表示名 name・公開範囲 visibility を渡す。id・createdAt はサーバーが採番）。
  // private のとき memberIds（選択メンバー）を渡す（作成者はサーバーが必ず含める。public では無視）。
  // 成功時サーバーは 204。応答ボディは持たないため、呼び出し側は fetchRooms() の再取得で反映する。
  createRoom(name: string, visibility: RoomVisibility, memberIds?: string[]): Promise<void>;
  // 部屋名（表示名）・公開範囲・メンバーを変更する。private のとき memberIds は置き換え集合。成功時サーバーは 204。
  // 呼び出し側は fetchRoom(id) / fetchRooms() の再取得で確定値（正規化後）を反映する。
  updateRoom(
    id: string,
    name: string,
    visibility: RoomVisibility,
    memberIds?: string[],
  ): Promise<void>;
  // テキストメッセージを送信する（送信は HTTP に一本化。WebSocket は受信=配信専用）。
  // 成功時サーバーは 204。自分の吹き出しはサーバーからの WS 配信で表示される。
  // replyTo を渡すと「その seq への返信」として送る（docs/reply-decisions.md）。実在確認は
  // サーバー（DO）が行い、存在しない seq は落とす。省略時は通常メッセージ。
  sendTextMessage(roomId: string, text: string, replyTo?: number): Promise<void>;
  // 単一メッセージ（seq 指定）を取得する（返信の引用チップが引用元 1 件を引くのに使う。
  // docs/reply-decisions.md 3.1）。存在しない seq は 404 → 例外。
  fetchRoomMessage(roomId: string, seq: number): Promise<ChatMessageDto>;
  // スレッド全件を取得する（スレッド画面。docs/reply-decisions.md 6 章）。渡した seq から
  // サーバーが起点（ルート）seq を探し、起点に紐づく全メッセージを seq 昇順で返す。
  fetchRoomThread(roomId: string, seq: number): Promise<ThreadResponse>;

  // --- 画像アップロード基盤（アプリ・admin-ui 共通） ---
  // 画像をアップロードする唯一の入口。multipart/form-data（file + usage）で送る。
  // avatar のときサーバーが user.avatarImageId を張り替える。応答は確定した ImageDto。
  // chat のとき roomId を渡すと、サーバーがアップロードと同じリクエストの中でその部屋の
  // Room DO へ画像メッセージ（{type:'image', imageId}）を保存する
  //（チャット画像の送信は HTTP に一本化。WS で id を送り直さない）。
  // file は Blob（型で受ける）。実体はブラウザの File か、アプリ（RN）の expo-file-system File を渡す
  //（いずれも Blob 実装で、FormData の 'file' パートへそのまま載る。type から content-type が決まる）。
  uploadImage(file: Blob, usage: ImageUsage, roomId?: string): Promise<ImageDto>;
  // 画像バイナリの配信 URL を組み立てる（<Image source={{uri}}> 等に渡す）。variant は省略不可。
  // 画像は検閲せず全員へ公開するため、URL は id と variant だけで足りる。
  imageUrl(id: string, variant: ImageVariant): string;

  // --- プッシュ通知の端末登録（本人向け。docs/push-notification-poc-decisions.md） ---
  // この端末（Expo Push Token）の通知を有効化する（登録する）。既存 token の再登録は upsert。
  registerDevice(token: string, platform: PushPlatform): Promise<void>;
  // この端末の通知を無効化する（その token を物理削除する）。存在しなくても成功扱い。
  unregisterDevice(token: string): Promise<void>;
  // この端末の現在の通知状態（有効か）を取得する。設定画面のトグル初期値に使う。
  getDeviceStatus(token: string): Promise<boolean>;

  // --- 部屋ごと・ユーザー個別の通知ミュート（本人向け。docs/room-mute-notification-decisions.md） ---
  // この部屋を自分がミュートしているか（＝通知 OFF か）を取得する。ヘッダーのベル表示の初期値に使う。
  getRoomNotification(roomId: string): Promise<boolean>;
  // この部屋の通知 ON/OFF を切り替える。muted=true でミュート、false で解除。成功時サーバーは 204。
  setRoomNotification(roomId: string, muted: boolean): Promise<void>;
  // 自分がミュートしている部屋 id の一覧を取得する。待機画面がベルアイコン表示に使う。
  fetchMutedRoomIds(): Promise<string[]>;

  // --- 既読（本人向け。docs/read-receipt-decisions.md） ---
  // 自分の全部屋の既読カーソルを取得する（fetchMutedRoomIds と対称）。待機画面が未読件数
  // max(0, (lastMessage?.seq ?? 0) - lastReadSeq) を算出するのに使う。カーソルの無い部屋は含まれない。
  fetchMyReads(): Promise<ReadCursor[]>;
  // この部屋を seq まで読んだと記録する（read_cursor を max(既存, seq) で upsert）。成功時 204。
  // 表示済みの最大 seq を渡す。userId はサーバーがセッションから解決する。
  markRead(roomId: string, seq: number): Promise<void>;
  // その部屋の全員分の既読カーソルを取得する（チャット画面マウント時の初期同期）。
  // 以後は WS の read イベントで差分更新する。自分自身も含まれ得る（描画側で除外する）。
  fetchRoomReads(roomId: string): Promise<ReadReceipt[]>;

  // --- SNS つぶやき（docs/sns-post-decisions.md） ---
  // 指定ユーザーの SNS プロフィール（名前・アイコンだけ）を取得する。投稿・写真は別メソッドで
  // ページング取得する。存在しない id は 404 → 例外。
  fetchSnsProfile(userId: string): Promise<SnsProfile>;
  // 指定ユーザーのつぶやきを新しい順にページング取得する（{ posts, hasMore }）。
  // before に「前ページ末尾の投稿」を渡すと、その (createdAt, id) より古いものを limit 件返す
  //（複合カーソル。同一ミリ秒の取りこぼし/重複を防ぐ）。省略時は最新から。存在しない id は 404 → 例外。
  fetchSnsPosts(
    userId: string,
    opts?: { before?: { createdAt: number; id: string }; limit?: number },
  ): Promise<SnsPostsResponse>;
  // 指定ユーザーの添付画像（アルバム）を新しい順にページング取得する（{ photos, hasMore }）。
  // before に「前ページ末尾の写真」を渡すと、その (createdAt, postId, position) より後（古い側）を limit 件
  // 返す（複合カーソル）。省略時は最新から。存在しない id は 404 → 例外。
  fetchSnsPhotos(
    userId: string,
    opts?: {
      before?: { createdAt: number; postId: string; position: number };
      limit?: number;
    },
  ): Promise<SnsPhotosResponse>;
  // 自分のつぶやきを投稿する（本文 text＋事前アップロード済みの imageIds を 1 リクエストでまとめて送る）。
  // authorId はサーバーがセッションから確定する（クライアントは送らない）。成功時サーバーは 204。
  // 応答ボディは持たないため、呼び出し側は fetchSnsPosts の再取得で反映する（createRoom と同じ思想）。
  createSnsPost(text: string, imageIds: string[]): Promise<void>;
}

export function createApiClient({ baseUrl, getHeaders }: ApiClientOptions): ApiClient {
  // 共通の fetch。認証ヘッダの合流・非 2xx の例外化を 1 か所に集約する。
  async function request(
    path: string,
    init?: { method?: string; headers?: ExtraHeaders; body?: string },
  ): Promise<Response> {
    const extra = getHeaders ? await getHeaders() : undefined;
    const res = await fetch(`${baseUrl}${path}`, {
      method: init?.method,
      headers: { ...extra, ...init?.headers },
      body: init?.body,
    });
    if (!res.ok) throw new Error(`request ${path} failed: ${res.status}`);
    return res;
  }

  return {
    async fetchMe() {
      const res = await request('/api/me');
      const data = (await res.json()) as Partial<MeResponse>;
      if (!data.user) throw new Error('me not found');
      return data.user;
    },
    async updateMe(req) {
      await request('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async fetchRooms() {
      const res = await request('/api/rooms');
      const data = (await res.json()) as Partial<ListRoomsForAppResponse>;
      return data.rooms ?? [];
    },
    async fetchRoom(id) {
      const res = await request(`/api/rooms/${id}`);
      const data = (await res.json()) as Partial<GetRoomResponse>;
      if (!data.room) throw new Error('room not found');
      return { room: data.room, memberCount: data.memberCount ?? null };
    },
    async fetchRoomMembers(roomId) {
      const res = await request(`/api/rooms/${roomId}/members`);
      const data = (await res.json()) as Partial<RoomMembersResponse>;
      return data.members ?? [];
    },
    async fetchAllUsers() {
      const res = await request('/api/users');
      const data = (await res.json()) as Partial<AllUsersResponse>;
      return data.users ?? [];
    },
    async fetchUser(id) {
      const res = await request(`/api/users/${id}`);
      const data = (await res.json()) as Partial<GetAppUserResponse>;
      if (!data.user) throw new Error('user not found');
      return data.user;
    },
    async createRoom(name, visibility, memberIds) {
      // memberIds は private のときだけ載せる（public では無視されるため送らない）。
      const req: CreateRoomRequest =
        visibility === 'private' ? { name, visibility, memberIds: memberIds ?? [] } : { name, visibility };
      await request('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async updateRoom(id, name, visibility, memberIds) {
      const req: UpdateRoomRequest =
        visibility === 'private' ? { name, visibility, memberIds: memberIds ?? [] } : { name, visibility };
      await request(`/api/rooms/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async sendTextMessage(roomId, text, replyTo) {
      // replyTo は返信のときだけ載せる（省略時は通常メッセージ。サーバーが実在確認する）。
      const req: SendMessageRequest = replyTo
        ? { body: { type: 'text', text }, replyTo }
        : { body: { type: 'text', text } };
      await request(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async fetchRoomMessage(roomId, seq) {
      const res = await request(`/api/rooms/${roomId}/messages/${seq}`);
      const data = (await res.json()) as Partial<MessageResponse>;
      if (!data.message) throw new Error('message not found');
      return data.message;
    },
    async fetchRoomThread(roomId, seq) {
      const res = await request(`/api/rooms/${roomId}/thread?seq=${seq}`);
      const data = (await res.json()) as Partial<ThreadResponse>;
      // rootSeq が無い応答は不正（サーバーは必ず起点 seq を返す）。messages は空もあり得る。
      if (typeof data.rootSeq !== 'number') throw new Error('thread not found');
      return { rootSeq: data.rootSeq, messages: data.messages ?? [] };
    },

    async uploadImage(file, usage, roomId) {
      // multipart/form-data で送る。content-type は fetch が boundary 付きで自動設定するため、
      // ここで手動指定しない（指定すると boundary が欠けて受信側でパースに失敗する）。
      const form = new FormData();
      form.append('usage', usage);
      // file（Blob/File）をそのまま 'file' パートへ載せる。File なら filename・type を保持し、
      // 受信側で File として復元できる。content-type は Blob の type から載る。
      form.append('file', file);
      // chat のときだけ roomId を載せる（サーバーが同リクエストでメッセージ化する）。
      if (roomId) form.append('roomId', roomId);
      const extra = getHeaders ? await getHeaders() : undefined;
      const res = await fetch(`${baseUrl}/api/images`, {
        method: 'POST',
        headers: { ...extra },
        body: form,
      });
      if (!res.ok) throw new Error(`upload image failed: ${res.status}`);
      const data = (await res.json()) as Partial<UploadImageResponse>;
      if (!data.image) throw new Error('image not returned');
      return data.image;
    },
    imageUrl(id, variant) {
      return `${baseUrl}/api/images/${id}?variant=${variant}`;
    },

    async registerDevice(token, platform) {
      const req: RegisterDeviceRequest = { token, platform };
      await request('/api/devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async unregisterDevice(token) {
      const req: UnregisterDeviceRequest = { token };
      await request('/api/devices', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async getDeviceStatus(token) {
      const res = await request(`/api/devices/status?token=${encodeURIComponent(token)}`);
      const data = (await res.json()) as Partial<DeviceStatusResponse>;
      return data.enabled ?? false;
    },

    async getRoomNotification(roomId) {
      const res = await request(`/api/rooms/${roomId}/notification`);
      const data = (await res.json()) as Partial<RoomNotificationResponse>;
      // 応答が欠けても安全側（通知 ON = ミュートなし）に倒す。
      return data.muted ?? false;
    },
    async setRoomNotification(roomId, muted) {
      const req: UpdateRoomNotificationRequest = { muted };
      await request(`/api/rooms/${roomId}/notification`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async fetchMutedRoomIds() {
      const res = await request('/api/rooms/mutes');
      const data = (await res.json()) as Partial<MutedRoomsResponse>;
      return data.roomIds ?? [];
    },

    async fetchMyReads() {
      const res = await request('/api/rooms/reads');
      const data = (await res.json()) as Partial<MyReadsResponse>;
      return data.cursors ?? [];
    },
    async markRead(roomId, seq) {
      const req: MarkReadRequest = { seq };
      await request(`/api/rooms/${roomId}/read`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    async fetchRoomReads(roomId) {
      const res = await request(`/api/rooms/${roomId}/reads`);
      const data = (await res.json()) as Partial<RoomReadsResponse>;
      return data.reads ?? [];
    },

    async fetchSnsProfile(userId) {
      const res = await request(`/api/sns/users/${userId}`);
      const data = (await res.json()) as Partial<SnsProfileResponse>;
      if (!data.profile) throw new Error('sns profile not found');
      return data.profile;
    },
    async fetchSnsPosts(userId, opts) {
      const params = new URLSearchParams();
      if (opts?.before) {
        params.set('beforeCreatedAt', String(opts.before.createdAt));
        params.set('beforeId', opts.before.id);
      }
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      const query = params.toString();
      const res = await request(`/api/sns/users/${userId}/posts${query ? `?${query}` : ''}`);
      const data = (await res.json()) as Partial<SnsPostsResponse>;
      return { posts: data.posts ?? [], hasMore: !!data.hasMore };
    },
    async fetchSnsPhotos(userId, opts) {
      const params = new URLSearchParams();
      if (opts?.before) {
        params.set('beforeCreatedAt', String(opts.before.createdAt));
        params.set('beforePostId', opts.before.postId);
        params.set('beforePosition', String(opts.before.position));
      }
      if (opts?.limit != null) params.set('limit', String(opts.limit));
      const query = params.toString();
      const res = await request(`/api/sns/users/${userId}/photos${query ? `?${query}` : ''}`);
      const data = (await res.json()) as Partial<SnsPhotosResponse>;
      return { photos: data.photos ?? [], hasMore: !!data.hasMore };
    },
    async createSnsPost(text, imageIds) {
      const req: CreateSnsPostRequest = { text, imageIds };
      await request('/api/sns/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
  };
}
