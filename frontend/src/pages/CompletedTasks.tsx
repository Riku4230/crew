import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import { tasksApi } from '@/lib/api';

import { useSearch } from '@/contexts/SearchContext';
import { useProject } from '@/contexts/ProjectContext';
import { paths } from '@/lib/paths';
import {
  useKeyExit,
  useKeyFocusSearch,
  useKeyNavUp,
  useKeyNavDown,
  useKeyNavLeft,
  useKeyNavRight,
  Scope,
} from '@/keyboard';

import TaskKanbanBoard, {
  type KanbanColumnItem,
  type KanbanColumns,
} from '@/components/tasks/TaskKanbanBoard';
import { TaskTableView } from '@/components/tasks/TaskTableView';
import { ViewSwitcher } from '@/components/tasks/ViewSwitcher';
import { TaskStatusTabs } from '@/components/tasks/TaskStatusTabs';
import { useTaskView } from '@/contexts/TaskViewContext';
import { useTaskFilters } from '@/contexts/TaskFiltersContext';
import type { DragEndEvent } from '@/components/ui/shadcn-io/kanban';
import {
  useProjectTasks,
  type SharedTaskRecord,
} from '@/hooks/useProjectTasks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { useAuth } from '@/hooks';

import type { TaskWithAttemptStatus, TaskStatus } from 'shared/types';

type Task = TaskWithAttemptStatus;

// Completed statuses only (for DAG archive view)
const TASK_STATUSES = ['done', 'cancelled'] as const;

const normalizeStatus = (status: string): TaskStatus =>
  status.toLowerCase() as TaskStatus;

