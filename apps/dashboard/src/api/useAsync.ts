import { useCallback, useEffect, useState } from "react";

interface AsyncState<T> {
  loading: boolean;
  data?: T;
  error?: string;
}

/**
 * Minimal data-fetching hook: runs `fn` on mount and whenever `deps` change, and
 * exposes a `reload()` so mutations can refresh the view. Kept tiny on purpose —
 * the dashboard's read patterns don't warrant a query library yet.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList,
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const reload = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run()
      .then((data) => !cancelled && setState({ loading: false, data }))
      .catch(
        (e) =>
          !cancelled &&
          setState({ loading: false, error: e?.message ?? String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(reload, [reload]);

  return { ...state, reload };
}
