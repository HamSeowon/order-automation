import { describe, expect, it } from "vitest";
import {
  filtersToQuery, kstDate, kstRange, parseFilters, phoneSearchTerm, sanitizeSearch, searchOrCondition,
} from "./order-filters";

describe("parseFilters", () => {
  it("only accepts valid values, everything else falls back to the default", () => {
    expect(parseFilters({ from: "2026-09-01", to: "2026-02-30", room: " 대구방 ", q: ["김", "이"], page: "-3" })).toEqual({
      from: "2026-09-01",
      to: "", // a date that doesn't exist
      room: "대구방",
      q: "김",
      status: "",
      page: 1,
    });
    expect(parseFilters({ page: "3" }).page).toBe(3);
    expect(parseFilters({ status: "pending" }).status).toBe("pending");
    expect(parseFilters({ status: "drop table" }).status).toBe("");
    expect(parseFilters({ from: "2026/09/01" }).from).toBe("");
  });

  it("filtersToQuery omits empty values and page 1", () => {
    expect(filtersToQuery({ from: "2026-09-01", room: "대구 방", q: "", page: 1 })).toBe("?from=2026-09-01&room=%EB%8C%80%EA%B5%AC+%EB%B0%A9");
    expect(filtersToQuery({ page: 2 })).toBe("?page=2");
    expect(filtersToQuery({ status: "exported" })).toBe("?status=exported");
    expect(filtersToQuery({})).toBe("");
  });
});

describe("KST dates", () => {
  it("the range is based on KST midnight, to excludes the following day's midnight", () => {
    expect(kstRange("2026-09-01", "2026-09-30")).toEqual({
      gte: "2026-09-01T00:00:00+09:00",
      lt: "2026-10-01T00:00:00+09:00",
    });
    expect(kstRange("", "")).toEqual({});
  });

  it("the date rolls over at UTC 15:00 (= KST midnight the next day)", () => {
    expect(kstDate(new Date("2026-09-26T14:59:59Z"))).toBe("2026-09-26");
    expect(kstDate(new Date("2026-09-26T15:00:00Z"))).toBe("2026-09-27");
    expect(kstDate(new Date("2026-10-01T03:00:00Z"), 6)).toBe("2026-09-25");
  });
});

describe("search", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["010 1234 5678", "010-1234-5678"],
    ["12345678", "1234-5678"],
    ["5678", "5678"],
    ["1234-5678", "1234-5678"],
    ["홍길동", "홍길동"],
  ])("phone search term %s → %s", (input, expected) => {
    expect(phoneSearchTerm(input)).toBe(expected);
  });

  it("strips characters that would break PostgREST or() syntax", () => {
    expect(sanitizeSearch("a,b(c)%d*e_f\\g\"h'i")).toBe("a b c d e f g h i");
    expect(searchOrCondition(" ,() ")).toBeNull();
  });

  it("search term → name/phone/address/product or condition", () => {
    expect(searchOrCondition("01012345678")).toBe(
      "name.ilike.*01012345678*,phone.ilike.*010-1234-5678*,addr1.ilike.*01012345678*,addr2.ilike.*01012345678*," +
        "product_name.ilike.*01012345678*,brand_raw.ilike.*01012345678*,brand_short.ilike.*01012345678*",
    );
  });
});
