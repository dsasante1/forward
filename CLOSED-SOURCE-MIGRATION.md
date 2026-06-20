# Forward → Closed-Source SaaS: Migration Recommendations

A plan for converting Forward from an open-source, BYOD (Bring-Your-Own-Database)
project into a closed-source, centrally-hosted product where **you** own
authentication, sign-up, the database, and the cloud infrastructure.

> Grounded in a review of the current code: `packages/shared` (`schema.ts`,
> `rtdb-rest.ts`), `apps/extension/src/extension.ts`, `apps/canvas/src/firebase.ts`,
> and `apps/canvas/firebase.rules.json`.

---

## 1. The core reframe

Today, by design, there is **no central server**: each user brings their own
Firebase RTDB, the RTDB *is* the live two-way sync bus, and all three surfaces
(canvas, extension, MCP) talk to it directly.

Going closed-source is the easy part (a license + repo change). **The real work
is adding the one component the current architecture deliberately omits — your
backend API — and making it the only thing that holds DB credentials.** Clients
stop touching the database directly. That single move is what enables auth,
billing, multi-tenancy, and keeping your logic private.

```
TODAY:   canvas ─┐
         ext ────┼──► (user's own) Firebase RTDB   ← the sync bus
         mcp ────┘

TARGET:  canvas ─┐                                  ┌─► your DB
         ext ────┼──► YOUR API (auth + authz) ──────┤
         mcp ────┘        ▲ realtime (WS/SSE) ───────┘
```

### What the codebase already did right

All DB access already flows through `forward-core` (`paths` + `rtdb-rest`).
Nothing hand-builds paths or talks to Firebase ad hoc. You can therefore swap the
*implementation* behind that contract — turn `rtdb-rest.ts` into an `api-client.ts`
pointing at `https://api.yourdomain.com` — and the canvas/extension/MCP barely
change. **Your migration surface is one module, not the whole app.**

---

## 2. Repo & licensing split

Don't just flip the `LICENSE` on a single repo.

- **Private repo:** the new backend API, realtime gateway, billing, infra — your
  actual moat.
- **Client code (the extension especially):** the VS Code extension is JavaScript
  that runs on the user's machine — it is **inherently inspectable** regardless of
  license. **Never put a secret in it.** It authenticates a user and calls your API
  with a per-user token.
