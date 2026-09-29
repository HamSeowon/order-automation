import { describe, expect, it } from "vitest";
import { hashPassword, isValidPin, verifyPassword } from "./password";

describe("password", () => {
  it("hash → only the matching password passes", async () => {
    const stored = await hashPassword("123456");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(stored).not.toContain("123456");
    expect(await verifyPassword("123456", stored)).toBe(true);
    expect(await verifyPassword("123457", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("the same password hashes differently every time (salt)", async () => {
    expect(await hashPassword("123456")).not.toBe(await hashPassword("123456"));
  });

  it("a malformed hash returns false", async () => {
    for (const bad of ["", "123456", "scrypt$x$8$1$aa$bb", "bcrypt$16384$8$1$aa$bb", "scrypt$16384$8$1$$"]) {
      expect(await verifyPassword("123456", bad)).toBe(false);
    }
  });

  it.each([
    ["123456", true],
    ["000000", true],
    ["12345", false],
    ["1234567", false],
    ["12345a", false],
    [" 123456", false],
    ["１２３４５６", false], // full-width digits
  ])("6-digit rule %j → %s", (pin, ok) => {
    expect(isValidPin(pin)).toBe(ok);
  });
});
