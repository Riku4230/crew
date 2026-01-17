#!/bin/bash
# Git add workaround for files that can't be staged normally
# Usage: ./scripts/git-add-force.sh <file1> <file2> ...

for file in "$@"; do
  if [ -f "$file" ]; then
    echo "Staging: $file"
    git update-index --add --cacheinfo 100644 $(git hash-object -w "$file") "$file"
  else
    echo "Warning: $file not found, skipping"
  fi
done

git status --short "$@"
