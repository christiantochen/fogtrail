## What and why

<!-- What changed, and the problem it solves. Link an issue if there is one. -->

## Commit title

The squash or merge title decides the release, so start it with one of:
`feat:` (new feature, minor), `fix:` or `perf:` (patch), or `docs:` `test:` `ci:`
`refactor:` `chore:` (no release). Use `feat!:` for a breaking change.

## Checklist

- [ ] `npm run lint`, `npm run format:check` and `npm test` pass
- [ ] New or changed UI has a canvas board, e2e specs and screenshots
- [ ] Visual baselines were regenerated in CI, and I looked at the images
- [ ] Nothing here writes to the connected server
