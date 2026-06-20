# forward-dashboard

The web account UI for the closed-source Forward SaaS: **signup / login / auth,
organizations, projects, member access, tasks and documentation.** It is a React
(Vite) SPA that talks only to the backend ([apps/server](../server)) — it never
touches the database directly.

## What it does

| Area | How |
|---|---|
| Signup / login / password reset / MFA / email verify | **Clerk** hosted components (`<SignIn/>`, `<SignUp/>`, `<UserProfile/>`) — no custom auth code |
| Organizations + invite/revoke **org** members by email | Clerk **Organizations** (`<OrganizationSwitcher/>`, `<OrganizationProfile/>`) — Clerk sends the invite emails |
| Create / list projects | `POST /projects`, `GET /projects` |
| Project **roster** access (grant / revoke) | `POST` / `DELETE /projects/:p/members` (owner-only, by Clerk user id) |
| Tasks | `GET/PUT/DELETE /projects/:p/tasks` |
| Documentation (documented endpoints) | `GET /projects/:p/elements` (elements with an `apiBinding`) |

All API calls go through `forward-core/api` (the shared client), sending a fresh
Clerk session token as `Authorization: Bearer` — the same contract the canvas,
extension and MCP use.

## Run it

```bash
# from the repo root
npm install
npm run build -w packages/shared        # the contract must build first
cp apps/dashboard/.env.example apps/dashboard/.env.local   # fill in the two values
npm run dev -w apps/dashboard            # http://localhost:5174
```

`.env.local` needs:

- `VITE_CLERK_PUBLISHABLE_KEY` — from the Clerk dashboard (browser-safe).
- `VITE_API_BASE_URL` — the running [apps/server](../server) (e.g. `http://localhost:8080`).

The backend's `CORS_ORIGINS` must include `http://localhost:5174`, and its
`CLERK_SECRET_KEY` must belong to the **same Clerk instance** as the publishable
key here, so the tokens this app mints verify there.

## Known gap — email invites to a *project*

`POST /projects/:p/members` grants access by Clerk **user id**, so the Members
tab adds/revokes by user id. End-to-end "invite teammate@acme.com to this
project" needs Clerk Organization invitations synced into the `ProjectMember`
table via a backend webhook (a follow-up). Until then: invite people to the
**organization** by email on the Account page, then grant them project access by
their user id on the project's Members tab.
