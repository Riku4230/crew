import { memo, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
} from '@/components/ui/table/table';
import { TaskTableRow } from './TaskTableRow';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useTaskProperties } from '@/hooks/useTaskProperties';
import { cn } from '@/lib/utils';
import type { TaskWithAttemptStatus, TaskStatus } from 'shared/types';
import type { SharedTaskRecord } from '@/hooks/useProjectTasks';
import type { KanbanColumnItem, KanbanColumns } from './TaskKanbanBoard';

const TASK_STATUSES: TaskStatus[] = [
  'todo',
  'inprogress',
  'inreview',
  'done',
  'cancelled',
];

type SortColumn = 'title' | 'status' | 'priority' | 'genre' | 'assignee' | 'progress' | 'created_at';
type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

interface TaskTableViewProps {
  columns: KanbanColumns;
  onViewTaskDetails: (task: TaskWithAttemptStatus) => void;
  onViewSharedTask?: (task: SharedTaskRecord) => void;
  selectedTaskId?: string;
  selectedSharedTaskId?: string | null;
  onCreateTask?: () => void;
}

function TaskTableViewComponent({
  columns,
  onViewTaskDetails,
  selectedTaskId,
  onCreateTask,
}: TaskTableViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [sortState, setSortState] = useState<SortState>({
    column: 'created_at',
    direction: 'desc',
  });

  const handleSort = useCallback((column: SortColumn) => {
    setSortState((prev) => {
      if (prev.column === column) {
        // Cycle: desc -> asc -> null (default) -> desc
        if (prev.direction === 'desc') {
          return { column, direction: 'asc' };
        } else if (prev.direction === 'asc') {
          return { column: 'created_at', direction: 'desc' }; // Reset to default
        }
      }
      return { column, direction: 'desc' };
    });
  }, []);

  // Flatten all tasks from columns into a single list
  const allTasksUnsorted = useMemo(() => {
    const tasks: Array<{
      item: Extract<KanbanColumnItem, { type: 'task' }>;
      sharedTask?: SharedTaskRecord;
    }> = [];

    TASK_STATUSES.forEach((status) => {
      const items = columns[status] || [];
      items.forEach((item) => {
        if (item.type === 'task') {
          tasks.push({
            item,
            sharedTask: item.sharedTask,
          });
        } else if (item.type === 'shared') {
          // Convert shared-only task to a compatible format
          const sharedTask = item.task;
          const virtualTask: TaskWithAttemptStatus = {
            id: sharedTask.id,
            title: sharedTask.title,
            description: sharedTask.description,
            status: sharedTask.status,
            parent_workspace_id: null,
            shared_task_id: sharedTask.id,
            project_id: sharedTask.project_id,
            position: null,
            dag_position_x: null,
            dag_position_y: null,
            created_at: sharedTask.created_at,
            updated_at: sharedTask.updated_at,
            has_in_progress_attempt: false,
            last_attempt_failed: false,
            executor: '',
          };
          tasks.push({
            item: { type: 'task', task: virtualTask, sharedTask },
            sharedTask,
          });
        }
      });
    });

    return tasks;
  }, [columns]);

  // Get task IDs for bulk property fetch (from unsorted tasks)
  const taskIds = useMemo(
    () => allTasksUnsorted.map(({ item }) => item.task.id),
    [allTasksUnsorted]
  );

  // Fetch properties for all tasks
  const { data: taskProperties } = useTaskProperties(taskIds);

  // Sort tasks based on sort state
  const allTasks = useMemo(() => {
    if (!sortState.column || !sortState.direction) {
      // Default: sort by created_at descending (newest first)
      return [...allTasksUnsorted].sort((a, b) => {
        const aDate = new Date(a.item.task.created_at).getTime();
        const bDate = new Date(b.item.task.created_at).getTime();
        return bDate - aDate;
      });
    }

    const sorted = [...allTasksUnsorted].sort((a, b) => {
      const taskA = a.item.task;
      const taskB = b.item.task;
      const propsA = taskProperties?.[taskA.id];
      const propsB = taskProperties?.[taskB.id];
      const sharedTaskA = a.sharedTask;
      const sharedTaskB = b.sharedTask;

      let comparison = 0;

      switch (sortState.column) {
        case 'title':
          comparison = taskA.title.localeCompare(taskB.title, 'ja');
          break;
        case 'status': {
          // Status order: todo < inprogress < inreview < done < cancelled
          const statusOrder: Record<TaskStatus, number> = {
            todo: 0,
            inprogress: 1,
            inreview: 2,
            done: 3,
            cancelled: 4,
          };
          comparison = statusOrder[taskA.status] - statusOrder[taskB.status];
          break;
        }
        case 'priority': {
          const priorityA = propsA?.githubPriority || '';
          const priorityB = propsB?.githubPriority || '';
          // Priority order: P0 > P1 > P2 > P3 > empty
          const priorityOrder: Record<string, number> = {
            P0: 0,
            critical: 0,
            P1: 1,
            high: 1,
            P2: 2,
            medium: 2,
            P3: 3,
            low: 3,
          };
          const orderA = priorityOrder[priorityA.toLowerCase()] ?? 999;
          const orderB = priorityOrder[priorityB.toLowerCase()] ?? 999;
          comparison = orderA - orderB;
          break;
        }
        case 'genre': {
          const genreA = (propsA?.['ジャンル'] as string) || '';
          const genreB = (propsB?.['ジャンル'] as string) || '';
          comparison = genreA.localeCompare(genreB, 'ja');
          break;
        }
        case 'assignee': {
          const assigneeA = propsA?.githubAssignees?.[0] || sharedTaskA?.assignee_username || '';
          const assigneeB = propsB?.githubAssignees?.[0] || sharedTaskB?.assignee_username || '';
          comparison = assigneeA.localeCompare(assigneeB, 'ja');
          break;
        }
        case 'progress': {
          // Progress: has_in_progress_attempt > last_attempt_failed > neither
          const progressA = taskA.has_in_progress_attempt ? 2 : taskA.last_attempt_failed ? 1 : 0;
          const progressB = taskB.has_in_progress_attempt ? 2 : taskB.last_attempt_failed ? 1 : 0;
          comparison = progressA - progressB;
          break;
        }
        case 'created_at': {
          const aDate = new Date(taskA.created_at).getTime();
          const bDate = new Date(taskB.created_at).getTime();
          comparison = aDate - bDate;
          break;
        }
        default:
          // null case - should not reach here due to early return
          break;
      }

      return sortState.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [allTasksUnsorted, sortState, taskProperties]);

  const isEmpty = allTasks.length === 0;

  if (isEmpty) {
    return (
      <div className="max-w-7xl mx-auto mt-8 px-4">
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">{t('empty.noTasks')}</p>
            {onCreateTask && (
              <Button className="mt-4" onClick={onCreateTask}>
                <Plus className="h-4 w-4 mr-2" />
                {t('empty.createFirst')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/60 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]">
          <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHead>
                <TableRow className="border-b border-border/30 bg-muted/30">
                  <SortableHeader
                    column="title"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="min-w-[200px]"
                  >
                    {t('table.title', { defaultValue: 'Title' })}
                  </SortableHeader>
                  <SortableHeader
                    column="status"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="w-[120px]"
                  >
                    {t('table.status', { defaultValue: 'Status' })}
                  </SortableHeader>
                  <SortableHeader
                    column="priority"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="w-[100px] hidden sm:table-cell"
                  >
                    {t('table.priority', { defaultValue: 'Priority' })}
                  </SortableHeader>
                  <SortableHeader
                    column="genre"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="w-[100px] hidden lg:table-cell"
                  >
                    {t('table.genre', { defaultValue: 'Genre' })}
                  </SortableHeader>
                  <SortableHeader
                    column="assignee"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="w-[100px] hidden md:table-cell"
                  >
                    {t('table.assignee', { defaultValue: 'Assignee' })}
                  </SortableHeader>
                  <SortableHeader
                    column="progress"
                    currentSort={sortState}
                    onSort={handleSort}
                    className="w-[80px]"
                  >
                    {t('table.progress', { defaultValue: 'Progress' })}
                  </SortableHeader>
                  <TableHeaderCell className="py-4 px-5 font-medium w-[60px]">
                    <span className="sr-only">
                      {t('table.actions', { defaultValue: 'Actions' })}
                    </span>
                  </TableHeaderCell>
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
        </div>
      </div>
    </div>
  );
}

interface SortableHeaderProps {
  column: SortColumn;
  currentSort: SortState;
  onSort: (column: SortColumn) => void;
  children: React.ReactNode;
  className?: string;
}

function SortableHeader({
  column,
  currentSort,
  onSort,
  children,
  className,
}: SortableHeaderProps) {
  const isActive = currentSort.column === column;
  const isAsc = isActive && currentSort.direction === 'asc';
  const isDesc = isActive && currentSort.direction === 'desc';

  return (
    <TableHeaderCell
      className={cn(
        'py-4 px-5 font-medium text-foreground/70 cursor-pointer select-none hover:bg-muted/50 transition-colors',
        className
      )}
      onClick={() => onSort(column)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(column);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span>{children}</span>
        <div className="flex flex-col">
          {isDesc ? (
            <ArrowDown className="h-3 w-3 text-primary" />
          ) : isAsc ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-50" />
          )}
        </div>
      </div>
    </TableHeaderCell>
  );
}

export const TaskTableView = memo(TaskTableViewComponent);
