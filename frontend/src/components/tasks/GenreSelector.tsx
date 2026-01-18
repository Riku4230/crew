import { useState, useCallback } from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DependencyGenre } from 'shared/types';

interface GenreSelectorProps {
  genres: DependencyGenre[];
  selectedGenreId: string | null;
  onSelect: (genreId: string | null) => void;
  onCreateNew?: (name: string) => Promise<DependencyGenre | undefined>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function GenreSelector({
  genres,
  selectedGenreId,
  onSelect,
  onCreateNew,
  disabled = false,
  placeholder = 'ジャンルを選択',
  className,
}: GenreSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const selectedGenre = genres.find((g) => g.id === selectedGenreId);

  const handleSelect = useCallback(
    (genreId: string | null) => {
      onSelect(genreId);
      setOpen(false);
      setSearchValue('');
    },
    [onSelect]
  );

  const handleCreateNew = useCallback(async () => {
    if (!onCreateNew || !searchValue.trim()) return;

    setIsCreating(true);
    try {
      const newGenre = await onCreateNew(searchValue.trim());
      if (newGenre) {
        handleSelect(newGenre.id);
      }
    } finally {
      setIsCreating(false);
    }
  }, [onCreateNew, searchValue, handleSelect]);

  const filteredGenres = genres.filter((g) =>
    g.name.toLowerCase().includes(searchValue.toLowerCase())
  );

  const showCreateOption =
    onCreateNew &&
    searchValue.trim() &&
    !filteredGenres.some(
      (g) => g.name.toLowerCase() === searchValue.toLowerCase()
    );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between', className)}
        >
          {selectedGenre ? (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedGenre.color }}
              />
              <span className="truncate">{selectedGenre.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[200px]" align="start">
        {/* Search/Create input */}
        {onCreateNew && (
          <>
            <div className="p-2">
              <Input
                placeholder="検索または新規作成..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && showCreateOption) {
                    e.preventDefault();
                    handleCreateNew();
                  }
                  e.stopPropagation();
                }}
                className="h-8"
              />
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Clear selection option */}
        {selectedGenreId && (
          <>
            <DropdownMenuItem onSelect={() => handleSelect(null)}>
              <X className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">解除</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Genre list */}
        <div className="max-h-[200px] overflow-y-auto">
          {filteredGenres.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {searchValue ? 'ジャンルが見つかりません' : 'ジャンルがありません'}
            </div>
          ) : (
            filteredGenres.map((genre) => (
              <DropdownMenuItem
                key={genre.id}
                onSelect={() => handleSelect(genre.id)}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    selectedGenreId === genre.id ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div
                  className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                  style={{ backgroundColor: genre.color }}
                />
                <span className="truncate">{genre.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </div>

        {/* Create new option */}
        {showCreateOption && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleCreateNew}
              disabled={isCreating}
            >
              <Plus className="mr-2 h-4 w-4" />
              「{searchValue}」を作成
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Simpler inline version for quick selection
interface QuickGenreSelectorProps {
  genres: DependencyGenre[];
  selectedGenreId: string | null;
  onSelect: (genreId: string | null) => void;
  disabled?: boolean;
}

export function QuickGenreSelector({
  genres,
  selectedGenreId,
  onSelect,
  disabled = false,
}: QuickGenreSelectorProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Clear button */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        disabled={disabled}
        className={cn(
          'w-6 h-6 rounded-full border-2 flex items-center justify-center',
          'hover:bg-accent transition-colors',
          !selectedGenreId && 'ring-2 ring-ring ring-offset-2',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        title="ジャンルなし"
      >
        <X className="w-3 h-3 text-muted-foreground" />
      </button>
      {genres.map((genre) => (
        <button
          key={genre.id}
          type="button"
          onClick={() => onSelect(genre.id)}
          disabled={disabled}
          className={cn(
            'w-6 h-6 rounded-full',
            'hover:ring-2 hover:ring-ring hover:ring-offset-1 transition-all',
            selectedGenreId === genre.id && 'ring-2 ring-ring ring-offset-2',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          style={{ backgroundColor: genre.color }}
          title={genre.name}
        />
      ))}
    </div>
  );
}

export default GenreSelector;
