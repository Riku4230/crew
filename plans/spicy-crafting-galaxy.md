# テーブルビュー全タスク表示バグ修正計画

## 問題
- テーブルビューで複数タスクがあっても **1件しか表示されない**
- Kanban、Dashboard、DAG は正常に全タスク表示できる

## 原因
- `TableVirtuoso`（仮想スクロール）が親の高さに依存
- flexbox チェーン (`flex-1`, `min-h-0`) で高さが 0 に潰れる
- `min-h-[400px]` 等の修正では解決しなかった

## 修正方針

**`TableVirtuoso` を廃止し、Kanban と同様に `map()` で直接レンダリング**

理由:
1. ユーザーが「Kanban と同じように」表示してほしいと要望
2. flexbox の高さ計算問題を根本的に回避
3. 実装がシンプル
4. タスク数が数百件程度なら仮想化不要

---

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `frontend/src/components/tasks/TaskTableView.tsx` | 仮想化廃止、`map()` 直接レンダリング |

---

## 実装ステップ

### 1. インポート変更
```tsx
// 削除
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import { forwardRef } from 'react';

// 追加（既存のものがあれば確認）
import { TableBody } from '@/components/ui/table/table';
```

### 2. 削除するコード
- `VirtuosoTableContext` 型定義 (行 34-38)
- `VirtuosoTableComponents` 定義 (行 40-67)
- `virtuosoContext` (行 266-270)
- `fixedHeaderContent` の useCallback ラッパー

### 3. レンダリング部分の書き換え

**Before (TableVirtuoso使用):**
```tsx
<div className="absolute inset-0">
  <TableVirtuoso
    data={allTasks}
    context={virtuosoContext}
    components={VirtuosoTableComponents}
    fixedHeaderContent={fixedHeaderContent}
    style={{ height: '100%', width: '100%' }}
  />
</div>
```

**After (map直接レンダリング):**
```tsx
<div className="overflow-x-auto">
  <Table className="min-w-[700px]">
    <TableHead>
      <TableRow className="border-b border-border/30 bg-muted/30">
        {/* SortableHeader コンポーネントをそのまま使用 */}
      </TableRow>
    </TableHead>
    <TableBody>
      {allTasks.map(({ item, sharedTask }) => {
        const taskProps = taskProperties?.[item.task.id];
        return (
          <TaskTableRow
            key={item.task.id}
            task={item.task}
            sharedTask={sharedTask}
            taskProps={taskProps}
            onViewDetails={onViewTaskDetails}
            isSelected={selectedTaskId === item.task.id}
          />
        );
      })}
    </TableBody>
  </Table>
</div>
```

### 4. 外側コンテナの簡素化

```tsx
return (
  <div className="w-full h-full overflow-auto px-4 sm:px-6 py-6">
    <div className="max-w-7xl mx-auto w-full">
      {/* Header with Add Task button */}
      {onCreateTask && (
        <div className="flex justify-end mb-4">
          <Button onClick={onCreateTask} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {t('dag.addTask', 'タスク追加')}
          </Button>
        </div>
      )}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/60 shadow-...">
        <div className="overflow-x-auto">
          <Table>...</Table>
        </div>
      </div>
    </div>
  </div>
);
```

---

## 検証方法

1. `pnpm run frontend:dev` でフロントエンド起動
2. テーブルビューで以下を確認:
   - [ ] 全タスクが表示される
   - [ ] ソート（全カラム）が動作する
   - [ ] 行クリックで詳細パネルが開く
   - [ ] 横スクロール（狭い画面）が機能する
   - [ ] タスク追加ボタンが機能する
3. `pnpm run check` で型チェック通過

---

## リスク

- **パフォーマンス**: 1000件超のタスクで描画が重くなる可能性
  - 対策: 必要に応じてページネーションを後から追加
