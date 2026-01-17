import { memo, type DragEvent } from 'react';
import {
  Circle,
  CheckCircle2,
  MoreHorizontal,
} from 'lucide-react';
import type { TaskWithAttemptStatus } from 'shared/types';
import { cn } from '@/lib/utils';

// Drag data type for native HTML5 drag
export const SIDEBAR_TASK_DRAG_TYPE = 'application/x-sidebar-task';

interface TaskCardProps {
  task: TaskWithAttemptStatus;
  onViewDetails: (task: TaskWithAttemptStatus) => void;
}

const TaskCard = memo(function TaskCard({
  task,
  onViewDetails,
}: TaskCardProps) {
  const isDone = task.status === 'done';

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(SIDEBAR_TASK_DRAG_TYPE, task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Truncate description for preview
  const descriptionPreview = task.description
    ? task.description.length > 120
      ? task.description.substring(0, 120) + '...'
      : task.description
    : null;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'group rounded-xl border bg-card shadow-sm cursor-grab active:cursor-grabbing transition-all',
        isDone
          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20'
          : 'border-border hover:border-primary/30 hover:shadow-md',
        'hover:scale-[1.01]'
      )}
      onClick={() => onViewDetails(task)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Status icon */}
          {isDone ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          {/* Title */}
          <span className={cn(
            'font-medium text-sm leading-tight',
            isDone && 'text-muted-foreground line-through'
          )}>
            {task.title}
          </span>
        </div>
        {/* Menu button */}
        <button
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails(task);
          }}
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Description preview */}
      {descriptionPreview && (
        <div className="px-3 pb-3">
          <p className={cn(
            'text-xs text-muted-foreground leading-relaxed',
            isDone && 'line-through'
          )}>
            {descriptionPreview}
          </p>
        </div>
      )}
    </div>
  );
});

export interface TaskDagSidebarProps {
  /** Tasks in the pool (not placed in DAG yet) */
  poolTasks: TaskWithAttemptStatus[];
  onViewDetails: (task: TaskWithAttemptStatus) => void;
}

export const TaskDagSidebar = memo(function TaskDagSidebar({
  poolTasks,
  onViewDetails,
}: TaskDagSidebarProps) {
  // Sort: Todo first, then Done
  const sortedTasks = [...poolTasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    // Within same status, sort by created_at (newest first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const todoCount = poolTasks.filter(t => t.status !== 'done').length;
  const doneCount = poolTasks.filter(t => t.status === 'done').length;

  return (
    <div className="w-72 h-full bg-muted/30 border-r border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-border bg-card">
        <h3 className="text-sm font-semibold text-foreground">タスクプール</h3>
        <p className="text-xs text-muted-foreground mt-1">
          DAGに配置されていないタスク
        </p>
        <div className="flex gap-4 mt-3 text-xs">
          <span className="flex items-center gap-1.5">
            <Circle className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-muted-foreground font-medium">{todoCount} 未着手</span>
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-muted-foreground font-medium">{doneCount} 完了</span>
          </span>
        </div>
      </div>

      {/* Scrollable task list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onViewDetails={onViewDetails}
          />
        ))}

        {/* Empty state */}
        {poolTasks.length === 0 && (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm text-muted-foreground">
              すべてのタスクがDAGに配置されています
            </p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-3 border-t border-border bg-card/50">
        <p className="text-xs text-muted-foreground text-center">
          カードをドラッグしてDAGにドロップ
        </p>
      </div>
    </div>
  );
});
