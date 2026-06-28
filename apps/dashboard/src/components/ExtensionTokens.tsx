import { useState } from "react";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { AsyncStates } from "./AsyncStates.js";

/** Selectable lifetimes. Every token expires — there is no never-expires option. */
const DURATIONS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

/** Render a token's expiry as a short, human label. */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "no expiry";
  const when = new Date(expiresAt);
  if (when.getTime() <= Date.now()) return "expired";
  return `expires ${when.toLocaleDateString()}`;
}

/**
 * Personal Access Token management — the credential the VS Code extension (and
 * other headless surfaces) use in place of a browser Clerk session. A token is
 * minted server-side and its plaintext returned exactly once: we surface it for
 * copying, then it is unrecoverable (only its hash is stored). The caller picks a
 * lifetime (default 90 days), can rotate a token (revoke + reissue in one step),
 * or revoke it outright.
 */
export function ExtensionTokens() {
  const api = useApi();
  const tokens = useAsync(() => api.listApiTokens(), [api]);

  const [name, setName] = useState("");
  // Index into DURATIONS; defaults to the 90-day option.
  const [durationIdx, setDurationIdx] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The one-time plaintext, held only until the user dismisses it.
  const [fresh, setFresh] = useState<{ name: string; token: string }>();

  const expiresInDays = DURATIONS[durationIdx]?.days ?? 90;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createApiToken(name.trim(), expiresInDays);
      setFresh({ name: created.name, token: created.token });
      setName("");
      tokens.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(id: string, tokenName: string) {
    if (
      !window.confirm(
        `Rotate “${tokenName}”? The current token stops working immediately and a new one is issued.`,
      )
    )
      return;
    setError(undefined);
    try {
      const rotated = await api.rotateApiToken(id, expiresInDays);
      setFresh({ name: rotated.name, token: rotated.token });
      tokens.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(id: string) {
    setError(undefined);
    try {
      await api.revokeApiToken(id);
      tokens.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="tab-body">
      <p className="muted small">
        Generate a token to sign the Forward VS Code extension in: run{" "}
        <strong>Forward: Sign In</strong> in VS Code and paste it. The token grants
        exactly your own project access.
      </p>

      <form className="row" onSubmit={create}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Work laptop)"
          maxLength={100}
        />
        <select
          value={durationIdx}
          onChange={(e) => setDurationIdx(Number(e.target.value))}
          title="How long this token stays valid"
        >
          {DURATIONS.map((d, i) => (
            <option key={d.label} value={i}>
              {d.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Generating…" : "Generate token"}
        </button>
      </form>

      {fresh && (
        <div className="notice">
          <p className="muted small">
            Copy <strong>{fresh.name}</strong> now — it won't be shown again.
          </p>
          <div className="row">
            <input type="text" readOnly value={fresh.token} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(fresh.token)}
            >
              Copy
            </button>
            <button type="button" className="danger" onClick={() => setFresh(undefined)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <h3 className="section-label">Your tokens</h3>
      <AsyncStates
        state={tokens}
        loadingText="Loading tokens…"
        isEmpty={(t) => t.length === 0}
        empty={<p className="muted small">No tokens yet.</p>}
      />
      <ul className="list">
        {tokens.data?.map((t) => (
          <li key={t.id} className="list-row">
            <span className="list-title">{t.name}</span>
            <span className="badge">{t.prefix}…</span>
            <span className="muted small">{expiryLabel(t.expiresAt)}</span>
            <span className="muted small">
              {t.lastUsedAt
                ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                : "never used"}
            </span>
            <button type="button" onClick={() => rotate(t.id, t.name)}>
              Rotate
            </button>
            <button type="button" className="danger" onClick={() => revoke(t.id)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
