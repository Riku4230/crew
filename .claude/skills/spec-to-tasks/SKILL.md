---
name: spec-to-tasks
description: 仕様書からタスクに分解する。「タスクに分解して」「仕様からタスク作って」「PRDからIssue切って」で使用。
---

# 仕様書からタスク分解（SDD）

<context>
このスキルは**仕様駆動開発（SDD）**の考え方に基づき、
仕様書・設計書を読み解いてタスクに分解する。

分解されたタスクは後で `/organize-dependencies` で依存関係を整理する。
</context>

## いつ使うか

- 「タスクに分解して」「仕様からタスク作って」と言われた時
- PRD（要件定義書）から実装タスクを作成する時
- 技術設計書からタスクを洗い出す時
- User Story + AC からサブタスクを作成する時

## いつ使わないか

- 仕様書がない → 先に仕様を作成
- 既存タスクの依存関係整理 → `/organize-dependencies`
- タスクの実装 → `/implement-tdd`

---

## フロー

<steps>
1. **仕様書・設計書を読む**（最重要）
   - PRD（Product Requirements Document）
   - 技術設計書
   - Issue本文のUser Story / AC
   - docs/ 配下のドキュメント

2. **機能要件を抽出**
   - FR（Functional Requirements）を特定
   - 各FRの依存関係を把握

3. **技術スタックを確認**
   - レイヤー構成（DB / API / Frontend）
   - 使用技術・ライブラリ

4. **タスクに分解**
   - 機能単位 + 技術レイヤーで分解
   - 並列実行可能な粒度を意識

5. **MCPでタスク作成**
   - 各タスクにAC（受け入れ条件）を含める

6. **分解結果をユーザーに報告**
</steps>

---

## 仕様書の読み方

### 1. PRD / 要件定義書

```markdown
## 概要
<機能の目的・ゴール>

## 機能要件
- FR-1: ユーザー認証
- FR-2: タスク管理
- FR-3: レポート出力

## 技術スタック
- Backend: Rust (Axum) + SQLite
- Frontend: React + TypeScript
```

→ 各FRを独立したタスクに分解
→ 技術スタックから実装順序を導出

### 2. Issue本文のUser Story + AC

```markdown
## User Story
As a ユーザー,
I want タスクの依存関係を可視化したい,
So that 実行順序を把握できる

## AC（受け入れ条件）
### AC1: DAG表示
- Given タスクが存在する
- When DAGビューを開く
- Then 依存関係がグラフで表示される

### AC2: ドラッグ&ドロップ
- Given DAGビューが開いている
- When ノードをドラッグ
- Then 位置が保存される
```

→ 各ACをサブタスクに分解
→ ACの依存関係を把握

### 3. 技術設計書

```markdown
## アーキテクチャ
1. DBスキーマ設計
2. API設計
3. フロントエンド設計

## データモデル
- task_dependencies (task_id, depends_on_task_id)

## API
- POST /api/projects/{id}/dependencies
- DELETE /api/projects/{id}/dependencies/{id}
```

→ レイヤーごとにタスクを分解
→ 技術的な依存関係を特定

---

## タスク分解の原則

### 1. 機能単位 × 技術レイヤー

| 機能要件 | DB | API | Frontend |
|---------|-----|-----|----------|
| FR-1: 依存関係保存 | 1-1: テーブル作成 | 1-2: CRUD API | - |
| FR-2: 可視化 | - | - | 2-1: React Flow導入 |
| FR-3: 自動レイアウト | - | - | 2-2: dagre実装 |

### 2. 適切な粒度

**良い粒度**:
- 1タスク = 1日以内で完了可能
- 1タスク = 1つの明確なAC
- 並列実行可能（他タスクをブロックしない）

**悪い粒度**:
- 「DAG機能を実装」（大きすぎる）
- 「変数名を変更」（小さすぎる）

### 3. フェーズ分け

```
Phase 1: 基盤（DB・型定義）
  └─ 並列可能: テーブル作成、型定義

Phase 2: API
  └─ Phase 1に依存
  └─ 並列可能: CRUD API、位置保存API

Phase 3: フロントエンド
  └─ Phase 2に依存
  └─ 並列可能: DAG表示、ドラッグ&ドロップ
```

---

## タスク分解の例

### 仕様書

