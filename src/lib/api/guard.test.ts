import { describe, expect, it } from "vitest";
import { checkSameOrigin, readJsonBody } from "./guard";

const req = (headers: Record<string, string>, body = "{}") => new Request("http://localhost/api/cfo/chat", { method: "POST", headers, body });

describe("API guards", () => {
  it("accepts only same-origin requests", () => {
    expect(checkSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(checkSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(checkSameOrigin(req({ host: "localhost:3000" }))).toBe(false);
    expect(checkSameOrigin(req({ origin: "null", host: "localhost:3000" }))).toBe(false);
  });

  it("requires JSON within the size limit", async () => {
    const wrongType = await readJsonBody(req({ "content-type": "text/plain" }), 100);
    expect((wrongType as Response).status).toBe(415);
    const tooBig = await readJsonBody(req({ "content-type": "application/json" }, JSON.stringify({ m: "x".repeat(500) })), 100);
    expect((tooBig as Response).status).toBe(413);
    const invalid = await readJsonBody(req({ "content-type": "application/json" }, "{oops"), 100);
    expect((invalid as Response).status).toBe(400);
    expect(await readJsonBody(req({ "content-type": "application/json; charset=utf-8" }, '{"a":1}'), 100)).toEqual({ a: 1 });
  });
});
