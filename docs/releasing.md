# Releasing

Forward ships these, each released by pushing a tag:

| What | Tag | Workflow | Goes to |
| --- | --- | --- | --- |
| `forward-mcp` (MCP server + `forward` CLI) | `mcp-v0.2.0` | `.github/workflows/release-mcp.yml` | npm, GitHub Release |
| Forward GitHub Action (root `action.yml`) | the same `mcp-v0.2.0` | none: the Action runs from the tagged commit | GitHub |
| VS Code extension | `v0.4.1` | `.github/workflows/release.yml` | VS Code Marketplace, Open VSX |
| docs-ci Action | `docs-ci-v2` (major) + `docs-ci-v2.x.y` | none: see [apps/docs-ci](../apps/docs-ci/README.md#releasing-maintainers) | GitHub |

`forward init` writes a workflow that pins the Action to `dsasante1/forward@mcp-v<version>`
and runs `forward-mcp@<version>` from npm, where `<version>` is the CLI that wrote it. So every
`forward-mcp` version on npm must also have its `mcp-v<version>` tag on GitHub, and release tags
are never moved or deleted once pushed.

Each artifact carries `LICENSE`, `NOTICE` and a generated `THIRD_PARTY_NOTICES.txt` listing the
bundled dependencies (`scripts/third-party-notices.mjs`, fed by the bundler's own module list).

## Cutting a forward-mcp release

```bash
# 1. Bump the version. One field, one file.
npm version 0.3.0 --workspace apps/mcp --no-git-tag-version

# 2. Land it through a pull request like any other change.

# 3. Tag the merged commit and push the tag.
git checkout master && git pull
git tag mcp-v0.3.0
git push origin mcp-v0.3.0
```

The tag must equal `mcp-v` plus the version in `apps/mcp/package.json`; the
workflow checks that before it runs anything else and refuses a mismatch. If
that happens, fix the version, delete the tag
(`git push --delete origin mcp-v0.3.0`, `git tag -d mcp-v0.3.0`) and tag again.

### What the tag sets in motion

```
verify ── publish to npm ── github release
```

**verify** repeats CI on Node 22: build, typecheck, the test suite, then
`npm run pack -w apps/mcp` (one self-contained bundle with the canvas UI and no
dependencies) and `npm run smoke:package -w apps/mcp`, which installs that
tarball into an empty project and drives `forward` and `forward-mcp` for real.

**publish to npm** publishes `forward-mcp@<version>` with provenance, using
trusted publishing: the workflow's own OIDC identity is the credential, so
there is no token to store, rotate or leak. There is deliberately no token path
in the workflow at all. If the version is already on npm (the manual first
publish, or a re-run), it skips the publish and carries on to the release.

**github release** runs last, and only if the publish succeeded: a Release
named after the tag, with generated notes and the npm tarball attached.

Versions on npm are immutable. If a later job fails after npm succeeded, re-run
the workflow; the publish step sees the version on npm and skips it.

Check a release from the outside:

```bash
npm view forward-mcp version
npx -y -p forward-mcp forward --version
```

## One-time setup

### npm: publish the first version by hand

A trusted publisher is configured on the package's settings page at
npmjs.com, so the package has to exist before the workflow can publish it. The
first release is therefore manual, from a machine logged in to npm with 2FA:

```bash
npm login                                  # as dsasante1
npm ci && npm run build
npm run pack -w apps/mcp
npm run smoke:package -w apps/mcp
npm publish ./apps/mcp/pkg --access public
```

Then, on npmjs.com: **forward-mcp → Settings → Trusted publisher → GitHub
Actions**, with organisation `dsasante1`, repository `forward`, workflow
`release-mcp.yml`, environment blank; allow `npm publish` only. Under
*Publishing access*, choose *Require two-factor authentication and disallow
bypass 2fa tokens*: the trusted publisher works regardless, and the setting
removes the only other way a publish could happen without a person present.
From the next tag on, the workflow publishes without a token and provenance is
attached automatically.

Finally, push the matching tag so the version has its GitHub Release and the
`mcp-v<version>` ref that `forward init` workflows pin the Action to. The
workflow verifies, sees the version already on npm, skips the publish and
creates the Release:

```bash
git tag mcp-v0.2.0 && git push origin mcp-v0.2.0
```

### VS Code Marketplace and Open VSX

Add the `VSCE_PAT` and `OVSX_PAT` repository secrets. Each store's publish step
is skipped while its secret is missing.

### Who can release

Anyone who can push a tag can publish. On a solo repository that is one person;
before adding collaborators, add a tag ruleset (**Settings → Rules → Rulesets →
New tag ruleset** on `v*`, `mcp-v*` and `docs-ci-v*`) restricting creation,
update and deletion to maintainers, so that write access to branches does not
silently include the ability to publish under the project's name, or to repoint
a tag that adopters' workflows run.

### Before making the repository public

One time, in this order:

1. **Merge** the open-source branch, so `master` carries the Apache-2.0 `LICENSE`
   (GitHub then detects the license).
2. **History.** Every past commit becomes public. It holds no credentials, but the
   retired hosted deployment's identifiers are in the old `infra/` files (GCP
   project, Supabase project ref, Firebase sites). Either confirm those projects
   and the Clerk application are deleted, or publish a fresh, squashed history
   instead.
3. **Claim the names** before announcing: publish `forward-mcp` (above), and
   confirm the `forward` Marketplace publisher in `apps/extension/package.json`
   is yours (`npx vsce ls-publishers`).
4. **Tag the Actions**: `mcp-v<version>` (above) and `docs-ci-v2` /
   `docs-ci-v2.0.0` from the merged commit.
5. **Settings**: add the tag ruleset above, turn on private vulnerability
   reporting (**Security → Private vulnerability reporting**, which `SECURITY.md`
   points to) and Discussions, and set the description and topics.
6. **Visibility**: **Settings → General → Change visibility → Public**.
