import { describe, expect, it } from "vitest";
import { clientIpFrom, lockedMessage, safeNextPath } from "./auth-utils";

describe("safeNextPath (open-redirect prevention)", () => {
  it.each([
    ["/orders", "/orders"],
    ["/orders?status=pending&q=%EA%B9%80", "/orders?status=pending&q=%EA%B9%80"],
    ["/exports/abc/download", "/exports/abc/download"],
    ["//evil.com", "/orders/new"],
    ["/\\evil.com", "/orders/new"],
    ["/evil.com", "/evil.com"], // a same-site path (if the page doesn't exist it's just a 404, never an external redirect)
    ["https://evil.com", "/orders/new"],
    ["evil.com", "/orders/new"],
    ["/login", "/orders/new"],
    ["/login?next=/orders", "/orders/new"],
    ["/a\nb", "/orders/new"],
    ["", "/orders/new"],
    [null, "/orders/new"],
  ])("%j → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("clientIpFrom", () => {
  const h = (map: Record<string, string>) => (name: string) => map[name] ?? null;
  it("the first value of x-forwarded-for", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });
  it("falls back to x-real-ip, then to local", () => {
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIpFrom(h({}))).toBe("local");
  });
});

describe("lockedMessage", () => {
  it("rounds the remaining minutes up, minimum 1", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    expect(lockedMessage("2026-09-27T10:14:01Z", now)).toContain("15분 후");
    expect(lockedMessage("2026-09-27T10:00:10Z", now)).toContain("1분 후");
    expect(lockedMessage("2026-09-27T09:59:00Z", now)).toContain("1분 후");
  });
});
