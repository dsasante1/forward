import type { Roster } from "./source.js";

export interface RosterState {
  roster: Roster;
  loading: boolean;
  error?: string;
}

export interface RosterLoader {
  readonly state: RosterState;
  /**
   * Fetch the roster. `quiet` is a background refresh: no spinner, a notice only
   * when something changed, and a failure leaves the list up (like the poll
   * loops, which stay quiet on error).
   */
  load(quiet?: boolean): Promise<void>;
}

/** Holds the Contributors view's data; the view itself only draws `state`. */
export function createRosterLoader(list: () => Promise<Roster>, onChange: () => void): RosterLoader {
  const state: RosterState = { roster: { members: [], shallow: false }, loading: false };
  let latest = 0;
  let inFlight = 0;
  const shown = () => JSON.stringify([state.roster, state.error]);

  async function load(quiet = false): Promise<void> {
    if (quiet && inFlight) return;
    const run = ++latest;
    const before = shown();
    inFlight++;
    if (!quiet) {
      state.loading = true;
      state.error = undefined;
      onChange();
    }
    try {
      const roster = await list();
      if (run !== latest) return; // a newer load owns the view
      state.roster = roster;
      state.error = undefined;
    } catch (err) {
      if (run !== latest) return;
      if (!quiet) state.error = (err as Error).message;
    } finally {
      inFlight--;
      if (run === latest) {
        if (!quiet) state.loading = false;
        if (!quiet || shown() !== before) onChange();
      }
    }
  }

  return { state, load };
}
