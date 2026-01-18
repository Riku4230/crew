import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useJsonPatchWsStream } from './useJsonPatchWsStream';
import { dependencyGenresApi, ApiError } from '@/lib/api';
import type { DependencyGenre } from 'shared/types';

export const genreKeys = {
  all: ['dependency-genres'] as const,
  byProject: (projectId: string) =>
    [...genreKeys.all, 'project', projectId] as const,
};

type GenresState = {
  dependency_genres: Record<string, DependencyGenre>;
};

export function useDependencyGenres(projectId: string | undefined) {
  const endpoint = projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/dependency-genres/stream/ws`
    : undefined;

  const initialData = useCallback(
    (): GenresState => ({ dependency_genres: {} }),
    []
  );

  const { data, isConnected, isInitialized, error } = useJsonPatchWsStream(
    endpoint,
    !!projectId,
    initialData
  );

  // Convert the record to an array, sorted by position
  const genres = useMemo(() => {
    if (!data?.dependency_genres) return [];
    return Object.values(data.dependency_genres).sort(
      (a, b) => a.position - b.position
    );
  }, [data?.dependency_genres]);

  const genresById = useMemo(
    () => data?.dependency_genres ?? {},
    [data?.dependency_genres]
  );

  // Create a lookup map from genre_id to genre for quick access
  const genreColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const genre of genres) {
      map[genre.id] = genre.color;
    }
    return map;
  }, [genres]);

  const createGenre = useMutation({
    mutationFn: (input: { name: string; color?: string | null; position?: number | null }) =>
      dependencyGenresApi.create(projectId!, {
        name: input.name,
        color: input.color ?? null,
        position: input.position ?? null,
      }),
    onError: (err: ApiError) => {
      if (err.status === 409) {
        console.error('Cannot create genre: Genre with this name already exists.', err);
        window.alert('Cannot create genre: Genre with this name already exists.');
      } else {
        console.error('Failed to create genre:', err.message);
        window.alert(`Failed to create genre: ${err.message}`);
      }
    },
  });

  const updateGenre = useMutation({
    mutationFn: ({
      genreId,
      data,
    }: {
      genreId: string;
      data: { name?: string; color?: string; position?: number };
    }) => dependencyGenresApi.update(genreId, data),
    onError: (err: ApiError) => {
      console.error('Failed to update genre:', err.message);
      window.alert(`Failed to update genre: ${err.message}`);
    },
  });

  const deleteGenre = useMutation({
    mutationFn: (genreId: string) => dependencyGenresApi.delete(genreId),
    onError: (err: ApiError) => {
      console.error('Failed to delete genre:', err.message);
      window.alert(`Failed to delete genre: ${err.message}`);
    },
  });

  const reorderGenres = useMutation({
    mutationFn: (genreIds: string[]) =>
      dependencyGenresApi.reorder(projectId!, genreIds),
    onError: (err: ApiError) => {
      console.error('Failed to reorder genres:', err.message);
      window.alert(`Failed to reorder genres: ${err.message}`);
    },
  });

  const isLoading = !isInitialized && !error;

  return {
    genres,
    genresById,
    genreColorMap,
    isLoading,
    isConnected,
    error,
    createGenre,
    updateGenre,
    deleteGenre,
    reorderGenres,
  };
}

// Helper to get a color for a genre, with a fallback for no genre
export function getGenreColor(
  genreId: string | null | undefined,
  genreColorMap: Record<string, string>,
  defaultColor = '#808080'
): string {
  if (!genreId) return defaultColor;
  return genreColorMap[genreId] ?? defaultColor;
}

// Default colors for new genres (pastel colors that work well with dark/light themes)
export const DEFAULT_GENRE_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

// Get the next suggested color for a new genre
export function getNextGenreColor(existingColors: string[]): string {
  for (const color of DEFAULT_GENRE_COLORS) {
    if (!existingColors.includes(color)) {
      return color;
    }
  }
  // If all default colors are used, return a random one
  return DEFAULT_GENRE_COLORS[Math.floor(Math.random() * DEFAULT_GENRE_COLORS.length)];
}
