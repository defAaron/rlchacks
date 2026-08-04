# Graft — Security

What must **never** be committed to GitHub or written into artifact trees under `data/`.

## Secrets and credentials

| Item | Where it lives | Git policy |
| --- | --- | --- |
| `GITHUB_TOKEN` | `.env` only | **Never commit** — covered by `.gitignore` |
| `API_TOKEN` / webhook secrets | `.env` only | **Never commit** |
| LLM API keys (`ANTHROPIC_API_KEY`, etc.) | `.env` only | **Never commit** |
| Private keys / PEM files | N/A in repo | **Never commit** |
| Real PATs in code or docs | N/A | Use placeholders like `ghp_[REDACTED]` |

Copy `.env.example` to `.env` locally. Example files must contain **empty or placeholder** values only.

## Local data (`DATA_DIR`)

The entire `data/` directory is gitignored. It may contain:

- Raw PR comments and file blobs from private repositories
- Linked episodes and compiled recipes derived from that history

Only **sanitized fixtures** under `testdata/` belong in the repo. Fixture tokens should be obviously fake (e.g. `ghp_fixture_token`, not real PATs).

## Redaction (SAF-3)

Graft scrubs secret-looking strings **on persist** (ingest, link, compile):

- GitHub tokens (`ghp_`, `gho_`, `github_pat_`)
- OpenAI-style keys (`sk-…`)
- AWS access key ids (`AKIA…`)
- PEM private key blocks
- Common `api_key=` / `token=` assignment patterns

Redaction is heuristic — treat `data/` as sensitive even after scrubbing.

## Multi-repo scope (SAF-1)

Set `GRAFT_REPO_ALLOWLIST=owner/repo,other/repo` to refuse reads/writes for unlisted repos. MCP, API, and CLI all resolve repo scope via `resolveGraftConfig`.

## Pre-push checklist

```bash
git status
grep -R "ghp_[A-Za-z0-9]\{20" --exclude-dir=node_modules --exclude-dir=data .
grep -R "GITHUB_TOKEN=gh" .env.example docs/ testdata/ || true
test ! -f .env || git check-ignore -q .env
```

If you find a real secret in tracked files: rotate the credential, redact the file, and log the footgun in `errors.md`.
