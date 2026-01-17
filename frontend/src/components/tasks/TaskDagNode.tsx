import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Loader2, XCircle, CheckCircle2, Clock, Lock, PlayCircle } from 'lucide-react';
import type { TaskWithAttemptStatus, TaskReadiness } from 'shared/types';
import { cn } from '@/lib/utils';

export interface TaskNodeData extends Record<string, unknown> {
  task: TaskWithAttemptStatus;
  onViewDetails: (task: TaskWithAttemptStatus) => void;
  readiness?: TaskReadiness;
}

interface TaskDAGNodeProps {
  data: TaskNodeData;
  selected?: boolean;
}

// Helper to get readiness type from TaskReadiness union
function getReadinessType(readiness: TaskReadiness): 'ready' | 'blocked' | 'in_progress' | 'completed' | 'cancelled' {
  if (typeof readiness === 'string') {
    return readiness;
  }
  if ('blocked' in readiness) {
    return 'blocked';
  }
  return 'ready'; // fallback
}

// Helper to get blocking task IDs if blocked
function getBlockingTaskIds(readiness: TaskReadiness): string[] {
  if (typeof readiness === 'object' && 'blocked' in readiness) {
    return readiness.blocked.blocking_task_ids;
  }
  return [];
}

export const TaskDAGNode = memo(function TaskDAGNode({
  data,
  selected,
}: TaskDAGNodeProps) {
  const { task, onViewDetails, readiness } = data;

  // Status-based border color
  const statusColors: Record<string, string> = {
    todo: 'border-l-gray-400',
    inprogress: 'border-l-blue-500',
    done: 'border-l-green-500',
  };

  // Readiness-based background and styling
  const getReadinessStyles = () => {
    if (!readiness) return '';

    const type = getReadinessType(readiness);
    switch (type) {
      case 'ready':
        return 'bg-green-50 dark:bg-green-950/30 ring-1 ring-green-500/20';
      case 'blocked':
        return 'bg-gray-50 dark:bg-gray-900/50 opacity-70';
      case 'in_progress':
        return 'bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-500/30';
      case 'completed':
        return 'bg-emerald-50 dark:bg-emerald-950/30';
      default:
        return '';
    }
  };

  // Readiness icon
  const ReadinessIcon = () => {
    if (!readiness) return null;

    const type = getReadinessType(readiness);
    switch (type) {
      case 'ready':
        return <PlayCircle className="h-3.5 w-3.5 text-green-500" />;
      case 'blocked':
        return <Lock className="h-3.5 w-3.5 text-gray-400" />;
      case 'in_progress':
        return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg shadow-sm p-3 min-w-[180px] max-w-[240px] cursor-pointer transition-all',
        'border-l-4',
        statusColors[task.status] || 'border-l-gray-400',
        selected && 'ring-2 ring-primary ring-offset-2',
        getReadinessStyles()
      )}
      onClick={() => onViewDetails(task)}
    >
      {/* Target handle (left) - this task receives dependencies from the left */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-800 !shadow-md"
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate flex-1">
            {task.title}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <ReadinessIcon />
            {task.has_in_progress_attempt && !readiness && (
              <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
            )}
            {task.last_attempt_failed && (
              <XCircle className="h-3 w-3 text-destructive" />
            )}
          </div>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground truncate">
            {task.description.length > 50
              ? `${task.description.substring(0, 50)}...`
              : task.description}
          </p>
        )}
        {/* Show blocking tasks count for blocked tasks */}
        {readiness && getReadinessType(readiness) === 'blocked' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {getBlockingTaskIds(readiness).length}件の依存タスクを待機中
          </p>
        )}
      </div>

      {/* Source handle (right) - dependents are to the right */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-white dark:!border-gray-800 !shadow-md"
      />
    </div>
  );
});
