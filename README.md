# tsudoi-shared

tsudoi の共有コード。**サーバー（tsudoi-server）・管理画面（admin-ui）・アプリ（tsudoi-app）の
3 プロジェクトで「1 つの実装」を共有する**ための、純粋な型・関数だけを置く。

- 特定ランタイム（Node / Cloudflare Workers / React Native）固有の API に依存しない。
  HTTP クライアントはどのランタイムにもあるグローバル `fetch` だけを使い、接続先・認証ヘッダは
  依存注入で受け取る（ランタイム差は各プロジェクトが吸収する）。
- ここに実装が 1 つあることで、検証ロジックの二重定義による食い違いを構造的に防ぐ
  （設計思想は `docs/user-profile-edit-decisions.md` 2.1）。

## 構成

- `src/api.ts` — API のリクエスト・レスポンス契約型（管理者向け・本人向け・部屋など）。
- `src/chat.ts` — チャットの画面表示用の型・ヘルパー（`ChatMessage` / `bodyText`）。本文型は `api.ts` の `MessageBody` を使う。
- `src/sns.ts` — SNS プロフィール画面の表示用の型（`SnsProfile` / `SnsPost` / `SnsStats`）。投稿本文は `api.ts` の `MessageBody` を再利用する。
- `src/client.ts` — API を叩く HTTP クライアント（`createApiClient`）。接続先・認証ヘッダは
  依存注入（`baseUrl` / `getHeaders`）で受け取り、ランタイム差を各プロジェクトが吸収する。
- `src/validation.ts` — 入力の正規化・検証（`normalizeName` / `normalizeEmail` / `NAME_MAX_LENGTH`）。

## import 方法

各プロジェクトは `@shared/*` エイリアスでこのリポジトリの `src/*` を参照する。

```ts
import type { UserDto } from '@shared/api';
import { createApiClient } from '@shared/client';
import { normalizeEmail } from '@shared/validation';
```

## 配布形態（Git サブモジュール）

このリポジトリは各プロジェクトの内部に `shared/` としてマウントされる（サブモジュール）。

```
tsudoi-server/shared/   ← このリポジトリ
tsudoi-app/shared/      ← このリポジトリ（別クローン）
```

セットアップ手順は各プロジェクトの `docs/`（`shared-submodule-setup.md`）を参照。
