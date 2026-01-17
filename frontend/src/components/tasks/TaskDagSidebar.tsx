import { memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Circle,
  CheckCircle2,
  GripVertical,
} from 'lucide-react';
import type { TaskWithAttemptStatus } from 'shared/types';
import { cn } from '@/lib/utils';

// Drag item type identifier
export const SIDEBAR_TASK_TYPE = 'sidebar-task';

interface DraggableTaskItemProps {
  task: TaskWithAttemptStatus;
  onViewDetails: (task: TaskWithAttemptStatus) => void;
}

const DraggableTaskItem = memo(function DraggableTaskItem({
  task,
  onViewDetails,
}: DraggableTaskItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sidebar-${task.id}`,
    data: {
      type: SIDEBAR_TASK_TYPE,
      task,
    },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 1000 : undefined,
      }
    : undefined;

  const isDone = task.status === 'done';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all',
        isDone
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700'
          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700',
        isDragging && 'opacity-50 shadow-lg scale-95',
        'hover:shadow-md hover:scale-[1.02]'
      )}
      onClick={() => onViewDetails(task)}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 opacity-40 group-hover:opacity-100 transition-opacity touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Status icon */}
      {isDone ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-slate-400" />
      )}

      {/* Title */}
      <span className={cn(
        'text-sm truncate flex-1',
        isDone && 'text-muted-foreground line-through'
      )}>
        {task.title}
      </span>
    </div>
  );
});

export interface TaskDagSidebarProps {
  /** Tasks not connected to any dependency (isolated nodes) */
  isolatedTasks: TaskWithAttemptStatus[];
  onViewDetails: (task: TaskWithAttemptStatus) => void;
}

export const TaskDagSidebar = memo(function TaskDagSidebar({
  isolatedTasks,
  onViewDetails,
}: TaskDagSidebarProps) {
  // Sort: Todo first, then Done
  const sortedTasks = [...isolatedTasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    // Within same status, sort by created_at (newest first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const todoCount = isolatedTasks.filter(t => t.status !== 'done').length;
  const doneCount = isolatedTasks.filter(t => t.status === 'done').length;

  return (
    <div className="w-56 h-full bg-card/50 border-r border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card">
        <h3 className="text-sm font-semibold text-foreground">タスクプール</h3>
        <p className="text-xs text-muted-foreground mt-1">
          DAGに接続されていないタスク
        </p>
        <div className="flex gap-3 mt-2 text-xs">
          <span className="flex items-center gap-1">
            <Circle className="h-3 w-3 text-slate-400" />
            <span className="text-muted-foreground">{todoCount}</span>
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-muted-foreground">{doneCount}</span>
          </span>
        </div>
      </div>

      {/* Scrollable task list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sortedTasks.map((task) => (
          <DraggableTaskItem
            key={task.id}
            task={task}
            onViewDetails={onViewDetails}
          />
        ))}

        {/* Empty state */}
        {isolatedTasks.length === 0 && (
          <div className="text-center py-8 px-2">
            <p className="text-muted-foreground text-sm">
              すべてのタスクがDAGに接続されています
            </p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-2 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          ドラッグしてDAGに追加
        </p>
      </div>
    </div>
  );
});
