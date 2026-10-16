import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, endOfMonth, isISODate, todayInTimeZone } from "./dates";
import { occurrences } from "./schedule";

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-1-1")).toBe(false);
  });

  it("does day arithmetic across month and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(diffDays("2026-11-01", "2026-10-30")).toBe(-2);
  });

  it("clamps month arithmetic", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("computes today in a time zone", () => {
    const instant = new Date("2026-10-16T03:00:00Z");
    expect(todayInTimeZone("America/Chicago", instant)).toBe("2026-10-15");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-10-16");
  });
});

describe("occurrences", () => {
  it("expands monthly schedules keeping the anchor day", () => {
    expect(occurrences("2026-01-31", "monthly", "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("expands biweekly and semimonthly schedules", () => {
    expect(occurrences("2026-10-02", "biweekly", "2026-10-10", "2026-10-31")).toEqual(["2026-10-16", "2026-10-30"]);
    expect(occurrences("2026-10-01", "semimonthly", "2026-10-01", "2026-11-30")).toEqual([
      "2026-10-01",
      "2026-10-16",
      "2026-11-01",
      "2026-11-16",
    ]);
  });

  it("returns nothing for irregular schedules beyond the first date", () => {
    expect(occurrences("2026-10-05", "irregular", "2026-10-01", "2026-12-31")).toEqual(["2026-10-05"]);
  });
});