export function CompletedTasks() {
  const { t } = useTranslation(['tasks', 'common']);
  const { taskId } = useParams<{
    projectId: string;
    taskId?: string;
  }>();
  const navigate = useNavigate();
  const { enableScope, disableScope } = useHotkeysContext();
  const [searchParams] = useSearchParams();
  const [selectedSharedTaskId, setSelectedSharedTaskId] = useState<
    string | null
  >(null);
  const { userId } = useAuth();
  const { viewMode } = useTaskView();
  const { statusFilter } = useTaskFilters();

  const {
    projectId,
    project,
    isLoading: projectLoading,
    error: projectError,
  } = useProject();

  useEffect(() => {
    enableScope(Scope.KANBAN);

    return () => {
      disableScope(Scope.KANBAN);
    };
  }, [enableScope, disableScope]);

  const { query: searchQuery, focusInput } = useSearch();

  const {
    tasks,
    tasksById,
    sharedTasksById,
    sharedOnlyByStatus,
    isLoading,
    error: streamError,
  } = useProjectTasks(projectId || '');

  const selectedTask = useMemo(
    () => (taskId ? (tasksById[taskId] ?? null) : null),
    [taskId, tasksById]
  );


  useEffect(() => {
    if (taskId) {
      setSelectedSharedTaskId(null);
    }
  }, [taskId]);

  useKeyFocusSearch(
    () => {
      focusInput();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyExit(
    () => {
      navigate('/projects');
    },
    { scope: Scope.KANBAN }
  );

  const hasSearch = Boolean(searchQuery.trim());
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const showSharedTasks = searchParams.get('shared') !== 'off';

  useEffect(() => {
    if (showSharedTasks) return;
    if (!selectedSharedTaskId) return;
    const sharedTask = sharedTasksById[selectedSharedTaskId];
    if (sharedTask && sharedTask.assignee_user_id === userId) {
      return;
    }
    setSelectedSharedTaskId(null);
  }, [selectedSharedTaskId, sharedTasksById, showSharedTasks, userId]);

  const kanbanColumns = useMemo(() => {
    // Full columns structure required by KanbanColumns type
    // Only completed statuses are populated (active tasks shown in ProjectTasks page)
    const columns: KanbanColumns = {
      todo: [],
      inprogress: [],
      inreview: [],
      done: [],
      cancelled: [],
    };

    const matchesSearch = (
      title: string,
      description?: string | null
    ): boolean => {
      if (!hasSearch) return true;
      const lowerTitle = title.toLowerCase();
      const lowerDescription = description?.toLowerCase() ?? '';
      return (
        lowerTitle.includes(normalizedSearch) ||
        lowerDescription.includes(normalizedSearch)
      );
    };

    tasks.forEach((task) => {
      const statusKey = normalizeStatus(task.status);

      // Skip active tasks (shown in ProjectTasks page)
      if (statusKey !== 'done' && statusKey !== 'cancelled') {
        return;
      }

      const sharedTask = task.shared_task_id
        ? sharedTasksById[task.shared_task_id]
        : sharedTasksById[task.id];

      if (!matchesSearch(task.title, task.description)) {
        return;
      }

      // Apply status filter
      if (statusFilter.length > 0 && !statusFilter.includes(statusKey)) {
        return;
      }

      const isSharedAssignedElsewhere =
        !showSharedTasks &&
        !!sharedTask &&
        !!sharedTask.assignee_user_id &&
        sharedTask.assignee_user_id !== userId;

      if (isSharedAssignedElsewhere) {
        return;
      }

      columns[statusKey].push({
        type: 'task',
        task,
        sharedTask,
      });
    });

    (
      Object.entries(sharedOnlyByStatus) as [TaskStatus, SharedTaskRecord[]][]
    ).forEach(([status, items]) => {
      // Skip active tasks (shown in ProjectTasks page)
      if (status !== 'done' && status !== 'cancelled') {
        return;
      }
      // Apply status filter to shared tasks too
      if (statusFilter.length > 0 && !statusFilter.includes(status)) {
        return;
      }
      items.forEach((sharedTask) => {
        if (!matchesSearch(sharedTask.title, sharedTask.description)) {
          return;
        }
        const shouldIncludeShared =
          showSharedTasks || sharedTask.assignee_user_id === userId;
        if (!shouldIncludeShared) {
          return;
        }
        columns[status].push({
          type: 'shared',
          task: sharedTask,
        });
      });
    });

    const getTimestamp = (item: KanbanColumnItem) => {
      const createdAt =
        item.type === 'task' ? item.task.created_at : item.task.created_at;
      return new Date(createdAt).getTime();
    };

    TASK_STATUSES.forEach((status) => {
      columns[status].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    });

    return columns;
  }, [
    hasSearch,
    normalizedSearch,
    tasks,
    sharedOnlyByStatus,
    sharedTasksById,
    showSharedTasks,
    userId,
    statusFilter,
  ]);

  const visibleTasksByStatus = useMemo(() => {
    // Only completed statuses
    const map: Partial<Record<TaskStatus, Task[]>> = {
      done: [],
      cancelled: [],
    };

    TASK_STATUSES.forEach((status) => {
      map[status] = kanbanColumns[status]
        .filter((item) => item.type === 'task')
        .map((item) => item.task);
    });

    return map;
  }, [kanbanColumns]);

  const hasVisibleLocalTasks = useMemo(
    () =>
      Object.values(visibleTasksByStatus).some(
        (items) => items && items.length > 0
      ),
    [visibleTasksByStatus]
  );

  const hasVisibleSharedTasks = useMemo(
    () =>
      Object.values(kanbanColumns).some((items) =>
        items?.some((item) => item.type === 'shared')
      ),
    [kanbanColumns]
  );

  useKeyNavUp(
    () => {
      selectPreviousTask();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavDown(
    () => {
      selectNextTask();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavLeft(
    () => {
      selectPreviousColumn();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavRight(
    () => {
      selectNextColumn();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  const handleViewTaskDetails = useCallback(
    (task: Task) => {
      if (!projectId) return;
      setSelectedSharedTaskId(null);
      // Navigate to task in ProjectTasks page for full details
      navigate(`${paths.task(projectId, task.id)}/attempts/latest`);
    },
    [projectId, navigate]
  );

  const handleViewSharedTask = useCallback(
    (sharedTask: SharedTaskRecord) => {
      setSelectedSharedTaskId(sharedTask.id);
      if (projectId) {
        navigate(paths.completedTasks(projectId), { replace: true });
      }
    },
    [navigate, projectId]
  );

  const selectNextTask = useCallback(() => {
    if (selectedTask) {
      const statusKey = normalizeStatus(selectedTask.status);
      const tasksInStatus = visibleTasksByStatus[statusKey] || [];
      const currentIndex = tasksInStatus.findIndex(
        (task) => task.id === selectedTask.id
      );
      if (currentIndex >= 0 && currentIndex < tasksInStatus.length - 1) {
        handleViewTaskDetails(tasksInStatus[currentIndex + 1]);
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectPreviousTask = useCallback(() => {
    if (selectedTask) {
      const statusKey = normalizeStatus(selectedTask.status);
      const tasksInStatus = visibleTasksByStatus[statusKey] || [];
      const currentIndex = tasksInStatus.findIndex(
        (task) => task.id === selectedTask.id
      );
      if (currentIndex > 0) {
        handleViewTaskDetails(tasksInStatus[currentIndex - 1]);
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectNextColumn = useCallback(() => {
    if (selectedTask) {
      const currentStatus = normalizeStatus(selectedTask.status);
      const currentIndex = TASK_STATUSES.findIndex(
        (status) => status === currentStatus
      );
      for (let i = currentIndex + 1; i < TASK_STATUSES.length; i++) {
        const tasks = visibleTasksByStatus[TASK_STATUSES[i]];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          return;
        }
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectPreviousColumn = useCallback(() => {
    if (selectedTask) {
      const currentStatus = normalizeStatus(selectedTask.status);
      const currentIndex = TASK_STATUSES.findIndex(
        (status) => status === currentStatus
      );
      for (let i = currentIndex - 1; i >= 0; i--) {
        const tasks = visibleTasksByStatus[TASK_STATUSES[i]];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          return;
        }
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const draggedTaskId = active.id as string;
      const newStatus = over.id as Task['status'];
      const task = tasksById[draggedTaskId];
      if (!task || task.status === newStatus) return;

      try {
        await tasksApi.update(draggedTaskId, {
          title: task.title,
          description: task.description,
          status: newStatus,
          parent_workspace_id: task.parent_workspace_id,
          image_ids: null,
          dag_position_x: null,
          dag_position_y: null,
          clear_dag_position: false,
        });
      } catch (err) {
        console.error('Failed to update task status:', err);
      }
    },
    [tasksById]
  );


  const isInitialTasksLoad = isLoading && tasks.length === 0;

  // Only show full-page error if we have no project data at all
  if (projectError && !project) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            {t('common:states.error')}
          </AlertTitle>
          <AlertDescription>
            {projectError.message || 'Failed to load project'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (projectLoading && isInitialTasksLoad) {
    return <Loader message={t('loading')} size={32} className="py-8" />;
  }

  const taskListContent =
    !hasVisibleLocalTasks && !hasVisibleSharedTasks ? (
      <div className="flex items-center justify-center h-full min-h-[400px] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-center">
              {hasSearch
                ? t('empty.noSearchResults')
                : t('empty.noCompletedTasks', {
                    defaultValue: '完了したタスクはありません',
                  })}
            </p>
          </CardContent>
        </Card>
      </div>
    ) : viewMode === 'table' ? (
      <TaskTableView
        columns={kanbanColumns}
        onViewTaskDetails={handleViewTaskDetails}
        onViewSharedTask={handleViewSharedTask}
        selectedTaskId={selectedTask?.id}
        selectedSharedTaskId={selectedSharedTaskId}
      />
    ) : (
      <div className="w-full h-full overflow-x-auto overflow-y-auto overscroll-x-contain">
        <TaskKanbanBoard
          columns={kanbanColumns}
          onDragEnd={handleDragEnd}
          onViewTaskDetails={handleViewTaskDetails}
          onViewSharedTask={handleViewSharedTask}
          selectedTaskId={selectedTask?.id}
          selectedSharedTaskId={selectedSharedTaskId}
          projectId={projectId!}
          visibleStatuses={['done', 'cancelled']}
        />
      </div>
    );

  const connectionError =
    streamError || (projectError && project ? projectError.message : null);

  return (
    <div className="h-full flex flex-col">
      {connectionError && (
        <Alert className="w-full z-30 xl:sticky xl:top-0">
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            {t('common:states.reconnecting')}
          </AlertTitle>
          <AlertDescription>{connectionError}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 gap-4">
          {viewMode === 'dag' ? <TaskStatusTabs /> : <div />}
          <ViewSwitcher />
        </div>
        <div className="flex-1 min-h-0">{taskListContent}</div>
      </div>
    </div>
  );
}
