import type { ReactNode } from "react";

/** The shape `useAsync` returns — accepted directly by the helpers below. */
interface AsyncLike<T> {
  loading: boolean;
  data?: T;
  error?: string;
  reload: () => void;
}

/**
 * A load error with a one-click retry. The dashboard's reads are all reloadable
 * (`useAsync` exposes `reload`), so a failed fetch should never dead-end on bare
 * red text — give the user a way back without a full page refresh.
 */
export function RetryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <p className="error">
      {message}{" "}
      <button type="button" className="link retry" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

/** A small inline spinner + label for first-load states. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="muted loading-row">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}

/**
 * Declarative loading / error / empty block for a `useAsync` result. Renders the
 * spinner only on the *first* load (keeps stale data visible on a background
 * refetch), a retryable error, or the empty message — and `null` once there's
 * data to show, leaving the caller to render the list itself.
 */
export function AsyncStates<T>({
  state,
  loadingText = "Loading…",
  isEmpty,
  empty,
}: {
  state: AsyncLike<T>;
  loadingText?: string;
  /** True when `data` should be treated as empty (defaults to never). */
  isEmpty?: (data: T) => boolean;
  /** What to show when `isEmpty` holds. */
  empty?: ReactNode;
}) {
  const { loading, data, error, reload } = state;
  if (loading && data === undefined) return <Loading>{loadingText}</Loading>;
  if (error) return <RetryError message={error} onRetry={reload} />;
  if (empty !== undefined && data !== undefined && isEmpty?.(data)) {
    return <>{empty}</>;
  }
  return null;
}
