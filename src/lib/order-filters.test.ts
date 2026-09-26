import { describe, expect, it } from "vitest";
import {
  filtersToQuery, kstDate, kstRange, parseFilters, phoneSearchTerm, sanitizeSearch, searchOrCondition,
} from "./order-filters";

describe("parseFilters", () => {
  it("유효한 값만 받고 나머지는 기본값", () => {
    expect(parseFilters({ from: "2026-09-01", to: "2026-02-30", room: " 대구방 ", q: ["김", "이"], page: "-3" })).toEqual({
      from: "2026-09-01",
      to: "", // 존재하지 않는 날짜
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

  it("filtersToQuery 는 빈 값과 1페이지를 생략", () => {
    expect(filtersToQuery({ from: "2026-09-01", room: "대구 방", q: "", page: 1 })).toBe("?from=2026-09-01&room=%EB%8C%80%EA%B5%AC+%EB%B0%A9");
    expect(filtersToQuery({ page: 2 })).toBe("?page=2");
    expect(filtersToQuery({ status: "exported" })).toBe("?status=exported");
    expect(filtersToQuery({})).toBe("");
  });
});

describe("KST 날짜", () => {
  it("범위는 KST 자정 기준, to 는 다음 날 0시 미만", () => {
    expect(kstRange("2026-09-01", "2026-09-30")).toEqual({
      gte: "2026-09-01T00:00:00+09:00",
      lt: "2026-10-01T00:00:00+09:00",
    });
    expect(kstRange("", "")).toEqual({});
  });

  it("UTC 15시(=KST 다음 날 0시)부터 날짜가 바뀐다", () => {
    expect(kstDate(new Date("2026-09-26T14:59:59Z"))).toBe("2026-09-26");
    expect(kstDate(new Date("2026-09-26T15:00:00Z"))).toBe("2026-09-27");
    expect(kstDate(new Date("2026-10-01T03:00:00Z"), 6)).toBe("2026-09-25");
  });
});

describe("검색", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["010 1234 5678", "010-1234-5678"],
    ["12345678", "1234-5678"],
    ["5678", "5678"],
    ["1234-5678", "1234-5678"],
    ["홍길동", "홍길동"],
  ])("전화번호 검색어 %s → %s", (input, expected) => {
    expect(phoneSearchTerm(input)).toBe(expected);
  });

  it("PostgREST or() 문법을 깨는 문자를 제거", () => {
    expect(sanitizeSearch("a,b(c)%d*e_f\\g\"h'i")).toBe("a b c d e f g h i");
    expect(searchOrCondition(" ,() ")).toBeNull();
  });

  it("검색어 → 이름/전화/주소/상품 or 조건", () => {
    expect(searchOrCondition("01012345678")).toBe(
      "name.ilike.*01012345678*,phone.ilike.*010-1234-5678*,addr1.ilike.*01012345678*,addr2.ilike.*01012345678*," +
        "product_name.ilike.*01012345678*,brand_raw.ilike.*01012345678*,brand_short.ilike.*01012345678*",
    );
  });
});
