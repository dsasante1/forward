# forward-docs

Keep a project's **Forward** documentation (API docs, ER/UML, infrastructure,
flows, and agents/MCP) in sync with its code — automatically, on every change
that lands on the default branch — **without locking you into any particular
AI**.

## How it works

The pipeline splits into two halves. Everything except the thinking is fixed and
model-free; only the middle step is "bring your own AI":

```
push to default branch (PR merge or direct)
        │
        ▼
 ┌──────────────────────────┐
 │ your AI (any provider)   │  reads the diff + FORWARD_DOCS.md,
 │                          │  writes forward-docs.json
 └──────────────────────────┘
        │  forward-docs.json  (content only — no coordinates, no secrets)
        ▼
 ┌──────────────────────────┐
 │ forward-docs apply       │  validates → checkpoints → writes to Forward
 │ (this package)           │  via forward-core/api. Holds the token; no AI.
 └──────────────────────────┘
```

- **The AI never sees the Forward token** and never calls the API. It only writes
  a JSON file. Swap Claude for GPT, Gemini, a local model — nothing here cares.
- **`apply` is deterministic.** It captures recovery state *before* writing,
  fills in geometry/timestamps, re-validates every object against the canonical
  `forward-core` schema, and writes nodes before the edges/flows that reference
  them. A malformed plan fails loudly and writes nothing.
- **Recoverable.** The server checkpoint it takes first snapshots **design
  elements + the infra graph** (and API bindings, which live on elements). The
  layers the checkpoint doesn't cover — **ER entities/relations and the
  Agents/MCP layer** — are written to a re-appliable `forward-docs.rollback.json`
  (prior state) so those can be reverted too. (Re-applying restores overwritten
  content; it won't delete nodes a run newly created.)
- **Idempotent.** Elements resolve by their `@adc <id>` anchor and infra/entities
  by stable ids, so re-runs *update in place* instead of duplicating, a
  human-arranged layout is never moved, and an unchanged API binding is skipped
  (no duplicate history entry).

## Setup (in your repo)

1. **Token** — mint a project API token in the Forward dashboard and add it as
   the repo secret `FORWARD_API_TOKEN`.
2. **Workflow** — copy [`templates/forward-docs.yml`](./templates/forward-docs.yml)
   to `.github/workflows/forward-docs.yml` and set `FORWARD_API_BASE_URL` +
   `FORWARD_PROJECT_ID`.
3. **Instructions** — copy [`FORWARD_DOCS.md`](./FORWARD_DOCS.md) into your repo;
   your AI step reads it as its prompt.
4. **Your AI** — fill in the marked "Generate forward-docs.json" step with
   however you run your agent, and add its provider key as a secret.
5. **Anchors** — keep `@adc <id>` comments next to documented endpoints (the
   Forward VS Code extension writes them).

## The `forward-docs.json` contract

The one thing the AI produces. It is a *content* contract derived directly from
the `forward-core` schema — see [`FORWARD_DOCS.md`](./FORWARD_DOCS.md) for the
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

Customers don't install anything — they reference the composite action, which
runs from a single pre-bundled file (`dist/action.mjs`, ~150kb, `forward-core` +
`zod` inlined). Node is preinstalled on runners, so there's no npm/registry step:

```yaml
- uses: dsasante1/forward/apps/docs-ci@docs-ci-v1
  with:
    api-base-url: https://api.forward.dev
    project-id: project_xxx
    api-token: ${{ secrets.FORWARD_API_TOKEN }}
```

### Releasing (maintainers)

Tags are namespaced `docs-ci-v*` on purpose: the extension publisher
(`.github/workflows/release.yml`) fires on `v*`, so a plain `v1` would wrongly
trigger a Marketplace publish. `docs-ci-v1` does not match `v*`.

`dist/action.mjs` is a **committed build artifact** (a `.gitignore` carve-out
re-includes just that file). To cut a release:

```bash
npm run build -w apps/docs-ci            # refresh the bundle
git commit -am "release(docs-ci): vX.Y.Z"
git tag docs-ci-vX.Y.Z                    # immutable release
git tag -f docs-ci-v1                      # move the major customers pin
git push origin docs-ci-vX.Y.Z && git push -f origin docs-ci-v1
```

The ref a customer pins must contain the built file — this is the standard
JS-Action convention.

## CLI (local / non-Action use)

```
forward-docs apply [path]     # default: ./forward-docs.json
```

Environment: `FORWARD_API_BASE_URL`, `FORWARD_PROJECT_ID`, `FORWARD_API_TOKEN`
(required); `FORWARD_COMMIT`, `FORWARD_COMMIT_MESSAGE` (optional — default a
binding's version + change log). Exit code `0` when everything applied (or the
plan was empty), `1` if any write failed — the checkpoint id (design + infra)
and, when the ER/Agents/MCP layers were touched, the
`forward-docs.rollback.json` path are printed so you can restore.

## Access

The `api-token` must be owned by an **editor** or **owner** of the project — the
server denies `viewer`-owned tokens on writes. Whoever sets up CI (a project
owner) satisfies this.
