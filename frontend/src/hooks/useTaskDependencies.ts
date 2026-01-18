import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useJsonPatchWsStream } from './useJsonPatchWsStream';
import { dependenciesApi, ApiError } from '@/lib/api';
import type { TaskDependency } from 'shared/types';

export const dependencyKeys = {
  all: ['dependencies'] as const,
  byProject: (projectId: string) =>
    [...dependencyKeys.all, 'project', projectId] as const,
};

type DependenciesState = {
  dependencies: Record<string, TaskDependency>;
};

export function useTaskDependencies(projectId: string | undefined) {
  const endpoint = projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/dependencies/stream/ws`
    : undefined;

  const initialData = useCallback(
    (): DependenciesState => ({ dependencies: {} }),
    []
  );

  const { data, isConnected, isInitialized, error } = useJsonPatchWsStream(
    endpoint,
    !!projectId,
    initialData
  );

  // Convert the record to an array
  const dependencies = useMemo(() => {
    if (!data?.dependencies) return [];
    return Object.values(data.dependencies).sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() -
        new Date(a.created_at as string).getTime()
    );
  }, [data?.dependencies]);

  const dependenciesById = useMemo(
    () => data?.dependencies ?? {},
    [data?.dependencies]
  );

  const createDependency = useMutation({
    mutationFn: (input: {
      task_id: string;
      depends_on_task_id: string;
      genre_id?: string | null;
    }) => dependenciesApi.create(projectId!, {
      task_id: input.task_id,
      depends_on_task_id: input.depends_on_task_id,
      genre_id: input.genre_id ?? null,
    }),
    // No need for onSuccess - WebSocket will handle the update
    onError: (err: ApiError) => {
      if (err.status === 409) {
        console.error(
          'Cannot create dependency: This would create a circular dependency or the dependency already exists.',
          err
        );
        window.alert(
          'Cannot create dependency: This would create a circular dependency or the dependency already exists.'
        );
      } else {
        console.error('Failed to create dependency:', err.message);
        window.alert(`Failed to create dependency: ${err.message}`);
      }
    },
  });

  const updateDependency = useMutation({
    mutationFn: ({
      dependencyId,
      data,
    }: {
      dependencyId: string;
      data: { genre_id?: string | null };
    }) => dependenciesApi.update(dependencyId, data),
    // No need for onSuccess - WebSocket will handle the update
    onError: (err: ApiError) => {
      console.error('Failed to update dependency:', err.message);
      window.alert(`Failed to update dependency: ${err.message}`);
    },
  });

  const deleteDependency = useMutation({
    mutationFn: (dependencyId: string) => dependenciesApi.delete(dependencyId),
    // No need for onSuccess - WebSocket will handle the update
    onError: (err: ApiError) => {
      console.error('Failed to delete dependency:', err.message);
      window.alert(`Failed to delete dependency: ${err.message}`);
    },
  });

  const isLoading = !isInitialized && !error;

  return {
    dependencies,
    dependenciesById,
    isLoading,
    isConnected,
    error,
    createDependency,
    updateDependency,
    deleteDependency,
    // Keep for backward compatibility, but no longer needed
    invalidateDependencies: () => {},
    refetch: () => Promise.resolve(),
  };
}

// Helper to get dependency by edge ID (format: "dep-{dependency_id}")
export function getDependencyIdFromEdgeId(edgeId: string): string | null {
  if (edgeId.startsWith('dep-')) {
    return edgeId.slice(4);
  }
  return null;
}

// Helper to create edge ID from dependency
export function createEdgeIdFromDependency(dependency: TaskDependency): string {
  return `dep-${dependency.id}`;
}
