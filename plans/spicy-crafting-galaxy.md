# DAGビュー エラー修正

## 現状

前回の実装で以下のエラーが発生:
- 画面が白くなり「エラー」と表示される（React Error Boundary）

## 原因調査

### 調査結果

1. **ファイル名の問題**: Git上で `TaskDAGView.tsx` と `TaskDagView.tsx` の両方が変更されている（macOSの大文字小文字非区別が原因）

2. **TaskPanel.tsx の依存関係チェック**: `useTaskDependencies(projectId || '')` で空文字列を渡している。フックは undefined を想定しているが空文字列だと問題が起きる可能性がある

3. **潜在的な問題**:
   - `dependencies` が undefined の場合に `.some()` を呼ぶとクラッシュする可能性
   - プロジェクトIDがない状態でTaskPanelが開かれた場合

## 修正計画

### Step 1: TaskPanel.tsx の修正

**変更箇所**: `frontend/src/components/panels/TaskPanel.tsx:44`

```typescript
// Before
const { dependencies } = useTaskDependencies(projectId || '');

// After
const { dependencies } = useTaskDependencies(projectId);
```

そして `taskHasDependencies` の計算を安全にする:

```typescript
// Before
const taskHasDependencies = useMemo(() => {
  if (!task) return false;
  return dependencies.some(
    (dep) => dep.task_id === task.id || dep.depends_on_task_id === task.id
  );
}, [task, dependencies]);

// After
const taskHasDependencies = useMemo(() => {
  if (!task || !dependencies || dependencies.length === 0) return false;
  return dependencies.some(
    (dep) => dep.task_id === task.id || dep.depends_on_task_id === task.id
  );
}, [task, dependencies]);
```

### Step 2: Git状態のクリーンアップ

ファイル名のケース問題を解決するため、gitキャッシュをクリア:

```bash
git rm --cached frontend/src/components/tasks/TaskDAGView.tsx
```

## 検証方法

1. `pnpm run check` で型チェック
2. `pnpm run dev` でアプリを起動
3. タスクビューにアクセスしてエラーが出ないことを確認

---

# 以前の計画（参考）

## 要件

### 新しい分類ロジック

| 分類 | 条件 | 表示場所 |
|------|------|---------|
| **DAGビュー** | 依存関係あり（incoming/outgoing いずれか） | メインエリア（ReactFlow） |
| **タスクプール** | 依存関係なし & ステータスが todo/inprogress/inreview/cancelled | サイドバー上部 |
| **アーカイブ** | 依存関係なし & ステータスが done | サイドバー下部（折りたたみ可） |

### UI変更

1. **アーカイブセクション**: サイドバー内に折りたたみ可能なセクションとして追加
2. **アーカイブボタン**: タスク詳細パネルに追加（依存関係があれば無効化）

---

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `frontend/src/components/tasks/TaskDAGView.tsx` | 分類ロジック変更、props更新 |
| `frontend/src/components/tasks/TaskDagSidebar.tsx` | アーカイブセクション追加、props追加 |
| `frontend/src/components/tasks/TaskDetailsPanel.tsx` | アーカイブボタン追加 |

---

## 実装ステップ

### Step 1: 分類ロジックの変更 (TaskDAGView.tsx:203-218)

**Before:**
```typescript
const { dagTasks, poolTasks } = useMemo(() => {
  tasks.forEach((task) => {
    if (task.dag_position_x !== null && task.dag_position_y !== null) {
      inDag.push(task);
    } else {
      inPool.push(task);
    }
  });
  return { dagTasks: inDag, poolTasks: inPool };
}, [tasks]);
```

**After:**
```typescript
const { dagTasks, poolTasks, archiveTasks } = useMemo(() => {
  const inDag: TaskWithAttemptStatus[] = [];
  const inPool: TaskWithAttemptStatus[] = [];
  const inArchive: TaskWithAttemptStatus[] = [];

  // 依存関係に登場するタスクIDを収集
  const tasksWithDependencies = new Set<string>();
  dependencies.forEach((dep) => {
    tasksWithDependencies.add(dep.task_id);
    tasksWithDependencies.add(dep.depends_on_task_id);
  });

  tasks.forEach((task) => {
    const hasDependency = tasksWithDependencies.has(task.id);

    if (hasDependency) {
      // 依存関係がある -> DAGビュー
      inDag.push(task);
    } else if (task.status === 'done') {
      // 依存関係なし & 完了 -> アーカイブ
      inArchive.push(task);
    } else {
      // 依存関係なし & 未完了 -> タスクプール
      inPool.push(task);
    }
  });

  return { dagTasks: inDag, poolTasks: inPool, archiveTasks: inArchive };
}, [tasks, dependencies]);
```

### Step 2: TaskDagSidebar.tsx の更新

**Props変更 (行100-112):**
```typescript
export interface TaskDagSidebarProps {
  poolTasks: TaskWithAttemptStatus[];
  archiveTasks: TaskWithAttemptStatus[];  // 追加
  onViewDetails: (task: TaskWithAttemptStatus) => void;
  isDropTarget?: boolean;
  isArchiveDropTarget?: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
}
```

