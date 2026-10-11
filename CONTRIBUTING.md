# Contributing

## Workflow

1. Pick a step from [`docs/build-plan.md` §8](docs/build-plan.md#8-task-breakdown) or open an issue.
2. Branch from `main`: `feat/<short-name>`, `fix/<short-name>` or `chore/<short-name>`.
3. Keep PRs small and focused. Run `pnpm check` before pushing.
4. Open a PR using the template. CI must be green before merge. Squash-merge.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org): `feat(gateway): add group discovery`,
`fix(safety): catch "I've fallen"`, `docs: update build plan`.

## Code style

- TypeScript strict mode, ESM only. Biome handles formatting and linting (`pnpm format`).
- Validate every external input (webhooks, MCP tool args, env) with Zod at the boundary.
- Route handlers depend on interfaces (`Store`, clients) so they can be tested without a network.
- Tests live next to each app in `test/` and use Vitest. Safety rules and anything touching
  approvals or payments must have tests.

## Adding a dependency

`pnpm add <pkg> --filter @nonna/gateway`. Prefer the standard library and existing deps.
