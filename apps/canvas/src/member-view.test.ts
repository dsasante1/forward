import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMemberView, type MemberViewState } from "./member-view.js";
import type { RosterMember } from "./source.js";

/** The handful of DOM calls the view makes; the suite has no DOM environment. */
class FakeEl {
  textContent = "";
  className = "";
  title = "";
  children: FakeEl[] = [];
  private listeners = new Map<string, () => void>();
  append(...kids: FakeEl[]) {
    this.children.push(...kids);
  }
  replaceChildren() {
    this.children = [];
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, fn);
  }
  click() {
    this.listeners.get("click")?.();
  }
  /** Every descendant carrying `cls`, in document order. */
  all(cls: string): FakeEl[] {
    return this.children.flatMap((c) => [...(c.className === cls ? [c] : []), ...c.all(cls)]);
  }
}

const member = (over: Partial<RosterMember> = {}): RosterMember => ({
  uid: "Ada",
  email: "ada@example.com",
  name: "Ada",
  bot: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function draw(state: Partial<MemberViewState>, cb = { onClose: vi.fn(), onReload: vi.fn() }) {
  const host = new FakeEl();
  renderMemberView(
    host as unknown as HTMLElement,
    { members: [], shallow: false, loading: false, ...state },
    cb,
  );
  return { host, cb };
}

describe("renderMemberView", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => new FakeEl() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists contributors by name and email", () => {
    const { host } = draw({ members: [member(), member({ uid: "Grace", name: "Grace", email: null })] });
    expect(host.all("mb-name").map((n) => n.textContent)).toEqual(["Ada", "Grace"]);
    expect(host.all("mb-sub").map((n) => n.textContent)).toEqual(["ada@example.com"]);
  });

  it("says when nobody has committed yet", () => {
    const { host } = draw({});
    expect(host.all("mb-empty").map((n) => n.textContent)).toEqual(["No contributors yet."]);
  });

  it("tags a bot", () => {
    const { host } = draw({ members: [member(), member({ uid: "ci[bot]", name: "ci[bot]", bot: true })] });
    expect(host.all("mb-badge").map((n) => n.textContent)).toEqual(["bot"]);
  });

  it("warns that a shallow clone's list may be incomplete", () => {
    expect(draw({ members: [member()], shallow: true }).host.all("mb-warn")).toHaveLength(1);
    expect(draw({ members: [member()] }).host.all("mb-warn")).toHaveLength(0);
  });

  it("offers a retry on error", () => {
    const { host, cb } = draw({ error: "boom" });
    host.all("mb-retry")[0]!.click();
    expect(cb.onReload).toHaveBeenCalledOnce();
  });
});