- Change `LICENSE`, scrub git history for any committed secrets, and retire the
  privileged-token model (see Liability #1 below) in favor of per-user tokens.

---

## 3. Liabilities the code review surfaced

These are fine for BYOD-with-Firebase-rules, but become security holes the moment
*you* host everything.

| # | Liability | Where | Fix |
|---|-----------|-------|-----|
| 1 | **Extension holds an admin god-token** that bypasses all rules, read from plaintext VS Code settings. | `firebase.rules.json:3`, `extension.ts:83` | Replace with a per-user, non-admin OAuth token. The admin token must not exist in a SaaS. |
| 2 | **Secrets travel in the query string** (`?auth=<token>`) — leaks into logs, proxies, history. | `rtdb-rest.ts:46-52` | Use `Authorization: Bearer` headers. |
| 3 | **Identity & timestamps are client-asserted** (`process.env.USER`, client `Date.now()`). | `extension.ts:131`, `rtdb-rest.ts:81-88` | Server stamps `author`/`timestamp`/`updatedAt` from the authenticated session. Never trust the payload. |
| 4 | **"Append-only" history is convention only** — rules grant full write to `version_timeline`. | `firebase.rules.json:26-31` | Make the history table genuinely insert-only at the grant level. |
| 5 | **Validation is client-side only** — rules only check that membership *exists*, not payload shape. | `schema.ts` parse calls; rules | Reuse the `forward-core` Zod schemas **server-side** as the write-validation layer. |
| 6 | **Authorization is binary** — `owner` and `member` grant identical access; trust boundary is the whole DB. | `schema.ts:342-350` | Real roles + per-tenant isolation enforced in every query. |
| 7 | **Writes aren't atomic** — multi-step sequences can crash half-done. | `rtdb-rest.ts:58-90`, `483-494` | Wrap multi-step writes in DB transactions. |
| 8 | **Markdown rendered cross-tenant** → stored XSS risk once multi-tenant. | `description` fields rendered on canvas | Sanitize on render (DOMPurify) and/or on write. |

---

## 4. Recommended backend stack

**Stay in TypeScript end-to-end** so the server can import `forward-core`
(schemas + `paths`) unchanged. Rewriting the contract in Go/Python discards your
single source of truth.

| Layer | Recommendation | Why |
|-------|----------------|-----|
| **Runtime/framework** | **Fastify** (+ `fastify-type-provider-zod`) | Schema-first, fast, minimal; plugs existing Zod schemas straight into route validation. NestJS only if you want heavier structure for a growing team. |
| **Database** | **Postgres** (relational core + `JSONB` for the design tree) | Data is a JSON tree *plus* relational membership/billing. Postgres serves both: typed tables for `projects`/`members`/`version_entries`, JSONB for flexible element/infra shapes. One engine to operate. Mongo fits the documents but loses relational integrity needed for tenancy + billing. |
| **ORM / migrations** | **Drizzle** (+ Drizzle Kit) | TS-first, thin, stays close to hand-written types; no codegen runtime. Prisma is the heavier alternative. |
| **Realtime** | See §5 — the hard part | Rebuilds what Firebase gave for free. |
| **Auth** | **Clerk** or **WorkOS** (managed) | Don't roll password/MFA/reset. Clerk = best DX; WorkOS if selling to enterprises wanting SAML/SCIM early. |
| **Cache / pub-sub / rate-limit** | **Redis** (Upstash, ElastiCache, or Memorystore) | Backs realtime fan-out, rate limiting, idempotency keys. |
| **Hosting** | **Cloud Run** (GCP) or **Fargate** (AWS) | Containerized Node, scales to zero. |
| **Billing** | **Stripe** | For paid tiers. |
| **Jobs / queues** | **BullMQ** (on Redis) or **SQS** | Timeline digests, email, webhooks. |
| **Observability** | **Sentry** + **OpenTelemetry** | Errors + traces from day one in multi-tenant. |

### Cloud: AWS vs GCP

Pick by auth/realtime choice. Lean on Firebase/Identity Platform → **GCP**.
Otherwise it's a technical wash — slight lean **GCP + Cloud Run** for the simplest
Node deploy, or **AWS** if you already operate there. Postgres + a container run
anywhere; don't over-optimize this.

---

## 5. Realtime — the one piece Firebase was giving you free

The whole product is live two-way sync. Today `extension.ts:712-759` polls with
ETags and the canvas uses Firebase `onValue`. Centralizing on Postgres means
rebuilding this bus. Three tiers, increasing effort:

1. **Fastest — Supabase** (Postgres + Realtime + Auth in one). Closest match to
   "own everything, closed source, but don't rebuild the sync bus": Postgres *and*
   row-level realtime subscriptions out of the box; self-hostable later. **Evaluate
   this before building custom.**
2. **Managed add-on — Postgres + Ably or Pusher** for fan-out. You own the DB;
   they own socket scaling.
3. **Full custom — Postgres `LISTEN/NOTIFY` (or CDC) → Socket.IO + Redis adapter
   → clients.** Most control, most work; you own reconnection/backpressure/scaling.

**Recommendation:** Supabase for v1 (or Postgres + Ably if you want the DB
separate), keeping the `forward-core` client interface so you can swap later.

---

## 6. Data-model translation (Postgres)

The `paths` map cleanly to tables. The timeline becomes a true append-only event
table.

```
projects(id, owner_id, name, created_at)
project_members(project_id, user_id, role, added_at)        -- PK(project_id, user_id)
design_elements(project_id, id, data JSONB, updated_at)     -- DesignElement
version_entries(project_id, element_id, seq, data JSONB, author, ts)  -- INSERT-ONLY
infra_nodes  / infra_edges / infra_flows(project_id, id, data JSONB, …)
tasks(project_id, id, data JSONB, …)
```

- Enforce tenancy with `project_id` on every row **and** turn on Postgres
  **Row-Level Security** as defense-in-depth — so a query that forgets its
  `WHERE project_id` still can't leak across tenants.
- Validate JSONB payloads with the imported `forward-core` Zod schemas on write.

---

## 7. Security checklist for the cutover

- [ ] **Kill the admin token** (#1); issue short-lived per-user JWTs, verify every request.
- [ ] **Server stamps identity + time** (#3); never trust client `author`/`timestamp`/`updatedAt`.
- [ ] **Re-validate every write with `forward-core` Zod** (#5) before it touches the DB.
- [ ] **Auth via `Authorization` header, never query string** (#2).
- [ ] **Tenancy enforced server-side on every query** + Postgres RLS (#6).
- [ ] **Transactions** around multi-step writes (#7).
- [ ] **`version_entries` is INSERT-only** at the grant level (#4).
- [ ] **Sanitize stored Markdown on render** (DOMPurify) (#8).
- [ ] **Rate-limit + per-tenant quotas** (Redis) — new attack surface once you host.
- [ ] **Audit log** of writes (extend the existing timeline pattern).
- [ ] **Secrets in a cloud secret manager**, never in `settings.json` / committed `.env`.
- [ ] **VS Code extension auth:** use `vscode.authentication` / OAuth device flow; store the token in `context.secrets` (SecretStorage), not settings.
- [ ] **Keep the webview CSP** (`extension.ts:828-836`): `default-src 'none'` + nonce is correct — don't regress it.

---

## 8. Suggested sequencing

1. Stand up the backend API + managed auth; issue per-user tokens.
2. Translate the schema to Postgres + Drizzle (start here — everything builds on it).
3. Re-point `forward-core`'s REST client at your API (one module). Move ACL checks
   server-side. **Kill the extension's admin token.**
4. Add the realtime channel (Supabase/Ably/custom); drop client polling.
5. Add billing (Stripe).
6. *Then* decide whether to migrate off any managed pieces for more control.

### Biggest risks to watch

- **The realtime bus** — the hidden cost; it's what Firebase did for you.
- **Secrets in shipped clients** — the extension can't keep one.
- **Multi-tenant isolation** — now lives in *your* code, not Firebase rules. Test it hard.
</content>
