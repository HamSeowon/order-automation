import { describe, expect, it } from "vitest";
import { clientIpFrom, lockedMessage, safeNextPath } from "./auth-utils";

describe("safeNextPath (열린 리다이렉트 방지)", () => {
  it.each([
    ["/orders", "/orders"],
    ["/orders?status=pending&q=%EA%B9%80", "/orders?status=pending&q=%EA%B9%80"],
    ["/exports/abc/download", "/exports/abc/download"],
    ["//evil.com", "/orders/new"],
    ["/\\evil.com", "/orders/new"],
    ["/evil.com", "/evil.com"], // 같은 사이트 안의 경로 (없는 페이지면 404일 뿐 외부로 나가지 않음)
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
  it("x-forwarded-for 의 첫 값", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });
  it("없으면 x-real-ip, 그것도 없으면 local", () => {
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIpFrom(h({}))).toBe("local");
  });
});

describe("lockedMessage", () => {
  it("남은 분을 올림, 최소 1분", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    expect(lockedMessage("2026-09-27T10:14:01Z", now)).toContain("15분 후");
    expect(lockedMessage("2026-09-27T10:00:10Z", now)).toContain("1분 후");
    expect(lockedMessage("2026-09-27T09:59:00Z", now)).toContain("1분 후");
  });
});
