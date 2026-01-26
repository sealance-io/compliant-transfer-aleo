# CLAUDE.md

Claude Code configuration for this repository.

## Instructions

See @AGENTS.md for project overview and quick reference.

For detailed documentation:

- @docs/DEVELOPMENT.md - Commands and workflows
- @docs/ARCHITECTURE.md - System design and Leo programs
- @docs/CODE-PATTERNS.md - Code examples and patterns
- @packages/policy-engine-sdk/AGENTS.md - SDK development

## Rules

### npm Security

Always use `--ignore-scripts` flag with npm commands:

- `npm ci --ignore-scripts`
- `npm install --ignore-scripts`

### Git Workflow

- Create commits only when explicitly requested
- Never amend commits after hook failures - create new commits
- Stage specific files, avoid `git add -A` or `git add .`

### Code Style

- Run `npm run format:fix` before committing
- No GPL/AGPL licensed dependencies (run `npm run lint:licenses`)
- Avoid over-engineering - only make requested changes

### Testing

- Tests are computationally intensive
- Use devnode mode (default) for fast local development
- Use `DEVNET=true npm test` for CI/pre-deployment
- Tests MUST run sequentially (shared devnet state)

### SDK Changes

- Always add changeset: `npx changeset`
- Install from root only, never in workspace subdirectories

### Blocked Operations

- Never update `@doko-js/*` packages without verifying against `/patches`
- Never run `npm install` in `packages/*/` directories
