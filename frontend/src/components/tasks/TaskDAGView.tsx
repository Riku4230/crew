import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type EdgeChange,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid, Play, Pause, Square, Wifi, WifiOff, RefreshCw, Plus } from 'lucide-react';
import { TaskFormDialog } from '@/components/dialogs/tasks/TaskFormDialog';
import { TaskDagSidebar, SIDEBAR_TASK_DRAG_TYPE } from './TaskDagSidebar';

import type { TaskWithAttemptStatus, TaskDependency, TaskReadiness } from 'shared/types';
import { TaskDAGNode, type TaskNodeData } from './TaskDagNode';
import { TaskDAGEdge } from './TaskDAGEdge';
import {
  useTaskDependencies,
  createEdgeIdFromDependency,
  getDependencyIdFromEdgeId,
} from '@/hooks/useTaskDependencies';
import { useTaskMutations } from '@/hooks/useTaskMutations';
import { getLayoutedElements } from '@/lib/dagLayout';
// import { useOrchestration } from '@/hooks/useOrchestration'; // Disabled until backend API is ready
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';

const nodeTypes = {
  task: TaskDAGNode,
} as const;

const edgeTypes = {
  dependency: TaskDAGEdge,
};

interface TaskDAGViewProps {
  tasks: TaskWithAttemptStatus[];
  projectId: string;
  onViewDetails: (task: TaskWithAttemptStatus) => void;
}

// Simple layout algorithm: arrange nodes horizontally (left to right)
// Tasks are arranged by creation order, with saved positions taking precedence
function layoutNodes(
  tasks: TaskWithAttemptStatus[],
  onViewDetails: (task: TaskWithAttemptStatus) => void,
  getTaskReadiness?: (taskId: string) => TaskReadiness | undefined
): Node<TaskNodeData>[] {
  const nodeWidth = 220;
  const nodeHeight = 80;
  const horizontalGap = 120;
  const verticalGap = 40;

  // Sort tasks by creation date (oldest first = leftmost)
  const sortedTasks = [...tasks].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const nodes: Node<TaskNodeData>[] = [];
  const maxTasksPerRow = 8; // Wrap to new row after this many tasks

  sortedTasks.forEach((task, index) => {
    const columnIndex = index % maxTasksPerRow;
    const rowIndex = Math.floor(index / maxTasksPerRow);

    // Use saved position if available, otherwise calculate
    const x =
      task.dag_position_x ?? columnIndex * (nodeWidth + horizontalGap);
    const y =
      task.dag_position_y ?? rowIndex * (nodeHeight + verticalGap);

    nodes.push({
      id: task.id,
      type: 'task',
      position: { x, y },
      data: {
        task,
        onViewDetails,
        readiness: getTaskReadiness?.(task.id),
      },
    });
  });

  return nodes;
}

function createEdges(
  dependencies: TaskDependency[],
  onDelete: (edgeId: string) => void
): Edge[] {
  return dependencies.map((dep) => ({
    id: createEdgeIdFromDependency(dep),
    source: dep.depends_on_task_id,
    target: dep.task_id,
    type: 'dependency',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 15,
      height: 15,
    },
    data: {
      onDelete,
    },
  }));
}

