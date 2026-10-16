import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkbox, formObject, idField, money, optionalId, optionalIsoDate, optionalMoney, optionalText, parseMoneyInput, text } from "./forms";

describe("money input", () => {
  it.each([
    ["1,234.50", 123_450],
    ["$ 99", 9_900],
    ["0.07", 7],
    ["-25.10", -2_510],
  ])("parses %j", (raw, expected) => {
    expect(parseMoneyInput(raw)).toBe(expected);
  });

  it("rejects extra precision and junk instead of rounding", () => {
    expect(() => parseMoneyInput("10.005")).toThrow();
    expect(() => parseMoneyInput("ten")).toThrow();
    expect(() => parseMoneyInput("")).toThrow();
  });

  it("enforces sign, zero and size rules", () => {
    expect(money().safeParse("-5").success).toBe(false);
    expect(money().safeParse("0").success).toBe(false);
    expect(money({ allowZero: true }).parse("0")).toBe(0);
    expect(money({ allowNegative: true }).parse("-5")).toBe(-500);
    expect(money().safeParse("2000000000").success).toBe(false);
    expect(optionalMoney().parse("")).toBeNull();
    expect(optionalMoney().parse("12")).toBe(1_200);
  });
});

describe("text and ids", () => {
  it("trims, requires and bounds text", () => {
    expect(text(10).parse("  hi  ")).toBe("hi");
    expect(text(3).safeParse("long").success).toBe(false);
    expect(text(10).safeParse("   ").success).toBe(false);
    expect(text(10).safeParse("a\u0000b").success).toBe(false);
    expect(optionalText(10).parse("   ")).toBeNull();
  });

  it("only accepts plain ids (no filter or path injection)", () => {
    expect(idField.safeParse("demo-acct-1").success).toBe(true);
    expect(idField.safeParse("3f1c0a7e-1b2c-4d5e-8f90-123456789abc").success).toBe(true);
    for (const bad of ["a,b", "../x", "id.eq.1", "x y", ""]) expect(idField.safeParse(bad).success).toBe(false);
  });

  it("treats fields missing from the form like empty ones", () => {
    const schema = z.object({ id: optionalId, limit: optionalMoney(), note: optionalText(10), due: optionalIsoDate });
    expect(schema.parse({})).toEqual({ id: null, limit: null, note: null, due: null });
    expect(schema.parse({ id: "", limit: "", note: "", due: "" })).toEqual({ id: null, limit: null, note: null, due: null });
  });

  it("reads checkboxes from FormData", () => {
    const fd = new FormData();
    fd.set("name", "x");
    fd.set("autopay", "on");
    const obj = formObject(fd, ["autopay", "estimate"]);
    const schema = z.object({ name: z.string(), autopay: checkbox, estimate: checkbox });
    expect(schema.parse(obj)).toEqual({ name: "x", autopay: true, estimate: false });
  });
});
