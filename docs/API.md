# Graft HTTP / GraphQL API

Phase 6 serving surface for the VS Code extension and other clients.

## Start server

```bash
export GRAFT_REPO=owner/name
export DATA_DIR=./data
npm run build
npm run graft -- serve api [--repo owner/name] [--host 127.0.0.1] [--port 8787]
```

## Auth (optional)

When `API_TOKEN` is set, all `/graphql` and `/health` requests require:

```http
Authorization: Bearer <API_TOKEN>
```

Local demo mode: leave `API_TOKEN` unset.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/health` | GET | `{ status, repo }` |
| `/graphql` | POST | GraphQL queries + mutations |

## Example queries

List recipes:

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ recipes(limit: 5) { id title confidence support suppressed } freshness { stale } }"}'
```

Suggest grafts:

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query($d:String!){ suggestGrafts(diff:$d){ recipeId score confidence evidence{ commentUrl } } }","variables":{"d":"'"$(cat testdata/fixtures/rejected-types.diff | sed 's/"/\\"/g')"'"}'
```

Suppress recipe:

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation($id:ID!){ suppressRecipe(id:$id, suppressed:true){ id suppressed } }","variables":{"id":"<recipe-id>"}}'
```

Apply preview (no write):

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query($id:ID!,$p:String!){ applyPreview(recipeId:$id,path:$p){ unifiedDiff warnings } }","variables":{"id":"<recipe-id>","p":"src/types.ts"}}'
```

Freshness:

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ freshness { stale reason ingestAt compileAt episodes recipes } }"}'
```

## Incremental ingest note

Second `graft ingest` uses the persisted ingest cursor (`since`) and only fetches merged PRs newer than the watermark. Link/compile currently reprocess all episodes (full recompile) — simpler and correct; optimize to delta link/compile in a later phase if needed.
