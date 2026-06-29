import type { ReactNode } from "react";
import { C } from "./theme.js";

interface AsyncLike<T> {
  loading: boolean;
  data?: T;
  error?: string;
  reload: () => void;
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
    return <div style={{ color: C.dim, fontSize: 13, padding: "14px 0" }}>{loadingText}</div>;
  if (state.error)
    return (
      <div className="error" style={{ fontSize: 13, padding: "14px 0" }}>
        {state.error}{" "}
        <button className="linkbtn" onClick={state.reload}>Try again</button>
      </div>
    );
  return null;
}
