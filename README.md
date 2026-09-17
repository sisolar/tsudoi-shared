# tsudoi-shared

tsudoi の共有コード。**サーバー（tsudoi-server）・管理画面（admin-ui）・アプリ（tsudoi-app）の
3 プロジェクトで「1 つの実装」を共有する**ための、純粋な型・関数だけを置く。

- DOM / Node / Cloudflare Workers いずれにも依存しない（どのランタイムからも安全に import できる）。
- ここに実装が 1 つあることで、検証ロジックの二重定義による食い違いを構造的に防ぐ
  （設計思想は `docs/user-profile-edit-decisions.md` 2.1）。

## 構成

- `src/admin-api.ts` — 管理 API / 本人 API のリクエスト・レスポンス契約型。
- `src/validation.ts` — 入力の正規化・検証（`normalizeName` / `normalizeEmail` / `NAME_MAX_LENGTH`）。
- `src/index.ts` — 公開エントリ（barrel）。

## import 方法

各プロジェクトは `@shared/*` エイリアスでこのリポジトリの `src/*` を参照する。

```ts
import type { UserDto } from '@shared/admin-api';
import { normalizeEmail } from '@shared/validation';
```

## 配布形態（Git サブモジュール）

このリポジトリは各プロジェクトの内部に `shared/` としてマウントされる（サブモジュール）。

```
tsudoi-server/shared/   ← このリポジトリ
tsudoi-app/shared/      ← このリポジトリ（別クローン）
```

セットアップ手順は各プロジェクトの `docs/`（`shared-submodule-setup.md`）を参照。
