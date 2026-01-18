# Third-Party Notices

このプロジェクトは以下のオープンソースソフトウェアを使用しています。

## 依存ライブラリのライセンス

### Rust依存関係

すべてのRust依存関係は **MIT OR Apache-2.0** または **Apache-2.0 OR MIT** ライセンスです。

主要な依存関係:
- `tokio`: MIT
- `axum`: MIT
- `serde`: MIT OR Apache-2.0
- `sqlx`: MIT OR Apache-2.0
- `reqwest`: MIT OR Apache-2.0
- `git2`: MIT OR Apache-2.0
- `rustls`: Apache-2.0 OR ISC OR MIT

**GPL系ライセンスは含まれていません。**

### Node.js依存関係

#### 本番依存関係（dependencies）

すべての本番依存関係は **Apache-2.0 互換ライセンス**です。

主要なライブラリ:
- **React系**: MIT
  - `react`: MIT
  - `react-dom`: MIT
- **UIライブラリ**: MIT
  - `@radix-ui/*`: MIT
  - `@tanstack/*`: MIT
  - `@phosphor-icons/react`: MIT
- **エディタ**: MIT
  - `@lexical/*`: MIT
  - `@codemirror/*`: MIT
- **その他**: MIT
  - `@sentry/react`: MIT
  - `developer-icons`: MIT
  - `react-icons`: MIT
  - `simple-icons`: CC0-1.0（パブリックドメイン相当）

#### 開発依存関係（devDependencies）

開発依存関係のライセンス分布:
- **MIT**: 83個
- **Apache-2.0**: 7個
- **ISC**: 4個
- **BSD-2-Clause**: 1個
- **EPL-2.0**: 1個（Apache-2.0互換）
- **CC0-1.0**: 1個（パブリックドメイン）
- **LGPL-3.0-or-later**: 1個（開発時のみ使用）

**注意**: `eslint-plugin-deprecation@3.0.0` は LGPL-3.0-or-later ライセンスですが、これは開発依存関係（devDependencies）であり、ビルド成果物には含まれません。したがって、Apache-2.0 との互換性に問題はありません。

#### 特殊なライセンス

- **`@virtuoso.dev/message-list@1.15.2`**: Customライセンス（https://virtuoso.dev/virtuoso-message-list/）
  - カスタムライセンスのため、使用前にライセンス条項を確認してください
  - 通常は商用利用可能ですが、詳細は上記URLを参照してください

- **`crew@0.0.1`**: UNLICENSED
  - これはプロジェクト自体のパッケージ名のため、問題ありません

## ライセンス互換性の確認

### Apache-2.0 互換ライセンス

以下のライセンスは Apache-2.0 と互換性があります:
- ✅ MIT
- ✅ Apache-2.0
- ✅ ISC
- ✅ BSD-2-Clause
- ✅ BSD-3-Clause
- ✅ EPL-2.0
- ✅ CC0-1.0（パブリックドメイン）

### 開発依存関係のLGPLライセンス

`eslint-plugin-deprecation@3.0.0` は LGPL-3.0-or-later ライセンスですが、以下の理由で問題ありません:

1. **開発依存関係のみ**: ビルド成果物には含まれない
2. **静的リンクではない**: ESLintプラグインとして動的に読み込まれる
3. **分離可能**: 開発ツールとして独立して使用される

## 完全なライセンスリスト

詳細なライセンス情報は以下のファイルを参照してください:
- `docs/frontend-licenses.json` - フロントエンド依存関係の完全なライセンスリスト

## 確認方法

### Rust依存関係の確認

```bash
cargo tree --depth 1 --format "{p} {l}" | grep -E "MIT|Apache|BSD|ISC|GPL|LGPL"
```

### Node.js依存関係の確認

```bash
cd frontend
npx license-checker --json | jq -r 'to_entries[] | "\(.key): \(.value.licenses)"'
```

---

**最終更新**: 2025-01-XX  
**確認方法**: `license-checker` を使用して自動生成
