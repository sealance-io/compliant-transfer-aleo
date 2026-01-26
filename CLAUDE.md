# CLAUDE.md

Claude Code configuration for this repository.

## Instructions

See @AGENTS.md for project overview, quick reference, and documentation index.

## Rules

Context-specific rules load automatically from `.claude/rules/` based on file paths.

### Git Workflow

- Create commits only when explicitly requested
- Never amend commits after hook failures - create new commits
- Stage specific files, avoid `git add -A` or `git add .`

### Code Style

- Run `npm run format:fix` before committing
- No GPL/AGPL licensed dependencies (run `npm run lint:licenses`)
- Avoid over-engineering - only make requested changes
