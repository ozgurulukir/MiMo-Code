- Always use superpowers skill instead of builtin plan mode.
- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Git Workflow — Local Fork

This repo is a **local fork** of `XiaomiMiMo/MiMo-Code`. We do NOT open PRs to upstream.
We develop on `local` and periodically pull upstream changes.

Upstream's default branch is `dev` (usually 1-2 commits ahead of `main`).
We track `main` for stability — it receives the same changes slightly later.

### Branch layout

| Branch          | Purpose                                                 |
| --------------- | ------------------------------------------------------- |
| `upstream/main` | Read-only mirror of upstream `main`. Never commit here. |
| `main`          | Tracks `upstream/main` (fetch only). Never commit here. |
| `local`         | **Working branch.** All custom changes live here.       |

### New development

Work directly on `local`. No feature branches, no PRs — just commit and push:

```bash
git add -A && git commit -m "refactor: ..."
git push origin local
```

### Sync with upstream

When upstream releases new changes:

```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts if any, then:
git push origin local
```

Use **merge** (not rebase) to avoid force-push and history rewriting.
The `local` branch accumulates merge commits — this is expected and fine.

## Common Commands

```bash
# Dev (from root)
bun run dev                  # opencode CLI
bun run dev:web              # web app (packages/app)
bun run dev:console          # console app (packages/console/app)
bun run dev:desktop          # desktop app (packages/desktop)

# Tests (from package dirs, NOT root — root has a guard that exits 1)
cd packages/opencode && bun test --timeout 30000

# Lint (from root)
bun run lint                 # oxlint

# Typecheck (from root runs turbo across all packages; from package dir runs tsgo directly)
bun typecheck                # root → turbo typecheck (12 packages, ~15s)
cd packages/opencode && bun typecheck  # single package → tsgo --noEmit
```

### Pre-push hook

`.husky/pre-push` runs `bun typecheck` (full turbo across all packages) on every push.
It also checks that your Bun version matches `packageManager` in `package.json` (`bun@1.3.11`).

### Local-only files (do not commit)

These are excluded via `.git/info/exclude` (not `.gitignore` — keeps upstream PRs clean):

- `.opencode/` — opencode agent configs
- `.code-tandem/` — code analysis index
- `_pm/` — PARA project management
- `.mimocode-project-id` — local app state

`.mimocode/` is in upstream's `.gitignore` already.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Formatting

Prettier config (in root `package.json`): `semi: false`, `printWidth: 120`.

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
