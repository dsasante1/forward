import type { ReactNode } from "react";
import { C } from "./theme.js";

interface AsyncLike<T> {
  loading: boolean;
  data?: T;
  error?: string;
  reload: () => void;
}

/** The Forward mark as a spinner: chevrons pulsing in sequence (see .spinner). */
export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        className="c1"
        d="M4.75 4.9a.75.75 0 0 1 1.2-.6l9 6.75a.75.75 0 0 1 0 1.2l-9 6.75a.75.75 0 0 1-1.2-.6V4.9z"
      />
      <path
        className="c2"
        d="M13.75 4.9a.75.75 0 0 1 1.2-.6l9 6.75a.75.75 0 0 1 0 1.2l-9 6.75a.75.75 0 0 1-1.2-.6V4.9z"
      />
    </svg>
  );
}

/** Loading / error block for a useAsync result; returns null once data exists. */
export function States<T>({
  state,
  loadingText = "Loading…",
}: {
  state: AsyncLike<T>;
  loadingText?: string;
}): ReactNode {
  if (state.loading && state.data === undefined)
    return (
      <div
        style={{
          color: C.dim,
          fontSize: 13,
          padding: "14px 0",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Spinner />
        {loadingText}
      </div>
    );
  if (state.error)
    return (
      <div className="error" style={{ fontSize: 13, padding: "14px 0" }}>
        {state.error}{" "}
        <button type="button" className="linkbtn" onClick={state.reload}>Try again</button>
      </div>
    );
  return null;
}
