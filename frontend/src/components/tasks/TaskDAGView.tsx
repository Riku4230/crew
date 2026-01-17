import { memo, useCallback, useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid, Play, Pause, Square, Wifi, WifiOff } from 'lucide-react';

import type { TaskWithAttemptStatus, TaskDependency, TaskReadiness } from 'shared/types';
import { TaskDAGNode, type TaskNodeData } from './TaskDagNode';
import { TaskDAGEdge } from './TaskDAGEdge';
import {
  useTaskDependencies,
  createEdgeIdFromDependency,
  getDependencyIdFromEdgeId,
} from '@/hooks/useTaskDependencies';
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

export const TaskDAGView = memo(function TaskDAGView({
  tasks,
  projectId,
  onViewDetails,
}: TaskDAGViewProps) {
  const { t } = useTranslation('tasks');
  const {
    dependencies,
    createDependency,
    deleteDependency,
  } = useTaskDependencies(projectId);

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
  const wsConnected = false;
  const start = () => {};
  const pause = () => {};
  const resume = () => {};
  const stop = () => {};
  const isStarting = false;
  const isPausing = false;
  const isResuming = false;
  const isStopping = false;

  // Calculate progress
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const progressPercent = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

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

  // Create initial nodes and edges
  const initialNodes = useMemo(
    () => layoutNodes(tasks, onViewDetails, getTaskReadiness),
    [tasks, onViewDetails, getTaskReadiness]
  );

  const initialEdges = useMemo(
    () => createEdges(dependencies, handleEdgeDelete),
    [dependencies, handleEdgeDelete]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when dependencies or tasks change
  useEffect(() => {
    const newNodes = layoutNodes(tasks, onViewDetails, getTaskReadiness);
    setNodes(newNodes);
  }, [tasks, onViewDetails, getTaskReadiness, setNodes]);

  useEffect(() => {
    setEdges(createEdges(dependencies, handleEdgeDelete));
  }, [dependencies, handleEdgeDelete, setEdges]);

  // Auto layout using dagre (Left to Right)
  const onAutoLayout = useCallback(() => {
    const layoutedNodes = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      nodeSpacing: 50,
      rankSpacing: 120,
    });
    setNodes(layoutedNodes);
  }, [nodes, edges, setNodes]);

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

  return (
    <>
      <div className="w-full h-full min-h-[500px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: 'dependency',
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Panel position="top-left" className="bg-card/80 backdrop-blur-sm rounded-lg p-2 text-xs text-muted-foreground">
            {t('dag.instructions', 'Drag from bottom handle to top handle to create dependencies')}
          </Panel>
          <Panel position="top-right" className="flex gap-2">
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
                  <span>{completedTasks}/{totalTasks} ({Math.round(progressPercent)}%)</span>
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
