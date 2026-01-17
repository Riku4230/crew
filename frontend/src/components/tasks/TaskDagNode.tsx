import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Loader2,
  XCircle,
  CheckCircle2,
  Circle,
  Clock,
  Lock,
  Play
} from 'lucide-react';
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

// Status configuration with colors, icons, and labels
const STATUS_CONFIG = {
  todo: {
    borderColor: 'border-slate-300 dark:border-slate-600',
    bgColor: 'bg-slate-50 dark:bg-slate-900/50',
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    iconColor: 'text-slate-500',
    Icon: Circle,
    label: 'Todo',
  },
  inprogress: {
    borderColor: 'border-blue-400 dark:border-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    iconBg: 'bg-blue-100 dark:bg-blue-900/60',
    iconColor: 'text-blue-600 dark:text-blue-400',
    Icon: Play,
    label: 'In Progress',
  },
  done: {
    borderColor: 'border-emerald-400 dark:border-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/60',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    Icon: CheckCircle2,
    label: 'Done',
  },
} as const;

export const TaskDAGNode = memo(function TaskDAGNode({
  data,
  selected,
}: TaskDAGNodeProps) {
  const { task, onViewDetails, readiness } = data;

  // Get status config (default to todo if unknown)
  const config = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.todo;
  const StatusIcon = config.Icon;

  // Blocked state overrides
  const isBlocked = readiness && getReadinessType(readiness) === 'blocked';
  const blockingCount = readiness ? getBlockingTaskIds(readiness).length : 0;

  return (
    <div
      className={cn(
        'rounded-xl shadow-sm cursor-pointer transition-all duration-200',
        'min-w-[200px] max-w-[260px]',
        'border-2',
        config.borderColor,
        config.bgColor,
        selected && 'ring-2 ring-primary ring-offset-2',
        isBlocked && 'opacity-60 border-dashed'
      )}
      onClick={() => onViewDetails(task)}
    >
      {/* Target handle (left) - subtle gray */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-gray-300 dark:!bg-gray-600 !border-2 !border-white dark:!border-gray-800"
      />

      {/* Header with icon and status indicator */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 border-b',
        config.borderColor.replace('border-', 'border-b-').replace('-400', '-200').replace('-300', '-200')
      )}>
        {/* Status icon in colored circle */}
        <div className={cn(
          'flex items-center justify-center w-7 h-7 rounded-lg shrink-0',
          config.iconBg
        )}>
          {isBlocked ? (
            <Lock className={cn('h-4 w-4', 'text-gray-400')} />
          ) : (
            <StatusIcon className={cn('h-4 w-4', config.iconColor)} />
          )}
        </div>

        {/* Title */}
        <span className="font-medium text-sm text-foreground truncate flex-1">
          {task.title}
        </span>

        {/* Right side indicators */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Completed checkmark */}
          {task.status === 'done' && (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          )}
          {/* In progress spinner */}
          {task.status === 'inprogress' && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          )}
          {/* Failed indicator */}
          {task.last_attempt_failed && (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}

        {/* Blocked indicator */}
        {isBlocked && blockingCount > 0 && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            <span>{blockingCount}件の依存タスクを待機中</span>
          </div>
        )}

        {/* Empty state */}
        {!task.description && !isBlocked && (
          <p className="text-xs text-muted-foreground/50 italic">説明なし</p>
        )}
      </div>

      {/* Source handle (right) - subtle gray */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-gray-300 dark:!bg-gray-600 !border-2 !border-white dark:!border-gray-800"
      />
    </div>
  );
});