**State追加:**
```typescript
const [archiveExpanded, setArchiveExpanded] = useState(false);
```

**アーカイブセクション追加** (既存の Archive drop zone を置き換え、行254-284):
```typescript
{/* Archive Section */}
<div
  data-archive-zone
  className={cn(
    "border-t border-border transition-colors duration-200",
    isArchiveDropTarget && "bg-emerald-100/80 dark:bg-emerald-900/40 border-emerald-400"
  )}
>
  {/* Archive drop overlay */}
  {isArchiveDropTarget && (
    <div className="flex flex-col items-center justify-center p-4 py-2">
      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mb-2">
        <Archive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
      </div>
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">完了にする</p>
    </div>
  )}

  {/* Collapsible archive header */}
  {!isArchiveDropTarget && (
    <>
      <button
        onClick={() => setArchiveExpanded(!archiveExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">アーカイブ</span>
          <span className="text-xs text-muted-foreground">({archiveTasks.length})</span>
        </div>
        {archiveExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Archive task list */}
      {archiveExpanded && (
        <div className="p-3 pt-0 space-y-2 max-h-48 overflow-y-auto">
          {archiveTasks.length > 0 ? (
            archiveTasks.map((task) => (
              <TaskCard key={task.id} task={task} onViewDetails={onViewDetails} />
            ))
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              アーカイブされたタスクはありません
            </p>
          )}
        </div>
      )}
    </>
  )}
</div>
```

**import追加:**
```typescript
import { ChevronDown, ChevronRight } from 'lucide-react';
```

### Step 3: TaskDAGView.tsx からの props 更新 (行628-634付近)

```typescript
<TaskDagSidebar
  ref={sidebarRef}
  poolTasks={poolTasks}
  archiveTasks={archiveTasks}  // 追加
  onViewDetails={onViewDetails}
  isDropTarget={isDraggingOverSidebar}
  isArchiveDropTarget={isDraggingOverArchive}
/>
```

### Step 4: ドロップ動作の調整 (handleNodeDragStop)

依存関係があるタスクをアーカイブにドロップした場合の制限を追加:

```typescript
const handleNodeDragStop = useCallback(
  (_event: React.MouseEvent, node: Node<TaskNodeData>) => {
    if (isDraggingOverArchiveRef.current) {
      // アーカイブへのドロップ: 依存関係チェックは不要
      // （新ロジックでは依存関係のあるタスクはDAGに表示され、
      //   依存関係を削除しない限りアーカイブに移動できない）
      updateTask.mutate({
        taskId: node.id,
        data: {
          status: 'done',
          clear_dag_position: true,
        },
      });
    } else if (isDraggingOverSidebarRef.current) {
      // タスクプールへのドロップ
      // 依存関係がある場合は自動的にDAGに残る（新分類ロジック）
      updateTask.mutate({
        taskId: node.id,
        data: {
          clear_dag_position: true,
        },
      });
    } else {
      // DAG内での移動: 位置を保存
      updateTask.mutate({
        taskId: node.id,
        data: {
          dag_position_x: node.position.x,
          dag_position_y: node.position.y,
          clear_dag_position: false,
        },
      });
    }
    setIsDraggingOverSidebar(false);
    setIsDraggingOverArchive(false);
  },
  [updateTask]
);
```

### Step 5: タスク詳細パネルにアーカイブボタン追加 (TaskDetailsPanel.tsx)

```typescript
// アーカイブボタン（依存関係がない場合のみ有効）
{task.status !== 'done' && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => handleArchive(task.id)}
    disabled={taskHasDependencies}
    title={taskHasDependencies ? '依存関係があるタスクはアーカイブできません' : ''}
  >
    <Archive className="h-4 w-4 mr-1" />
    アーカイブ
  </Button>
)}
```

依存関係チェックのための props/hook 追加が必要。

---

## 検証方法

```bash
# フロントエンド起動
pnpm run frontend:dev
```

### 手動テスト

1. **分類の確認**
   - [ ] 依存関係のあるタスク → DAGビューに表示
   - [ ] 依存関係なし & ステータスtodo → タスクプールに表示
   - [ ] 依存関係なし & ステータスdone → アーカイブに表示

2. **ドロップ動作**
   - [ ] タスクプールからDAGノードへドロップ → 依存関係作成 → DAGに移動
   - [ ] DAGからアーカイブゾーンへドロップ → done になりアーカイブへ
   - [ ] DAGからタスクプールへドロップ → 依存関係があればDAGに残る

3. **アーカイブセクション**
   - [ ] 折りたたみ開閉が動作する
   - [ ] アーカイブタスクが正しく表示される
   - [ ] タスクカードクリックで詳細パネルが開く

4. **型チェック**
   ```bash
   pnpm run check
   ```

---

## 注意点

1. **位置情報の扱い**: 新ロジックでは `dag_position_x/y` は分類に使用しないが、レイアウト計算には引き続き使用
2. **依存関係削除時の動作**: 依存関係を削除するとタスクが自動的にプール/アーカイブに移動する（ステータスによる）
3. **UX変更**: 「位置設定でDAGに追加」から「依存関係作成でDAGに追加」への変更
