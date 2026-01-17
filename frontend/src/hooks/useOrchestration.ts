import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExecutionPlan,
  OrchestratorState,
  OrchestratorEvent,
  TaskReadiness,
} from 'shared/types';
import { orchestrationApi } from '@/lib/api';

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

export const orchestrationKeys = {
  all: ['orchestration'] as const,
  state: (projectId: string) =>
    [...orchestrationKeys.all, 'state', projectId] as const,
};

interface UseOrchestrationOptions {
  projectId: string | undefined;
  enabled?: boolean;
}

export function useOrchestration({
  projectId,
  enabled = true,
}: UseOrchestrationOptions) {
  const queryClient = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);

  // Fetch initial state
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: orchestrationKeys.state(projectId!),
    queryFn: () => orchestrationApi.getState(projectId!),
    enabled: enabled && !!projectId,
    refetchOnWindowFocus: false,
  });

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!enabled || !projectId) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
      window.location.host
    }${orchestrationApi.getStreamUrl(projectId)}`;

    let ws: WebSocket | null = null;
    let reconnectTimeout: number | null = null;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeout = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (event) => {
        try {
          const orcEvent: OrchestratorEvent = JSON.parse(event.data);
          handleOrchestratorEvent(orcEvent);
        } catch (e) {
          console.error('Failed to parse orchestrator event:', e);
        }
      };
    };

    const handleOrchestratorEvent = (event: OrchestratorEvent) => {
      switch (event.type) {
        case 'plan_updated':
          // Update the cached plan
          queryClient.setQueryData(
            orchestrationKeys.state(projectId),
            (old: { state: OrchestratorState; plan: ExecutionPlan } | undefined) =>
              old ? { ...old, plan: event.data.plan } : undefined
          );
          break;

        case 'state_changed':
          // Update the cached state
          queryClient.setQueryData(
            orchestrationKeys.state(projectId),
            (old: { state: OrchestratorState; plan: ExecutionPlan } | undefined) =>
              old ? { ...old, state: event.data.state } : undefined
          );
          break;

        case 'task_started':
        case 'task_completed':
        case 'task_failed':
        case 'task_awaiting_review':
          // Invalidate tasks query to refetch updated task statuses
          queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
          break;
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [projectId, enabled, queryClient]);

  // Mutations for orchestrator control
  const startMutation = useMutation({
    mutationFn: () => orchestrationApi.start(projectId!),
    onSuccess: (result) => {
      queryClient.setQueryData(orchestrationKeys.state(projectId!), result);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => orchestrationApi.pause(projectId!),
    onSuccess: (result) => {
      queryClient.setQueryData(orchestrationKeys.state(projectId!), result);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => orchestrationApi.resume(projectId!),
    onSuccess: (result) => {
      queryClient.setQueryData(orchestrationKeys.state(projectId!), result);
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => orchestrationApi.stop(projectId!),
    onSuccess: (result) => {
      queryClient.setQueryData(orchestrationKeys.state(projectId!), result);
    },
  });

  // Helper to get readiness for a specific task
  const getTaskReadiness = useCallback(
    (taskId: string): TaskReadiness | undefined => {
      if (!data?.plan) return undefined;

      for (const level of data.plan.levels) {
        const task = level.tasks.find((t) => t.task_id === taskId);
        if (task) return task.readiness;
      }
      return undefined;
    },
    [data?.plan]
  );

  // Get tasks grouped by readiness
  const tasksByReadiness = useMemo(() => {
    if (!data?.plan) {
      return {
        ready: [] as string[],
        blocked: [] as string[],
        inProgress: [] as string[],
        completed: [] as string[],
      };
    }

    const result = {
      ready: [] as string[],
      blocked: [] as string[],
      inProgress: [] as string[],
      completed: [] as string[],
    };

    for (const level of data.plan.levels) {
      for (const task of level.tasks) {
        const type = getReadinessType(task.readiness);
        if (type === 'ready') {
          result.ready.push(task.task_id);
        } else if (type === 'blocked') {
          result.blocked.push(task.task_id);
        } else if (type === 'in_progress') {
          result.inProgress.push(task.task_id);
        } else if (type === 'completed') {
          result.completed.push(task.task_id);
        }
      }
    }

    return result;
  }, [data?.plan]);

  return {
    // State
    orchestratorState: data?.state ?? 'idle',
    executionPlan: data?.plan ?? null,
    isLoading,
    error,
    wsConnected,

    // Computed
    tasksByReadiness,
    getTaskReadiness,

    // Actions
    start: startMutation.mutate,
    pause: pauseMutation.mutate,
    resume: resumeMutation.mutate,
    stop: stopMutation.mutate,
    refetch,

    // Mutation states
    isStarting: startMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
