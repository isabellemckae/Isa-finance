import { describe, expect, it } from "vitest";
import { toPlaidError } from "./client";
import { PlaidError } from "./ports";

describe("toPlaidError", () => {
  it("keeps only Plaid's documented code, type and status", () => {
    const axiosLike = {
      isAxiosError: true,
      message: "Request failed",
      config: { data: '{"access_token":"access-sandbox-secret"}' },
      response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "the login details changed" } },
    };
    const e = toPlaidError(axiosLike);
    expect(e).toBeInstanceOf(PlaidError);
    expect(e).toMatchObject({ code: "ITEM_LOGIN_REQUIRED", type: "ITEM_ERROR", status: 400 });
    expect(JSON.stringify(e) + e.message + String(e.stack)).not.toContain("access-sandbox-secret");
    expect(e.message).not.toContain("login details");
  });

  it("classifies network failures and unknown errors", () => {
    expect(toPlaidError({ isAxiosError: true, code: "ECONNABORTED" }).code).toBe("TIMEOUT");
    expect(toPlaidError({ isAxiosError: true, code: "ECONNREFUSED" }).code).toBe("NETWORK_ERROR");
    expect(toPlaidError(new Error("x")).code).toBe("UNKNOWN_ERROR");
  });
});
