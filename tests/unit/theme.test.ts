import { describe, expect, it } from "vitest";

import { isTheme } from "@/lib/theme";

describe("theme preference", () => {
  it("accepts only supported themes", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});
