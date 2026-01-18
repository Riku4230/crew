import { useState, useCallback } from 'react';
import { GripVertical, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useDependencyGenres,
  getNextGenreColor,
  DEFAULT_GENRE_COLORS,
} from '@/hooks/useDependencyGenres';
import type { DependencyGenre } from 'shared/types';
import { cn } from '@/lib/utils';

interface DependencyGenreManagerProps {
  projectId: string;
  trigger?: React.ReactNode;
}

export function DependencyGenreManager({
  projectId,
  trigger,
}: DependencyGenreManagerProps) {
  const {
    genres,
    createGenre,
    updateGenre,
    deleteGenre,
    reorderGenres,
    isLoading,
  } = useDependencyGenres(projectId);

  const [open, setOpen] = useState(false);
  const [newGenreName, setNewGenreName] = useState('');
  const [newGenreColor, setNewGenreColor] = useState(
    getNextGenreColor(genres.map((g) => g.color))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!newGenreName.trim()) return;
    await createGenre.mutateAsync({
      name: newGenreName.trim(),
      color: newGenreColor,
    });
    setNewGenreName('');
    setNewGenreColor(
      getNextGenreColor([...genres.map((g) => g.color), newGenreColor])
    );
  }, [newGenreName, newGenreColor, createGenre, genres]);

  const handleStartEdit = useCallback((genre: DependencyGenre) => {
    setEditingId(genre.id);
    setEditName(genre.name);
    setEditColor(genre.color);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;
    await updateGenre.mutateAsync({
      genreId: editingId,
      data: { name: editName.trim(), color: editColor },
    });
    setEditingId(null);
    setEditName('');
    setEditColor('');
  }, [editingId, editName, editColor, updateGenre]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
    setEditColor('');
  }, []);

  const handleDelete = useCallback(
    async (genreId: string) => {
      if (!window.confirm('このジャンルを削除しますか？依存関係のジャンル設定は解除されます。')) {
        return;
      }
      await deleteGenre.mutateAsync(genreId);
    },
    [deleteGenre]
  );

  const handleDragStart = useCallback((genreId: string) => {
    setDraggedId(genreId);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
    },
    []
  );

  const handleDrop = useCallback(
    async (targetId: string) => {
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        return;
      }

      const newOrder = [...genres];
      const draggedIndex = newOrder.findIndex((g) => g.id === draggedId);
      const targetIndex = newOrder.findIndex((g) => g.id === targetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, removed);
        await reorderGenres.mutateAsync(newOrder.map((g) => g.id));
      }
      setDraggedId(null);
    },
    [draggedId, genres, reorderGenres]
  );

  return (
    <>
      {/* Trigger button - clicking opens the dialog */}
      <div onClick={() => setOpen(true)}>
        {trigger || (
          <Button variant="outline" size="sm">
            ジャンル管理
          </Button>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>依存関係ジャンル管理</DialogTitle>
          <DialogDescription>
            依存関係の線に付けるジャンル（カテゴリ）を管理します。
            ジャンルごとに色を設定して、DAGビューで視覚化できます。
          </DialogDescription>
        </DialogHeader>

        <DialogContent>
          <div className="space-y-4">
            {/* New genre input */}
            <div className="flex gap-2">
              <Input
                placeholder="新しいジャンル名"
                value={newGenreName}
                onChange={(e) => setNewGenreName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                className="flex-1"
              />
              <ColorPicker
                value={newGenreColor}
                onChange={setNewGenreColor}
                colors={DEFAULT_GENRE_COLORS}
              />
              <Button
                onClick={handleCreate}
                disabled={!newGenreName.trim() || createGenre.isPending}
                size="icon"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Genre list */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-4">
                  読み込み中...
                </div>
              ) : genres.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  ジャンルがありません。上のフォームから追加してください。
                </div>
              ) : (
                genres.map((genre) => (
                  <div
                    key={genre.id}
                    draggable={editingId !== genre.id}
                    onDragStart={() => handleDragStart(genre.id)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(genre.id)}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-md border',
                      draggedId === genre.id && 'opacity-50',
                      'hover:bg-accent/50 cursor-grab active:cursor-grabbing'
                    )}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                    {editingId === genre.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 h-8"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveEdit();
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                        />
                        <ColorPicker
                          value={editColor}
                          onChange={setEditColor}
                          colors={DEFAULT_GENRE_COLORS}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleSaveEdit}
                          disabled={updateGenre.isPending}
                          className="h-8 w-8"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleCancelEdit}
                          className="h-8 w-8"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: genre.color }}
                        />
                        <span className="flex-1 truncate">{genre.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStartEdit(genre)}
                          className="h-8 w-8"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(genre.id)}
                          disabled={deleteGenre.isPending}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Simple color picker component
interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  colors: string[];
}

function ColorPicker({ value, onChange, colors }: ColorPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-md border flex items-center justify-center hover:ring-2 hover:ring-ring"
        style={{ backgroundColor: value }}
      />
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 top-full left-0 mt-1 p-2 bg-popover border rounded-md shadow-md">
            <div className="grid grid-cols-4 gap-1">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    onChange(color);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-6 h-6 rounded-md hover:ring-2 hover:ring-ring',
                    value === color && 'ring-2 ring-ring'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="mt-2">
              <Input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-8 p-0 cursor-pointer"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DependencyGenreManager;
