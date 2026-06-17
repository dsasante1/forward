import { describe, it, expect } from "vitest";
import type { DesignElement } from "schema-nexus-core";
import { rankElements } from "./match.js";

function el(part: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    type: "rectangle",
    name: "",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    parentId: null,
    updatedAt: "2026-06-07T00:00:00Z",
    ...part,
  };
}

describe("rankElements", () => {
  const elements = [
    el({ id: "el_login", name: "Login button", text: "Sign in" }),
    el({ id: "el_signup", name: "Sign up form" }),
    el({ id: "el_profile", name: "Profile card", text: "User profile" }),
    el({ id: "el_blank", name: "", type: "frame" }),
  ];

  it("ranks the element whose name matches the feature first", () => {
    const [top] = rankElements("the login feature", elements);
    expect(top?.id).toBe("el_login");
    expect(top?.score).toBeGreaterThan(0);
  });

  it("matches on the element's text content, not just its name", () => {
    const [top] = rankElements("user profile page", elements);
    expect(top?.id).toBe("el_profile");
  });

  it("returns every element, even non-matches, so callers can disambiguate", () => {
    const ranked = rankElements("login", elements);
    expect(ranked).toHaveLength(elements.length);
    expect(ranked.at(-1)?.score).toBe(0); // the blank frame matched nothing
  });

  it("gives partial credit for prefix overlap (auth ↔ authentication)", () => {
    const ranked = rankElements("authentication", [
      el({ id: "el_auth", name: "Auth screen" }),
      el({ id: "el_other", name: "Settings" }),
    ]);
    expect(ranked[0]?.id).toBe("el_auth");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("prefers an undocumented element over a documented one on an even match", () => {
    const ranked = rankElements("login", [
      el({
        id: "el_documented",
        name: "Login",
        apiBinding: { title: "Login", description: "", parameters: [] },
      }),
      el({ id: "el_fresh", name: "Login" }),
    ]);
    expect(ranked[0]?.id).toBe("el_fresh");
  });
});
