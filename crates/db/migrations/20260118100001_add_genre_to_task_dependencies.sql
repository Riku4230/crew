-- Add genre_id to task_dependencies for categorizing dependencies
-- genre_id is optional (nullable) and references dependency_genres

ALTER TABLE task_dependencies ADD COLUMN genre_id BLOB REFERENCES dependency_genres(id) ON DELETE SET NULL;

-- Index for efficient lookup of dependencies by genre
CREATE INDEX idx_task_dependencies_genre_id ON task_dependencies(genre_id);
