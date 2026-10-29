import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefresher } from "./refresher.js";

type Channel = "tasks" | "timeline";

function setup(data: Record<Channel, unknown>) {
  const reads: Channel[] = [];
  const posts: Array<[Channel, unknown]> = [];
  let visible = true;
  const r = createRefresher<Channel>({
    read: async (c) => {
      reads.push(c);
      return data[c];
    },
    post: (c, d) => posts.push([c, d]),
    visible: () => visible,
    debounceMs: 100,
  });
  // Fire the debounce, then let the refresh pass finish.
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(100);
    await r.idle();
  };
  return { r, reads, posts, flush, hide: () => (visible = false), show: () => (visible = true) };
}

describe("createRefresher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("posts a channel's first snapshot after it subscribes", async () => {
    const { r, posts, flush } = setup({ tasks: [1], timeline: [] });
    r.subscribe("tasks");
    await flush();
    expect(posts).toEqual([["tasks", [1]]]);
  });

  it("collapses a burst of file events into one read per channel", async () => {
    const { r, reads, flush } = setup({ tasks: [], timeline: [] });
    r.subscribe("tasks");
    r.subscribe("timeline");
    for (let i = 0; i < 20; i++) r.schedule();
    await flush();
    expect(reads).toEqual(["tasks", "timeline"]);
  });

  it("posts only the channels whose snapshot changed", async () => {
    const data: Record<Channel, unknown> = { tasks: [1], timeline: ["a"] };
    const { r, posts, flush } = setup(data);
    r.subscribe("tasks");
    r.subscribe("timeline");
    await flush();
    posts.length = 0;
    data.tasks = [1, 2];
    r.schedule();
    await flush();
    expect(posts).toEqual([["tasks", [1, 2]]]);
  });

  it("reads nothing while hidden and catches up when shown", async () => {
    const data: Record<Channel, unknown> = { tasks: [1], timeline: [] };
    const { r, reads, posts, flush, hide, show } = setup(data);
    r.subscribe("tasks");
    await flush();
    hide();
    data.tasks = [9];
    r.schedule();
    await flush();
    expect(reads).toEqual(["tasks"]);
    show();
    r.resume();
    await flush();
    expect(posts.at(-1)).toEqual(["tasks", [9]]);
  });

  it("re-reads once more when asked mid-refresh, so a change isn't missed", async () => {
    let release!: () => void;
    const data: Record<Channel, unknown> = { tasks: [1], timeline: [] };
    const posts: unknown[] = [];
    let n = 0;
    const r = createRefresher<Channel>({
      read: async () => {
        if (n++ === 0) await new Promise<void>((res) => (release = res));
        return data.tasks;
      },
      post: (_c, d) => posts.push(d),
      visible: () => true,
      debounceMs: 100,
    });
    r.subscribe("tasks");
    await vi.advanceTimersByTimeAsync(100); // the first read is now in flight
    data.tasks = [2];
    r.schedule();
    await vi.advanceTimersByTimeAsync(100); // asks for a refresh mid-read
    release();
    await r.idle();
    expect(posts).toEqual([[2]]);
    expect(n).toBe(2);
  });

  it("stops posting after dispose", async () => {
    const { r, posts, flush } = setup({ tasks: [1], timeline: [] });
    r.subscribe("tasks");
    r.dispose();
    r.schedule();
    await flush();
    expect(posts).toEqual([]);
  });
});
