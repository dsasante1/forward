import { describe, expect, it, vi } from "vitest";
import { createRosterLoader } from "./roster-loader.js";
import type { Roster } from "./source.js";

const roster = (...uids: string[]): Roster => ({
  members: uids.map((uid) => ({ uid, email: null, name: uid, bot: false, addedAt: "2026-01-01T00:00:00.000Z" })),
  shallow: false,
});

/** A list() whose answers are settled by hand, oldest call first. */
function deferred() {
  const calls: Array<{ resolve: (r: Roster) => void; reject: (e: Error) => void }> = [];
  const list = () => new Promise<Roster>((resolve, reject) => calls.push({ resolve, reject }));
  return { calls, list };
}

describe("createRosterLoader", () => {
  it("shows loading, then the roster, on a normal load", async () => {
    const seen: boolean[] = [];
    const loader = createRosterLoader(async () => roster("Ada"), () => seen.push(loader.state.loading));
    await loader.load();
    expect(seen).toEqual([true, false]);
    expect(loader.state.roster.members.map((m) => m.uid)).toEqual(["Ada"]);
  });

  it("reports a failed load", async () => {
    const onChange = vi.fn();
    const loader = createRosterLoader(() => Promise.reject(new Error("boom")), onChange);
    await loader.load();
    expect(loader.state).toMatchObject({ loading: false, error: "boom" });
  });

  it("a quiet load picks up a new contributor without showing loading", async () => {
    let answer = roster("Ada");
    const seen: boolean[] = [];
    const loader = createRosterLoader(async () => answer, () => seen.push(loader.state.loading));
    await loader.load();
    seen.length = 0;
    answer = roster("Ada", "Grace");
    await loader.load(true);
    expect(seen).toEqual([false]);
    expect(loader.state.roster.members.map((m) => m.uid)).toEqual(["Ada", "Grace"]);
  });

  it("a quiet load with nothing new doesn't redraw", async () => {
    const onChange = vi.fn();
    const loader = createRosterLoader(async () => roster("Ada"), onChange);
    await loader.load();
    onChange.mockClear();
    await loader.load(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a failed quiet load keeps the list up with no error", async () => {
    let fail = false;
    const onChange = vi.fn();
    const loader = createRosterLoader(() => (fail ? Promise.reject(new Error("boom")) : Promise.resolve(roster("Ada"))), onChange);
    await loader.load();
    onChange.mockClear();
    fail = true;
    await loader.load(true);
    expect(loader.state.error).toBeUndefined();
    expect(loader.state.roster.members).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a successful quiet load clears an earlier error", async () => {
    let fail = true;
    const loader = createRosterLoader(() => (fail ? Promise.reject(new Error("boom")) : Promise.resolve(roster("Ada"))), () => {});
    await loader.load();
    fail = false;
    await loader.load(true);
    expect(loader.state.error).toBeUndefined();
  });

  it("skips a quiet load while another is running", async () => {
    const { calls, list } = deferred();
    const loader = createRosterLoader(list, () => {});
    const first = loader.load();
    await loader.load(true);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(roster("Ada"));
    await first;
  });

  it("ignores an older answer that arrives after a newer one", async () => {
    const { calls, list } = deferred();
    const loader = createRosterLoader(list, () => {});
    const older = loader.load();
    const newer = loader.load();
    calls[1]!.resolve(roster("New"));
    await newer;
    calls[0]!.resolve(roster("Old"));
    await older;
    expect(loader.state.roster.members.map((m) => m.uid)).toEqual(["New"]);
    expect(loader.state.loading).toBe(false);
  });
});
