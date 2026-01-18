# Apache-2.0 ライセンス遵守ガイド

このプロジェクトは [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) をフォークし、Apache-2.0 ライセンスの下で改変・公開しています。

## 📋 公開前チェックリスト

### ✅ 必須項目（Apache-2.0 の最低限の遵守要件）

- [x] **LICENSE ファイルの保持**
  - ✅ Apache-2.0 の全文を `LICENSE` ファイルとしてリポジトリに含める
  - ✅ このファイルを削除・変更しない

- [x] **NOTICE ファイルの確認**
  - ✅ 元リポジトリに `NOTICE` ファイルがないことを確認（スキップ可）

- [x] **変更の明示**
  - ✅ README にフォーク元（BloopAI/vibe-kanban）と変更点を明記済み
  - ℹ️ 変更したファイルには変更履歴を記録する（Git履歴で管理）

- [x] **著作権表示の保持**
  - ✅ LICENSE ファイルに元の Apache-2.0 の著作権表示が含まれている
  - ✅ 元の著作権表示を削除していない

### ⚠️ 注意事項（よくある落とし穴）

- [x] **商標の使用に注意**
  - ✅ プロジェクト名を "Crew" に変更済み（package.json で確認）
  - ✅ "vibe-kanban" はフォーク元の説明としてのみ使用
  - ✅ 自分の製品名として前面に出していない

- [x] **秘密情報の混入チェック**
  - ✅ `.gitignore` で `.env` ファイルが適切に除外されている
  - ✅ コミット済みファイルに `.env` ファイルは含まれていない（`.env.production.example` のみ）
  - ⚠️ コード内の変数名（API_KEY, TOKEN等）は設定参照なので問題なし
  - ⚠️ 実際の秘密情報がコードにハードコードされていないか要確認

- [ ] **依存ライブラリのライセンス確認**
  - ⚠️ Rust依存関係（Cargo.toml）のライセンス確認が必要
  - ⚠️ Node.js依存関係（package.json）のライセンス確認が必要
  - ⚠️ GPL 系ライセンスが混在していないか確認
  - 💡 `THIRD_PARTY_NOTICES.md` を作成して整理することを推奨

- [ ] **画像・フォント・アイコンの権利確認**
  - ⚠️ `assets/` ディレクトリ内の素材の権利確認が必要
  - ⚠️ `frontend/dist/` 内の画像の権利確認が必要
  - ⚠️ 商用利用可能な素材か確認

## 📝 README への推奨記載事項

```markdown
## ライセンス

このプロジェクトは [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) をフォークし、
Apache-2.0 ライセンスの下で改変・公開しています。

### 主な変更点

- [変更点1]
- [変更点2]
- [変更点3]

詳細は [LICENSE](./LICENSE) を参照してください。
```

## 🔍 公開前の最終確認

### セキュリティチェック

```bash
# 秘密情報が含まれていないか確認
git log --all --full-history --source -- "*secret*" "*key*" "*password*" "*token*"

# .env ファイルがコミットされていないか確認
git ls-files | grep -E "\.env|\.secret"

# 大きなバイナリファイルが含まれていないか確認
find . -type f -size +1M -not -path "./.git/*" -not -path "./node_modules/*"
```

### ライセンス整合性チェック

```bash
# LICENSE ファイルの存在確認
test -f LICENSE && echo "✅ LICENSE exists" || echo "❌ LICENSE missing"

# NOTICE ファイルの確認（あれば）
test -f NOTICE && echo "✅ NOTICE exists" || echo "ℹ️  NOTICE not required"
```

## 📚 参考リンク

- [Apache License 2.0 全文](https://www.apache.org/licenses/LICENSE-2.0)
- [元リポジトリ: BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)
- [Apache-2.0 の遵守ガイド](https://www.apache.org/licenses/LICENSE-2.0.html#redistribution)

## ❓ よくある質問

### Q: 無料で公開しても大丈夫？

**A:** はい、Apache-2.0 では無料公開も有料販売も許可されています。ただし、上記のチェックリストを遵守してください。

### Q: 商用利用は可能？

**A:** はい、Apache-2.0 では商用利用も許可されています。ただし、ライセンス条件を遵守する必要があります。

### Q: プロジェクト名を変更する必要はある？

**A:** 必須ではありませんが、商標の観点から推奨されます。元のプロジェクト名を自分の製品名として使用するのは避けましょう。

### Q: どこまで変更すれば「自分のプロジェクト」になる？

**A:** Apache-2.0 では変更量に制限はありません。ただし、元の著作権表示は保持する必要があります。

## 🚨 問題が発生した場合

ライセンス違反の疑いがある場合や、権利関係で不明な点がある場合は：

1. 元リポジトリの Issue で確認
2. 法律専門家に相談
3. 必要に応じて該当コンテンツを削除

---

**最終更新**: 2025-01-XX  
**確認者**: [あなたの名前/チーム名]
