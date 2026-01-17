import { memo, forwardRef, useState, useRef, useEffect, useCallback, type DragEvent } from 'react';
import {
  Circle,
  CheckCircle2,
  MoreHorizontal,
  Inbox,
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

const TASK_POOL_WIDTH_KEY = 'task-pool-width';
const DEFAULT_WIDTH = 288; // w-72 = 18rem = 288px
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export interface TaskDagSidebarProps {
  /** Tasks in the pool (not placed in DAG yet) */
  poolTasks: TaskWithAttemptStatus[];
  onViewDetails: (task: TaskWithAttemptStatus) => void;
  /** Whether a DAG node is being dragged over this sidebar */
  isDropTarget?: boolean;
  /** Width of the sidebar in pixels */
  width?: number;
  /** Callback when width changes */
  onWidthChange?: (width: number) => void;
}

export const TaskDagSidebar = memo(forwardRef<HTMLDivElement, TaskDagSidebarProps>(
  function TaskDagSidebar({ 
    poolTasks, 
    onViewDetails, 
    isDropTarget = false,
    width: controlledWidth,
    onWidthChange,
  }, ref) {
    // Load initial width from localStorage or use default
    const [internalWidth, setInternalWidth] = useState(() => {
      if (controlledWidth !== undefined) return controlledWidth;
      const saved = localStorage.getItem(TASK_POOL_WIDTH_KEY);
      return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
    });

    const width = controlledWidth ?? internalWidth;
    const isResizingRef = useRef(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    // Save width to localStorage when it changes
    useEffect(() => {
      if (controlledWidth === undefined) {
        localStorage.setItem(TASK_POOL_WIDTH_KEY, width.toString());
      }
    }, [width, controlledWidth]);

    const handleResizeMove = useCallback((e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const deltaX = e.clientX - startXRef.current;
      const newWidth = Math.max(
        MIN_WIDTH,
        Math.min(MAX_WIDTH, startWidthRef.current + deltaX)
      );

      if (onWidthChange) {
        onWidthChange(newWidth);
      } else {
        setInternalWidth(newWidth);
      }
    }, [onWidthChange]);

    const handleResizeEnd = useCallback(() => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      }
    }, [handleResizeMove]);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      // Add event listeners
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
    }, [width, handleResizeMove, handleResizeEnd]);

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
      <div
        ref={ref}
        className={cn(
          "h-full bg-muted/30 border-r border-border flex flex-col shrink-0 relative transition-colors duration-200",
          isDropTarget && "bg-slate-200/80 dark:bg-slate-700/80 border-primary"
        )}
        style={{ width: `${width}px` }}
      >
        {/* Drop zone overlay */}
        {isDropTarget && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-200/50 dark:bg-slate-700/50 backdrop-blur-[2px] border-2 border-dashed border-primary rounded-lg m-2 pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Inbox className="w-8 h-8 text-primary" />
            </div>
            <p className="text-sm font-medium text-primary">ここにドロップ</p>
            <p className="text-xs text-muted-foreground mt-1">タスクプールに戻す</p>
          </div>
        )}

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

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 hover:bg-primary/50 transition-all group z-10"
        onMouseDown={handleResizeStart}
        aria-label="Resize task pool"
      >
        <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-1 h-16 bg-border rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
    );
  }
));
