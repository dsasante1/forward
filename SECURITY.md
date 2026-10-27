# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on
[dsasante1/forward](https://github.com/dsasante1/forward/security/advisories/new).
Don't open a public issue for a security problem.

Include the affected component, steps to reproduce and the impact you expect. You'll get an
acknowledgement within a few days and a fix or mitigation plan once the report is confirmed.

## Scope notes

- **`forward serve`** has no accounts. It binds to `127.0.0.1` by default, requires a random
  per-session token on every API call, and rejects unexpected `Host` headers to block DNS
  rebinding. `--host 0.0.0.0` exposes it to your network on purpose.
- **Project data** trusts whoever can push to the repository; access control is your git host's.
  Markdown in `.forward/` is rendered by the canvas and must stay escaped at render time.
