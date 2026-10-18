# forward-docs

Keep a repository's **Forward** documentation (API docs, ER, infrastructure,
flows, and agents/MCP) in sync with its code automatically, on every pull
request, **without locking you into any particular AI**.

## How it works

Everything except the thinking is fixed and model-free. Only the middle step is
"bring your own AI":

```
pull request opened or updated
        │
        ▼
 ┌──────────────────────────┐
 │ your AI (any provider)   │  reads the diff + FORWARD_DOCS.md,
 │                          │  writes forward-docs.json
 └──────────────────────────┘
        │  forward-docs.json  (content only, no coordinates)
        ▼
 ┌──────────────────────────┐
 │ forward-docs apply       │  validates → writes .forward/ files
 │ (this package)           │  via forward-core/repo. No AI.
 └──────────────────────────┘
        │
        ▼
 commit .forward/ back to the PR branch, reviewed and merged with the code
```

- **The AI only writes a JSON file.** It never edits `.forward/` itself, so a
  confused model can't corrupt the project. Swap Claude for GPT, Gemini or a
  local model; nothing here cares.
- **`apply` is deterministic.** It fills in geometry and timestamps, re-validates
  every object against the canonical `forward-core` schema, and writes nodes
  before the edges/flows that reference them. A malformed plan fails loudly and
  writes nothing.
- **Git is the undo.** Every write is a file change in the PR, so a bad run is
  one `git checkout -- .forward` or a reverted commit away.
- **Idempotent.** Elements resolve by their `@adc <id>` anchor and
  infra/entities by stable ids, so re-runs update in place instead of
  duplicating, a human-arranged layout is never moved, and an unchanged API
  binding is skipped (no duplicate history entry).

An agent that has the `forward` MCP server connected can skip the JSON plan and
edit `.forward/` through its tools instead. This pipeline is for teams that want
the deterministic, model-agnostic path.

## Setup (in your repo)

1. **Project** — create `.forward/` with `npx -y -p forward-mcp forward init`.
2. **Workflow** — copy [`templates/forward-docs.yml`](./templates/forward-docs.yml)
   to `.github/workflows/forward-docs.yml`.
3. **Instructions** — copy [`FORWARD_DOCS.md`](./FORWARD_DOCS.md) into your repo;
   your AI step reads it as its prompt.
4. **Your AI** — fill in the marked "Generate forward-docs.json" step with
   however you run your agent, and add its provider key as a secret.
5. **Anchors** — keep `@adc <id>` comments next to documented endpoints (the
   Forward VS Code extension and the `forward` CLI write them).

The template runs on pull requests from the same repository. Fork PRs get no
secrets, so the AI step can't run for them and the job skips them. Commits pushed
with `GITHUB_TOKEN` don't trigger new workflow runs, so the commit-back can't loop.

Your agent reads the pull request's own diff, which is untrusted input: a PR can
carry text written to steer it (prompt injection). The job holds `contents: write`
and your AI provider key, so give the agent the narrowest tools that work (file
read/write rather than a shell) and keep the same-repository guard in place.
`forward-docs apply` validates every plan against the schema before writing, and
the result lands in the PR for review like any other change.

## The `forward-docs.json` contract

The one thing the AI produces. It is a *content* contract derived directly from
the `forward-core` schema; see [`FORWARD_DOCS.md`](./FORWARD_DOCS.md) for the
full shape and rules. Minimal example:

```json
{
  "version": 1,
  "bindings": [
    { "elementId": "el_9f2c", "title": "POST /auth/login",
      "description": "Email+password login. Returns a session cookie." }
  ]
}
```

## Distribution: a bundled GitHub Action

There is nothing to install: the composite action runs from a single
pre-bundled file (`dist/action.mjs`, with `forward-core` and `zod` inlined).
Node is preinstalled on runners, so there's no npm step:

```yaml
- uses: dsasante1/forward/apps/docs-ci@docs-ci-v2   # or pin docs-ci-v2.x.y / a commit sha
  with:
    commit: ${{ github.event.pull_request.head.sha }}
    commit-message: ${{ github.event.pull_request.title }}
```

### Releasing (maintainers)

Tags are namespaced `docs-ci-v*` on purpose: the main release workflow
(`.github/workflows/release.yml`) fires on `v*`, so a plain `v1` would wrongly
trigger a Marketplace and npm publish. `docs-ci-v2` does not match `v*`.

`docs-ci-v1` is the retired hosted-server API (it required `api-base-url`,
`project-id` and `api-token`). Repo mode removed those inputs, so it is a new
major: `docs-ci-v2`. Leave `docs-ci-v1` where it is.

`dist/action.mjs` is a **committed build artifact** (a `.gitignore` carve-out
re-includes just that file). To cut a release:

```bash
npm run build -w apps/docs-ci            # refresh the bundle
git commit -am "release(docs-ci): vX.Y.Z"
git tag docs-ci-vX.Y.Z                    # immutable release
git tag -f docs-ci-v2                      # move the major pin
git push origin docs-ci-vX.Y.Z && git push -f origin docs-ci-v2
```

## CLI (local / non-Action use)

```
forward-docs apply [path]     # default: ./forward-docs.json
```

Run it inside a repository that has `.forward/` (or set `FORWARD_REPO`).
Optional environment: `FORWARD_COMMIT` and `FORWARD_COMMIT_MESSAGE` default a
binding's version and change log; `FORWARD_AUTHOR` sets the author stamped on
writes (default `forward-docs`). Exit code `0` when everything applied (or the
plan was empty), `1` if any write failed.