// Inner component that uses useReactFlow (must be inside ReactFlowProvider)
const TaskDAGViewInner = memo(function TaskDAGViewInner({
  tasks,
  projectId,
  onViewDetails,
}: TaskDAGViewProps) {
  const { t } = useTranslation('tasks');
  const { fitView, screenToFlowPosition } = useReactFlow();
  const {
    dependencies,
    createDependency,
    deleteDependency,
    isConnected: wsConnected,
  } = useTaskDependencies(projectId);
  const { updateTask } = useTaskMutations(projectId);

  // Track previous dependency count to detect changes
  const prevDepsCountRef = useRef(dependencies.length);
  // Track if initial layout has been applied
  const initialLayoutAppliedRef = useRef(false);

  // Orchestration state and controls - disabled until backend API is ready
  // const {
  //   orchestratorState,
  //   tasksByReadiness,
  //   getTaskReadiness,
  //   wsConnected,
  //   start,
  //   pause,
  //   resume,
  //   stop,
  //   isStarting,
  //   isPausing,
  //   isResuming,
  //   isStopping,
  // } = useOrchestration({ projectId });

  // Temporary placeholders until orchestration backend is ready
  const orchestratorState = 'idle' as 'idle' | 'running' | 'paused' | 'stopping';
  const tasksByReadiness = { ready: [] as string[], blocked: [] as string[], inProgress: [] as string[], completed: [] as string[] };
  const getTaskReadiness = undefined;
  const start = () => {};
  const pause = () => {};
  const resume = () => {};
  const stop = () => {};
  const isStarting = false;
  const isPausing = false;
  const isResuming = false;
  const isStopping = false;

  // State for auto-layout
  const [autoLayoutEnabled, setAutoLayoutEnabled] = useState(true);

  // Calculate progress
  const totalTasks = tasks.length;
  const completedTasksCount = tasks.filter(t => t.status === 'done').length;
  const progressPercent = totalTasks > 0 ? (completedTasksCount / totalTasks) * 100 : 0;

  // Classify tasks based on dag_position: tasks with position are in DAG, others in pool
  const { dagTasks, poolTasks } = useMemo(() => {
    const inDag: TaskWithAttemptStatus[] = [];
    const inPool: TaskWithAttemptStatus[] = [];

    tasks.forEach((task) => {
      // Task is in DAG if it has a position set
      if (task.dag_position_x !== null && task.dag_position_y !== null) {
        inDag.push(task);
      } else {
        inPool.push(task);
      }
    });

    return { dagTasks: inDag, poolTasks: inPool };
  }, [tasks]);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [edgeToDelete, setEdgeToDelete] = useState<string | null>(null);

  const handleEdgeDelete = useCallback((edgeId: string) => {
    setEdgeToDelete(edgeId);
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (edgeToDelete) {
      const dependencyId = getDependencyIdFromEdgeId(edgeToDelete);
      if (dependencyId) {
        deleteDependency.mutate(dependencyId);
      }
    }
    setDeleteDialogOpen(false);
    setEdgeToDelete(null);
  }, [edgeToDelete, deleteDependency]);

  const cancelDelete = useCallback(() => {
    setDeleteDialogOpen(false);
    setEdgeToDelete(null);
  }, []);

  // Create initial nodes and edges (only connected tasks shown in DAG)
  const initialNodes = useMemo(
    () => layoutNodes(dagTasks, onViewDetails, getTaskReadiness),
    [dagTasks, onViewDetails, getTaskReadiness]
  );

  const initialEdges = useMemo(
    () => createEdges(dependencies, handleEdgeDelete),
    [dependencies, handleEdgeDelete]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, defaultOnEdgesChange] = useEdgesState(initialEdges);

  // Custom edge change handler that calls API for deletions
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Separate removal changes from other changes
      const removals = changes.filter((change) => change.type === 'remove');
      const otherChanges = changes.filter((change) => change.type !== 'remove');

      // Apply non-removal changes normally
      if (otherChanges.length > 0) {
        defaultOnEdgesChange(otherChanges);
      }

      // For removals, call API to delete from database
      for (const removal of removals) {
        if (removal.type === 'remove') {
          const dependencyId = getDependencyIdFromEdgeId(removal.id);
          if (dependencyId) {
            deleteDependency.mutate(dependencyId);
          }
        }
      }
    },
    [defaultOnEdgesChange, deleteDependency]
  );

  // Sync when dependencies or connected tasks change
  useEffect(() => {
    const newNodes = layoutNodes(dagTasks, onViewDetails, getTaskReadiness);
    setNodes(newNodes);
  }, [dagTasks, onViewDetails, getTaskReadiness, setNodes]);

  useEffect(() => {
    setEdges(createEdges(dependencies, handleEdgeDelete));
  }, [dependencies, handleEdgeDelete, setEdges]);

  // Auto layout using dagre (Left to Right)
  const applyAutoLayout = useCallback((nodesToLayout: Node<TaskNodeData>[], edgesToLayout: Edge[]) => {
    const layoutedNodes = getLayoutedElements(nodesToLayout, edgesToLayout, {
      direction: 'LR',
      nodeSpacing: 50,
      rankSpacing: 120,
    });
    setNodes(layoutedNodes);
    // Fit view after layout with a small delay to ensure nodes are positioned
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [setNodes, fitView]);

  const onAutoLayout = useCallback(() => {
    applyAutoLayout(nodes, edges);
  }, [nodes, edges, applyAutoLayout]);

  // Stable count values to avoid infinite loops from array reference changes
  const depsCount = dependencies.length;
  const nodesCount = nodes.length;
  const edgesCount = edges.length;

  // Auto-layout when dependencies change (if enabled)
  useEffect(() => {
    const prevDepsCount = prevDepsCountRef.current;

    // Initial layout: apply once when we first have both nodes and edges
    if (!initialLayoutAppliedRef.current && autoLayoutEnabled && nodesCount > 0 && edgesCount > 0) {
      initialLayoutAppliedRef.current = true;
      const timer = setTimeout(() => {
        const freshNodes = layoutNodes(dagTasks, onViewDetails, getTaskReadiness);
        const freshEdges = createEdges(dependencies, handleEdgeDelete);
        applyAutoLayout(freshNodes, freshEdges);
      }, 100);
      prevDepsCountRef.current = depsCount;
      return () => clearTimeout(timer);
    }

    // Subsequent layouts: only when dependencies actually changed
    if (initialLayoutAppliedRef.current && autoLayoutEnabled && depsCount !== prevDepsCount) {
      const freshNodes = layoutNodes(dagTasks, onViewDetails, getTaskReadiness);
      const freshEdges = createEdges(dependencies, handleEdgeDelete);
      applyAutoLayout(freshNodes, freshEdges);
    }

    prevDepsCountRef.current = depsCount;
  }, [depsCount, nodesCount, edgesCount, autoLayoutEnabled, dagTasks, onViewDetails, getTaskReadiness, dependencies, handleEdgeDelete, applyAutoLayout]);

  // Handle new connections (creating dependencies)
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // source = depends_on_task_id (the task that must be completed first)
      // target = task_id (the task that depends on source)
      createDependency.mutate({
        task_id: connection.target,
        depends_on_task_id: connection.source,
      });
    },
    [createDependency]
  );

  // Handle drag over for native HTML5 drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Check if the dragged item is from sidebar
    if (e.dataTransfer.types.includes(SIDEBAR_TASK_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  // Handle drop from sidebar (native HTML5)
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData(SIDEBAR_TASK_DRAG_TYPE);
      if (!taskId) return;

      // Find the dragged task
      const draggedTask = poolTasks.find(t => t.id === taskId);
      if (!draggedTask) return;

      // Convert screen coordinates to flow coordinates
      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      // Update the task with the new position to move it to DAG
      updateTask.mutate({
        taskId: taskId,
        data: {
          title: null,
          description: null,
          status: null,
          parent_workspace_id: null,
          image_ids: null,
          dag_position_x: position.x,
          dag_position_y: position.y,
          clear_dag_position: false,
        },
      });

      // Optionally create a dependency if dropped on an existing node
      const targetElement = document.elementFromPoint(e.clientX, e.clientY);
      const nodeElement = targetElement?.closest('[data-id]');
      const targetNodeId = nodeElement?.getAttribute('data-id');

      if (targetNodeId && targetNodeId !== taskId) {
        // Dropped on an existing node - also create dependency
        createDependency.mutate({
          task_id: taskId,
          depends_on_task_id: targetNodeId,
        });
      }
    },
    [createDependency, poolTasks, screenToFlowPosition, updateTask]
  );

  // Ref for sidebar to detect drops on it
  const sidebarRef = useRef<HTMLDivElement>(null);

  // State to track if dragging over sidebar
  const [isDraggingOverSidebar, setIsDraggingOverSidebar] = useState(false);
  // Ref to track current value for use in callbacks (avoids stale closure)
  const isDraggingOverSidebarRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isDraggingOverSidebarRef.current = isDraggingOverSidebar;
  }, [isDraggingOverSidebar]);

  // Helper to check if mouse is over sidebar
  const isOverSidebar = useCallback((clientX: number, clientY: number) => {
    if (!sidebarRef.current) return false;
    const rect = sidebarRef.current.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, []);

  // Handle node drag start
  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, _node: Node<TaskNodeData>) => {
      // Drag started - could track dragging node if needed
    },
    []
  );

  // Handle node drag - track position for visual feedback
  const handleNodeDrag = useCallback(
    (event: React.MouseEvent, _node: Node<TaskNodeData>) => {
      const overSidebar = isOverSidebar(event.clientX, event.clientY);
      setIsDraggingOverSidebar(overSidebar);
    },
    [isOverSidebar]
  );

  // Handle node drag stop - check if dropped on sidebar to move back to pool
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node<TaskNodeData>) => {
      // Use the ref to get the current value (avoids stale closure issue)
      if (isDraggingOverSidebarRef.current) {
        // Move task back to pool by clearing dag_position
        updateTask.mutate({
          taskId: node.id,
          data: {
            title: null,
            description: null,
            status: null,
            parent_workspace_id: null,
            image_ids: null,
            dag_position_x: null,
            dag_position_y: null,
            clear_dag_position: true,
          },
        });
      }

      // Reset drag state
      setIsDraggingOverSidebar(false);
    },
    [updateTask]
  );

  return (
    <>
      <div className="flex w-full h-full min-h-[500px]">
        {/* Sidebar with isolated tasks */}
        <TaskDagSidebar
          ref={sidebarRef}
          poolTasks={poolTasks}
          onViewDetails={onViewDetails}
          isDropTarget={isDraggingOverSidebar}
        />

      {/* Main DAG area */}
      <div className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: 'dependency',
          }}
          proOptions={{ hideAttribution: true }}
          edgesReconnectable={false}
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Panel position="top-left" className="bg-card/80 backdrop-blur-sm rounded-lg p-2 text-xs text-muted-foreground">
            {t('dag.instructions', 'Drag from bottom handle to top handle to create dependencies')}
          </Panel>
          <Panel position="top-right" className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => TaskFormDialog.show({ mode: 'create', projectId })}
              className="bg-primary text-primary-foreground"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('dag.addTask', 'タスク追加')}
            </Button>
            <Button
              variant={autoLayoutEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoLayoutEnabled(!autoLayoutEnabled)}
              className={autoLayoutEnabled ? "" : "bg-card/80 backdrop-blur-sm"}
              title={autoLayoutEnabled ? t('dag.autoLayoutOn', '自動整列ON') : t('dag.autoLayoutOff', '自動整列OFF')}
            >
              <RefreshCw className={`h-4 w-4 ${autoLayoutEnabled ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoLayout}
              className="bg-card/80 backdrop-blur-sm"
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              {t('dag.autoLayout', '自動整列')}
            </Button>
          </Panel>
          {/* Orchestration Control Panel */}
          <Panel position="bottom-left" className="bg-card/95 backdrop-blur-sm rounded-lg p-3 shadow-lg min-w-[280px]">
            <div className="flex flex-col gap-2">
              {/* Status and Connection indicator */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {t('dag.orchestrator.status', 'ステータス')}:
                  </span>
                  <span className={`font-medium ${
                    orchestratorState === 'running' ? 'text-green-600' :
                    orchestratorState === 'paused' ? 'text-yellow-600' :
                    'text-muted-foreground'
                  }`}>
                    {orchestratorState === 'idle' && t('dag.orchestrator.idle', '待機中')}
                    {orchestratorState === 'running' && t('dag.orchestrator.running', '実行中')}
                    {orchestratorState === 'paused' && t('dag.orchestrator.paused', '一時停止')}
                    {orchestratorState === 'stopping' && t('dag.orchestrator.stopping', '停止中')}
                  </span>
                </div>
                <div className="flex items-center gap-1" title={wsConnected ? 'Connected' : 'Disconnected'}>
                  {wsConnected ? (
                    <Wifi className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('dag.orchestrator.progress', '進捗')}</span>
                  <span>{completedTasksCount}/{totalTasks} ({Math.round(progressPercent)}%)</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>

              {/* Task stats */}
              <div className="flex gap-3 text-xs">
                <span className="text-green-600">
                  {t('dag.orchestrator.ready', '実行可能')}: {tasksByReadiness.ready.length}
                </span>
                <span className="text-blue-600">
                  {t('dag.orchestrator.inProgress', '実行中')}: {tasksByReadiness.inProgress.length}
                </span>
                <span className="text-gray-500">
                  {t('dag.orchestrator.blocked', 'ブロック')}: {tasksByReadiness.blocked.length}
                </span>
              </div>

              {/* Control buttons */}
              <div className="flex gap-2 mt-1">
                {orchestratorState === 'idle' && (
                  <Button
                    size="sm"
                    onClick={() => start()}
                    disabled={isStarting || tasks.length === 0}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4 mr-1" />
                    {t('dag.orchestrator.start', '開始')}
                  </Button>
                )}
                {orchestratorState === 'running' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pause()}
                    disabled={isPausing}
                    className="flex-1"
                  >
                    <Pause className="h-4 w-4 mr-1" />
                    {t('dag.orchestrator.pause', '一時停止')}
                  </Button>
                )}
                {orchestratorState === 'paused' && (
                  <Button
                    size="sm"
                    onClick={() => resume()}
                    disabled={isResuming}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4 mr-1" />
                    {t('dag.orchestrator.resume', '再開')}
                  </Button>
                )}
                {(orchestratorState === 'running' || orchestratorState === 'paused') && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => stop()}
                    disabled={isStopping}
                  >
                    <Square className="h-4 w-4 mr-1" />
                    {t('dag.orchestrator.stop', '停止')}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
          </ReactFlow>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('dag.deleteDialog.title', 'Delete Dependency')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'dag.deleteDialog.description',
                'Are you sure you want to delete this dependency? This action cannot be undone.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>
              {t('dag.deleteDialog.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
            >
              {t('dag.deleteDialog.confirm', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

// Wrapper component with ReactFlowProvider (required for useReactFlow hook)
export const TaskDAGView = memo(function TaskDAGView(props: TaskDAGViewProps) {
  return (
    <ReactFlowProvider>
      <TaskDAGViewInner {...props} />
    </ReactFlowProvider>
  );
});
