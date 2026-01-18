-- Dependency genres table for categorizing task dependencies
-- Each genre has a name, color, and position for ordering

CREATE TABLE dependency_genres (
    id BLOB PRIMARY KEY,
    project_id BLOB NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#808080',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, name)
);

-- Index for efficient lookup of genres by project
CREATE INDEX idx_dependency_genres_project_id ON dependency_genres(project_id);

-- Index for ordering by position
CREATE INDEX idx_dependency_genres_position ON dependency_genres(project_id, position);
