---
name: release-extension
description: Cuts a release of the Forward VS Code extension (apps/extension) — version bump + tag push that triggers CI to build, test, package the .vsix, and publish to the VS Code Marketplace and Open VSX. Use when asked to "release the extension", "publish a new version", "cut a vsix", "bump the extension version", or "ship to the marketplace". Not for releasing the canvas or MCP server, which are not published this way.
metadata:
  version: 1.0.0
---

# Releasing the VS Code extension

Publishing is **automated by CI** — [.github/workflows/release.yml](../../../.github/workflows/release.yml)
fires on a pushed `v*` tag: it builds, tests, packages a `.vsix`, publishes to the VS Code
Marketplace **and** Open VSX, and attaches the `.vsix` to a GitHub Release. (A store is
skipped if its secret — `VSCE_PAT` / `OVSX_PAT` — is absent.) You do **not** publish by hand.

## Cut a release

```bash
npm version patch -w apps/extension     # patch | minor | major — bumps apps/extension/package.json + commits + tags
git push --follow-tags                  # pushes the commit AND the v* tag → triggers release.yml
```

Pick the bump per semver: `patch` for fixes, `minor` for new features, `major` for breaking
changes. Confirm with the user which one before tagging — a published version can't be
unpublished.

## Before tagging — sanity check locally

```bash
npm run build -w apps/extension
npm test -w apps/extension
npm run typecheck -w apps/extension      # checks both tsconfig.json and tsconfig.webview.json
npm run package -w apps/extension        # builds a .vsix locally WITHOUT publishing
```

## One-time prerequisites (maintainer, already done if releases exist)

- A `publisher` field set in [apps/extension/package.json](../../../apps/extension/package.json).
- A registered publisher on the VS Code Marketplace and Open VSX.
- Repo secrets `VSCE_PAT` and `OVSX_PAT`.

## Notes

- Pushing the tag is the point of no return for the publish step — make sure CI is green on
  the branch first.
- If only a local `.vsix` is wanted (no publish), stop after `npm run package` and don't
  push a tag.

## Troubleshooting

- **CI ran but nothing published to a store.** Cause: that store's secret is absent — the workflow skips a store when `VSCE_PAT` / `OVSX_PAT` isn't set. Solution: add the missing repo secret, then re-run by pushing a new patch tag.
- **`vsce package` fails on a missing `publisher`.** Cause: `publisher` not set in [apps/extension/package.json](../../../apps/extension/package.json). Solution: set it to your registered publisher id and commit before tagging.
- **The tag pushed but the workflow didn't fire.** Cause: tag didn't match `v*` or wasn't pushed. Solution: `git push --follow-tags` (not a plain `git push`), and confirm `npm version` created a `vX.Y.Z` tag.
