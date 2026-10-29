/**
 * Keeps the canvas webview's subscribed channels fresh without a fast poll.
 * `schedule()` is called on every file event (and after every write); a burst of
 * them collapses into one refresh, a refresh asked for mid-refresh runs once
 * more when it ends, and nothing is read while the tab is hidden — the next
 * `resume()` catches up instead. Each refresh re-reads every subscribed channel
 * and posts only the ones whose snapshot changed, so an in-progress edit on the
 * canvas isn't clobbered by an identical snapshot.
 */
export interface RefresherOptions<C extends string> {
  read: (channel: C) => Promise<unknown>;
  post: (channel: C, data: unknown) => void;
  visible: () => boolean;
  debounceMs: number;
  onError?: (channel: C, err: unknown) => void;
}

export interface Refresher<C extends string> {
  /** Start a channel; its first snapshot is posted by the next refresh. */
  subscribe(channel: C): void;
  unsubscribe(channel: C): void;
  /** Ask for a refresh soon (or, while hidden, when the tab is next shown). */
  schedule(): void;
  /** The tab is visible again: refresh if anything was asked for meanwhile. */
  resume(): void;
  dispose(): void;
  /** Settles when the refresh in progress (if any) has finished. For tests. */
  idle(): Promise<void>;
}

export function createRefresher<C extends string>(opts: RefresherOptions<C>): Refresher<C> {
  /** Subscribed channels → the JSON last posted on each ("" until the first). */
  const channels = new Map<C, string>();
  let disposed = false;
  let stale = false;
  let again = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pass = async (): Promise<void> => {
    do {
      again = false;
      for (const channel of [...channels.keys()]) {
        try {
          const data = await opts.read(channel);
          if (disposed || !channels.has(channel)) continue;
          const json = JSON.stringify(data);
          if (json !== channels.get(channel)) {
            channels.set(channel, json);
            opts.post(channel, data);
          }
        } catch (err) {
          opts.onError?.(channel, err);
        }
      }
    } while (again && !disposed);
  };

  const refresh = (): void => {
    if (running) {
      again = true; // the running pass re-reads once it finishes
      return;
    }
    running = pass().finally(() => {
      running = undefined;
    });
  };

  const schedule = (): void => {
    if (disposed) return;
    if (!opts.visible()) {
      stale = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, opts.debounceMs);
  };

  return {
    subscribe(channel) {
      channels.set(channel, ""); // "" never matches a snapshot, so the first read posts
      schedule();
    },
    unsubscribe(channel) {
      channels.delete(channel);
    },
    schedule,
    resume() {
      if (disposed || !stale || !opts.visible()) return;
      stale = false;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      channels.clear();
    },
    async idle() {
      while (running) await running;
    },
  };
}
