# テーブルビュー全タスク表示バグ修正計画

## 問題
- テーブルビューで複数タスクがあるのに**1件しか表示されない**
- ソートをクリックすると違うタスクが1件ずつ表示される
- 原因: flexbox の高さ継承チェーンが途切れ、TableVirtuoso のビューポートが1行分しかない

## 修正方針

`TaskTableView.tsx` に `min-h-[500px]` を追加して最小高さを保証する（`TaskDagView` と同じパターン）。

## 修正箇所

### `frontend/src/components/tasks/TaskTableView.tsx`

**Line 351 付近:**
```tsx
// Before
<div className="w-full h-full overflow-hidden px-4 sm:px-6 py-6 flex flex-col">

// After
<div className="w-full h-full overflow-hidden px-4 sm:px-6 py-6 flex flex-col min-h-[500px]">
```

## 検証方法

1. `pnpm run frontend:dev` でフロントエンド起動
2. http://localhost:4000/projects/{projectId}/tasks?taskView=table にアクセス
3. 複数のタスク（todo, done 含む）が一覧表示されることを確認
4. ソートをクリックして全タスクが正しくソートされることを確認
5. ウィンドウをリサイズしてもテーブルが正しく表示されることを確認

## クリーンアップ

修正後、デバッグ用の `console.log` を削除する。
