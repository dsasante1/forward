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

/** A small inline spinner + label for first-load states. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="muted loading-row">
      <Spinner />
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