```markdown
# DAG可視化機能

## 概要
タスク間の依存関係をDAG（有向非巡回グラフ）で可視化する。

## 機能要件
1. タスク依存関係の保存（task_dependencies テーブル）
2. 依存関係CRUD API
3. React Flowでの可視化
4. 自動レイアウト（dagre）
5. ドラッグ&ドロップで位置保存

## 技術スタック
- Backend: Rust (Axum) + SQLite
- Frontend: React + React Flow
- 共有型: ts-rs
```

### 分解結果

```markdown
## Phase 1: データ基盤

### 1-1: task_dependencies テーブル作成
**FR**: 依存関係の永続化
**AC**:
- Given SQLiteデータベース
- When マイグレーション実行
- Then task_dependencies テーブルが作成される

### 1-2: DAG位置フィールド追加
**FR**: ノード位置の保存
**AC**:
- Given tasksテーブル
- When マイグレーション実行
- Then dag_x, dag_y カラムが追加される

---

## Phase 2: API

### 1-3: 依存関係CRUD API
**FR**: 依存関係の操作
**AC**:
- Given 依存関係データ
- When POST/DELETE /api/projects/{id}/dependencies
- Then 依存関係が作成/削除される

### 1-4: TypeScript型生成
**FR**: フロントエンドとの型共有
**AC**:
- Given Rust型定義
- When pnpm run generate-types
- Then shared/types.ts が更新される

---

## Phase 3: フロントエンド

### 2-1: React Flow導入
**FR**: DAG描画基盤
**AC**:
- Given React Flowパッケージ
- When DAGビューを開く
- Then 空のキャンバスが表示される

### 2-2: TaskNodeコンポーネント
**FR**: タスク表示
**AC**:
- Given タスクデータ
- When DAGビューを開く
- Then タスクがノードとして表示される

### 2-3: dagre自動レイアウト
**FR**: 自動配置
**AC**:
- Given 依存関係データ
- When 自動レイアウトボタン押下
- Then ノードが階層的に配置される

### 2-4: ドラッグ&ドロップ
**FR**: 位置カスタマイズ
**AC**:
- Given DAGビュー
- When ノードをドラッグ
- Then 位置がAPIで保存される
```

---

## MCPツール使用方法

### プロジェクト一覧取得

```
mcp__vibe_kanban__list_projects
```

### タスク作成

```
mcp__vibe_kanban__create_task
  project_id: <プロジェクトID>
  title: <タスク名>
  description: <説明とAC>
```

---

## 出力形式

<output_format>
```markdown
## タスク分解完了

### 参照した仕様

| ドキュメント | 内容 |
|-------------|------|
| docs/xxx.md | PRD |
| Issue #XX | User Story + AC |

### 分解結果

| Phase | タスク | FR | 説明 |
|-------|--------|-----|------|
| 1 | 1-1: DBテーブル作成 | FR-1 | 依存関係テーブル |
| 1 | 1-2: 位置フィールド | FR-2 | dag_x, dag_y追加 |
| 2 | 1-3: CRUD API | FR-1 | 依存関係操作API |
| 3 | 2-1: React Flow | FR-3 | DAG描画基盤 |

### 並列実行可能なタスク

| Phase | 並列タスク | 根拠 |
|-------|-----------|------|
| 1 | 1-1, 1-2 | 別テーブル・独立した変更 |
| 3 | 2-1, 2-3 | 別コンポーネント |

合計: X件のタスクを作成しました。

---

次のステップ: `/organize-dependencies` で依存関係を整理
```
</output_format>

---

## 重要

<important>
- **仕様書を必ず読む**: タスクは仕様から導出する
- **ACを含める**: 各タスクにGiven/When/Then形式のACを記載
- **適切な粒度**: 1日以内で完了可能な単位
- **並列実行を意識**: Git Worktreeの利点を活かす
- **フェーズ分け**: 技術レイヤーの依存関係を考慮
</important>

---

## 仕様書がない場合

<fallback>
仕様書がない場合:

1. **ユーザーにヒアリング**
   - 「何を実現したいですか？」
   - 「完了条件は何ですか？」

2. **仕様を一緒に作成**
   - User Story形式で整理
   - ACを明確化

3. **仕様作成後にタスク分解**

仕様なしでタスクを作るのは**推測に基づく**ため、
先に仕様を固めることを推奨。
</fallback>

---

## 次のステップ

<next_step>
タスク分解後:
1. `/organize-dependencies` で依存関係を整理
2. DAGビューで視覚的に確認
3. 各タスクの実装は `/implement-tdd` で
</next_step>
