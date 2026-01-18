# npx crew 公開計画

## 現状

- **既存インフラ**: `npx-cli/` に完全なCLIパッケージが実装済み
- **パッケージ名**: `crew`
- **インフラ状況**: 未設定（R2バケット、GitHub Secrets）

---

## 必要な設定ステップ

### Step 1: Cloudflare R2 バケットの作成

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. R2 → Create bucket
3. バケット名: 例 `crew-binaries`
4. **APIトークンを作成**:
   - R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - 以下をメモ:
     - Access Key ID
     - Secret Access Key
     - Endpoint URL (例: `https://<account-id>.r2.cloudflarestorage.com`)

5. **パブリックアクセスを有効化**:
   - バケット設定 → Public Access → Allow
   - Public URL をメモ (例: `https://pub-xxx.r2.dev`)

### Step 2: npm アカウント/トークンの準備

```bash
# npmにログイン（アカウントがなければ作成）
npm login

# 公開用トークンを作成
npm token create --read-only=false
# 出力されたトークンをメモ
```

### Step 3: GitHub Secrets の設定

リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| Secret Name | 値 |
|-------------|-----|
| `R2_ACCESS_KEY_ID` | Cloudflare R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Secret Access Key |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET_NAME` | `crew-binaries` |
| `R2_PUBLIC_URL` | `https://pub-xxx.r2.dev` |
| `NPM_TOKEN` | npm publish token |

**オプション（macOS コード署名）**:
| Secret Name | 説明 |
|-------------|------|
| `APPLE_CERTIFICATE_BASE64` | 署名証明書のBase64 |
| `APPLE_CERTIFICATE_PASSWORD` | 証明書のパスワード |
| `APPLE_SIGNING_IDENTITY` | 署名ID |
| `APPLE_NOTARIZATION_APPLE_ID` | Apple ID |
| `APPLE_NOTARIZATION_PASSWORD` | App-specific password |
| `APPLE_NOTARIZATION_TEAM_ID` | Team ID |

※macOS署名は後からでも追加可能

### Step 4: ワークフローの確認・調整

`.github/workflows/pre-release.yml` で以下を確認:

```yaml
env:
  R2_PUBLIC_URL: ${{ secrets.R2_PUBLIC_URL }}
  R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
  R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
```

### Step 5: リリース実行

```bash
# 1. バージョンを確認/更新
# npx-cli/package.json の version を確認

# 2. タグを作成
git tag v0.1.0
git push origin v0.1.0

# 3. GitHub Actions が自動実行
# - pre-release.yml: ビルド → R2アップロード → GitHub Release（ドラフト）

# 4. GitHub Releases でドラフトを確認
# - バイナリが正しくアップロードされているか
# - .tgz ファイルがあるか

# 5. ドラフトを正式リリースに変換
# - publish.yml が自動実行 → npm に公開
```

### Step 6: 動作確認

```bash
# npm キャッシュをクリア
npm cache clean --force

# 実行テスト
npx crew
```

---

## ローカルテスト（公開前）

```bash
# 1. フロントエンドビルド
cd frontend && pnpm run build

# 2. バックエンドビルド
cargo build --release

# 3. npx-cli/dist にバイナリをコピー
mkdir -p npx-cli/dist/darwin-arm64
cp target/release/server npx-cli/dist/darwin-arm64/vibe-kanban

# 4. ローカル実行
cd npx-cli
CREW_LOCAL=1 node bin/cli.js
```

---

## 対象ファイル

| ファイル | 役割 |
|---------|------|
| `npx-cli/package.json` | npm パッケージ定義 |
| `npx-cli/bin/cli.js` | CLI エントリーポイント |
| `npx-cli/bin/download.js` | バイナリダウンロード |
| `.github/workflows/pre-release.yml` | ビルド・R2アップロード |
| `.github/workflows/publish.yml` | npm 公開 |

---

## 検証方法

1. **ローカルテスト**: `CREW_LOCAL=1 node npx-cli/bin/cli.js`
2. **CI確認**: GitHub Actions のログでビルド成功を確認
3. **R2確認**: Cloudflare Dashboard でバイナリがアップロードされているか確認
4. **npm確認**: `npm view crew` でパッケージ情報を確認
5. **E2Eテスト**: `npx crew` でサーバーが起動することを確認
