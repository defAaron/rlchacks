# Graft

> Remember what code had to become to get merged, and graft that rewrite onto the next change.

Graft turns merged pull request history into **rewrite recipes** — paired evidence of rejected code, the review feedback that blocked it, and the accepted code that eventually shipped. Coding agents and developers query Graft before (or while) writing changes and receive concrete, evidence-backed patches they can apply.

## Docs

- [Product Requirements (PRD)](docs/PRD.md)
- [Technical Requirements (TRD)](docs/TRD.md)
- [Build Plan](docs/BUILD_PLAN.md)
- [Ingest / mid-size backfill](docs/ingest.md)

## CLI exit codes

Per [TRD §9](docs/TRD.md):

| Code | Meaning |
| --- | --- |
| `0` | Ok |
| `1` | Usage / general error |
| `2` | No data — `GRAFT_NO_DATA` (repo not ingested; used by later serve/suggest/MCP stages) |
| `3` | GitHub / auth failure (missing `GITHUB_TOKEN`, bad token, 404 repo, rate limit exhausted) |

`GRAFT_NO_DATA` is exported from `@graft/shared` as `GraftErrorCodes.GRAFT_NO_DATA` with helper `graftNoDataError(repo?)` for stages that read recipes before ingest.
