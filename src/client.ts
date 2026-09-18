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
  GetRoomResponse,
  ImageDto,
  ImageStatus,
  ImageUsage,
  ImageVariant,
  ListImagesResponse,
  ListRoomsResponse,
  MeDto,
  MeResponse,
  RoomDto,
  UpdateUserRequest,
  UploadImageResponse,
} from '@shared/api';

// 追加ヘッダの型。Cookie など単純なキー・値だけを扱う（スプレッドで合流できる形に絞る）。
export type ExtraHeaders = Record<string, string>;

export interface ApiClientOptions {
  baseUrl: string;
  getHeaders?: () => Promise<ExtraHeaders> | ExtraHeaders;
}

export interface ApiClient {
  // 自分の情報を取得する（設定画面の初期値など）。失敗時は例外を投げる。
  fetchMe(): Promise<MeDto>;
  // 自分のプロフィール（表示名・メール）を更新する。成功時サーバーは 204。
  updateMe(req: UpdateUserRequest): Promise<void>;
  // 有効な部屋を新しい順に取得する。
  fetchRooms(): Promise<RoomDto[]>;
  // 単一の部屋情報を取得する。存在しない id は 404 → 例外。
  fetchRoom(id: string): Promise<RoomDto>;

  // --- 画像アップロード基盤（アプリ・admin-ui 共通） ---
  // 画像をアップロードする唯一の入口。multipart/form-data（file + usage）で送る。
  // avatar のときサーバーが user.avatarImageId を張り替える。応答は確定した ImageDto。
  // file はプラットフォーム非依存の Blob（RN の { uri, name, type } は呼び出し側で Blob 化するか、
  // FormData に直接載せてから formData 引数で渡す）。ここでは Blob/File を受ける。
  uploadImage(file: Blob, usage: ImageUsage, filename?: string): Promise<ImageDto>;
  // 画像バイナリの配信 URL を組み立てる（<Image source={{uri}}> 等に渡す）。variant は省略不可。
  // 実体の出し分け（本人/他人・status）はサーバーが決めるため、URL は id と variant だけで足りる。
  imageUrl(id: string, variant: ImageVariant): string;

  // --- 管理者専用（admin-ui の画像管理画面からのみ） ---
  // 画像一覧（検閲キュー）。status 指定で絞る（省略時は全件）。古い順で返る。
  listImages(status?: ImageStatus): Promise<ImageDto[]>;
  // 承認。全員へ通常サムネ/原寸を公開する。
  approveImage(id: string): Promise<void>;
  // 却下。アプリ配信を停止する（実体は残す）。
  rejectImage(id: string): Promise<void>;
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
      const data = (await res.json()) as Partial<ListRoomsResponse>;
      return data.rooms ?? [];
    },
    async fetchRoom(id) {
      const res = await request(`/api/rooms/${id}`);
      const data = (await res.json()) as Partial<GetRoomResponse>;
      if (!data.room) throw new Error('room not found');
      return data.room;
    },

    async uploadImage(file, usage, filename) {
      // multipart/form-data で送る。content-type は fetch が boundary 付きで自動設定するため、
      // ここで手動指定しない（指定すると boundary が欠けて受信側でパースに失敗する）。
      const form = new FormData();
      form.append('usage', usage);
      form.append('file', file, filename);
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

    async listImages(status) {
      const path = status ? `/admin/api/images?status=${status}` : '/admin/api/images';
      const res = await request(path);
      const data = (await res.json()) as Partial<ListImagesResponse>;
      return data.images ?? [];
    },
    async approveImage(id) {
      await request(`/admin/api/images/${id}/approve`, { method: 'POST' });
    },
    async rejectImage(id) {
      await request(`/admin/api/images/${id}/reject`, { method: 'POST' });
    },
  };
}
