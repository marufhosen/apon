import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/lib/dates";

describe("Dhaka date formatting", () => {
  const moment = new Date("2026-11-14T04:00:00.000Z");

  it("uses Asia/Dhaka time for English copy", () => {
    expect(formatDateTime(moment, "en")).toContain("10:00");
  });

  it("uses Asia/Dhaka time and Bengali numerals for Bangla copy", () => {
    expect(formatDateTime(moment, "bn")).toContain("১০:০০");
  });
});
