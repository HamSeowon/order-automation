import { describe, expect, it } from "vitest";
import { addressNeedsCheck, findPhones, nameNeedsCheck, normalizePhone, phoneWarning, segmentOrders, splitAddress } from "./parser";
import { suggestProductFields } from "./product";

// Fictionalized raw order text in the format of the spec appendix's real-world example
const SPEC_EXAMPLE = `➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트

컬러/사이즈/수량 ;

블랙  1개

➡️ 성함 ; 최유리

➡️ 전번 ; 010 4521. 6390

➡️ 주소 ; 서울시 송파구

백제고분로 212 한빛상가 지하1층 8-3

티, 블루

부산 연제구 반송로 88 미래맨션 A동 210호

오하늘 01056372041

리더,Pxg  화이트 30 사이즈

정민준

01067482059

서울 강서구 화곡로 55

행복엠밸리3단지

512-903호`;

describe("segmentOrders", () => {
  it("splits the spec-appendix example into the expected result", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map(({ name, phone, addr1, addr2 }) => ({ name, phone, addr1, addr2 }))).toEqual([
      { name: "최유리", phone: "010-4521-6390", addr1: "서울시 송파구 백제고분로 212", addr2: "한빛상가 지하1층 8-3" },
      { name: "오하늘", phone: "010-5637-2041", addr1: "부산 연제구 반송로 88", addr2: "미래맨션 A동 210호" },
      { name: "정민준", phone: "010-6748-2059", addr1: "서울 강서구 화곡로 55", addr2: "행복엠밸리3단지 512-903호" },
    ]);
  });

  it("attaches product lines to each order", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map((o) => o.productText)).toEqual([
      "어메이징 알렉스 볼마커 벨트 / 블랙  1개",
      "티, 블루",
      "리더,Pxg  화이트 30 사이즈",
    ]);
  });

  it("empty input yields an empty array", () => {
    expect(segmentOrders("  \n\n ")).toEqual([]);
  });

  it("handles an address label whose value is on the next line, and a note label", () => {
    const [o] = segmentOrders(`➡️ 성함 ; 김철수
➡️ 전번 ; 010-1111-2222
➡️ 주소 ;
경기 성남시 분당구 판교역로 235 에이치스퀘어 N동 7층
➡️ 참고 ; 부재시 경비실`);
    expect(o).toMatchObject({
      name: "김철수",
      phone: "010-1111-2222",
      addr1: "경기 성남시 분당구 판교역로 235",
      addr2: "에이치스퀘어 N동 7층",
      note: "부재시 경비실",
    });
  });
});

describe("splitAddress", () => {
  it("includes a 번길-style address in addr1", () => {
    expect(splitAddress("경기 수원시 팔달구 중앙로123번길 45 2층")).toEqual({
      addr1: "경기 수원시 팔달구 중앙로123번길 45",
      addr2: "2층",
    });
  });
  it("goes entirely into addr1 when there's no road name", () => {
    expect(splitAddress("서울 강남구 역삼동 123-4")).toEqual({ addr1: "서울 강남구 역삼동 123-4", addr2: "" });
  });
});

describe("normalizePhone", () => {
  it.each([
    ["010 4521. 6390", "010-4521-6390"],
    ["01056372041", "010-5637-2041"],
    ["011-123-4567", "011-123-4567"],
    ["없음", "없음"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("suggestProductFields", () => {
  const dict = [
    { full_name: "어메이징", short_form: "AMZ" },
    { full_name: "AMAZING", short_form: "AMZ" },
    { full_name: "PXG", short_form: "PXG" },
  ];

  it("separates the dictionary brand, color, and quantity", () => {
    expect(suggestProductFields("어메이징 알렉스 볼마커 벨트 / 블랙  1개", dict)).toEqual({
      brand_raw: "어메이징",
      brand_short: "AMZ",
      brandMatched: true,
      product_name: "알렉스 볼마커 벨트",
      color: "블랙",
      size: "",
      quantityNote: "",
    });
  });

  it("case-insensitive brand + numeric size", () => {
    expect(suggestProductFields("리더,Pxg  화이트 30 사이즈", dict)).toMatchObject({
      brand_raw: "Pxg",
      brand_short: "PXG",
      product_name: "리더",
      color: "화이트",
      size: "30",
    });
  });

  it("leaves the brand empty and flags it unmatched when there's no match", () => {
    expect(suggestProductFields("티, 블루 2개", dict)).toMatchObject({
      brand_raw: "",
      brandMatched: false,
      product_name: "티",
      color: "블루",
      quantityNote: "수량 2개",
    });
  });
});

// Real-shape examples from the combined order chat (names/phones/addresses are fake). The last line of an order is the source tag.
describe("source tag on the last line → vendor", () => {
  const one = (text: string) => {
    const orders = segmentOrders(text);
    expect(orders).toHaveLength(1);
    return orders[0];
  };

  it("multi-character known tag is the vendor, not the name (contact before the products)", () => {
    const o = one(`한민서
경북 경주시 대안길 37 동천참마을 533호
010-9448-3499


보내는사람 이가은


✅️사우스 라운드넥 니트가디건
     스카이 77사이즈
✅️지포어 레이어드 랩스커트 블랙 77


수정`);
    expect(o).toMatchObject({ name: "한민서", phone: "010-9448-3499", vendor: "수정", newTag: false });
    expect(o.productText).toContain("지포어 레이어드 랩스커트");
  });

  it("tag on the line right after a one-line order", () => {
    const o = one(`지포* [ G / F ] 매장판제품 HYBRID HOOD (WOMEN)   사이즈 : 66

박서준   010-8943-5677   인천 남동구 서창남순환로 7 (서창동, 이편한세상서창) 1823-2026


골마`);
    // (name/address on the same line as the phone are handled in a later step — here only the tag matters)
    expect(o.vendor).toBe("골마");
    expect(o.name).not.toBe("골마");
  });

  it("free-text lines between the contact and the tag become the note", () => {
    const o = one(`지포어바이저

경남 창원시 마산회원구 내서읍 호원로211-4 코오롱 9차547동105호
정서준 01055183049

새우버거

마`);
    expect(o).toMatchObject({ name: "정서준", vendor: "마", note: "새우버거", productText: "지포어바이저" });
  });

  it("product lines after the contact (before the tag) stay with the order", () => {
    const o = one(`권하은
01058987894


인천남구노적산로16 두산위브아파트226동986호


PO53690
<남은수량 빅 세일>
지포어 [ G / F ] 매장판 PLEATED SKIRT (WOMEN)


아이보리 55 2장

장`);
    expect(o).toMatchObject({ name: "권하은", vendor: "장", note: "" });
    expect(o.productText).toContain("아이보리 55 2장");
  });

  it("a line after the tag is a note of the same order", () => {
    const o = one(`사우스케이프  [SC]
벨트백 플리츠 스커트
라이트그레이 77 사이즈

최지우
010 5715 8415
세종시 연서면 연서로75-59

티

최지우 다시 주문`);
    expect(o).toMatchObject({ vendor: "티", note: "최지우 다시 주문" });
  });

  it("an address with no road number doesn't swallow the tag", () => {
    const o = one(`인천 송도 마리나베이 410동 9751호
서하은 010 6356 2120

리더`);
    expect(o).toMatchObject({ name: "서하은", addr1: "인천 송도 마리나베이", addr2: "410동 9751호", vendor: "리더" });
  });

  it.each([
    ["k", "K"],
    ["폐리", "페리"],
  ])("typo %s → %s", (typo, tag) => {
    expect(one(`블랙 66\n\n김민서 01021948913\n서울 강서구 화곡로 55\n\n${typo}`).vendor).toBe(tag);
  });

  it("an unknown short last line after name+phone+address is a tag candidate (flagged)", () => {
    expect(one(`그레이 100\n\n정예린\n010-3963-0701\n\n경기도 구리시 인창동43 인창해모로 614동9067호\n\n당`)).toMatchObject({
      name: "정예린", vendor: "당", newTag: true,
    });
  });

  it("not a tag: a size on the last line, a longer remark, or a quantity", () => {
    expect(one(`대구 중구 대신동 동산상가\n4층9열5호\n박하은010 2394 1426\n\n100`)).toMatchObject({ vendor: "", productText: "100" });
    expect(one(`네이비100\n\n조지우010-1595-4395\n경기도 안양시 동안구 흥안대로560번길 84\n\n장터 누락!!!`)).toMatchObject({
      vendor: "", note: "장터 누락!!!",
    });
    expect(one(`동네언니\n01088909237\n\n전남 순천시해룡면 매안5길74-4\n\n마스터바니[MASTER BUNNY] 방울 모자\n\n1개`).vendor).toBe("");
  });

  it("several tagged orders in one paste: the tag closes each order", () => {
    const orders = segmentOrders(`1828

말본 [ MALBON ]
여성 립밴드 세미 와이드 팬츠
브라운55

김민서
010-2194-8913
인천 미추홀구 낙섬동로7(금호타운)24동3175호

오늘 꼭 보내주세요

디

그레이 66

박하은 010 2394 1426
대구 수성구 청수로469  9394동549호

장`);
    expect(orders.map(({ name, vendor, note }) => ({ name, vendor, note }))).toEqual([
      { name: "김민서", vendor: "디", note: "오늘 꼭 보내주세요" },
      { name: "박하은", vendor: "장", note: "" },
    ]);
    expect(orders[1].productText).toBe("그레이 66");
  });
});

// Phone formats seen in the combined order chat (digits are fake)
describe("phone numbers", () => {
  it.each([
    ["010 2194 8913", "010-2194-8913"],
    ["010-2194-8913", "010-2194-8913"],
    ["01021948913", "010-2194-8913"],
    ["010.2194.8913", "010-2194-8913"],
    ["010  2194  8913", "010-2194-8913"],
    ["010. 2194. 8913", "010-2194-8913"],
    ["010- 2194 8913", "010-2194-8913"],
    ["010 -2194-8913.", "010-2194-8913"],
    ["010.2194-8913", "010-2194-8913"],
    ["010 21948913", "010-2194-8913"],
    ["010~2194~8913", "010-2194-8913"],
    ["010ㆍ2194ㆍ8913", "010-2194-8913"],
    ["+821021948913", "010-2194-8913"],
    ["+82 10-2194-8913", "010-2194-8913"],
    ["011-123-4567", "011-123-4567"],
    ["070-4123-5678", "070-4123-5678"],
    ["02-123-4567", "02-123-4567"],
    ["02 1234 5678", "02-1234-5678"],
    ["031.123.4567", "031-123-4567"],
    ["0505-123-4567", "0505-123-4567"],
    ["0507 1234 5678", "0507-1234-5678"],
  ])("normalizePhone(%s) → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(findPhones(`이름 ${input} 끝`)).toHaveLength(1);
  });

  it("a Logen waybill number (452-XXXX-XXXX) or a longer digit run is not a phone number", () => {
    expect(findPhones("오세린 (띠)   452-1234-5678")).toEqual([]);
    expect(findPhones("주문번호 2010123456789")).toEqual([]);
    expect(segmentOrders("오세린 (띠)   452-1234-5678")[0].phone).toBe("");
  });

  it("name glued to the number, or an opening parenthesis in between", () => {
    expect(segmentOrders("김하은010 9500 9364\n평택시 고덕국제2로 704")[0]).toMatchObject({ name: "김하은", phone: "010-9500-9364" });
    expect(segmentOrders("경기 광주시 송정동 광주대로399\n720/7896\n강민서 (01021431123\n\n디")[0]).toMatchObject({
      name: "강민서", phone: "010-2143-1123", vendor: "디",
    });
  });

  it("two numbers: the first is the phone, the others go to the note", () => {
    expect(segmentOrders("김민서 010-2194-8913 / 070-4123-5678\n서울 강서구 화곡로 55")[0]).toMatchObject({
      phone: "010-2194-8913", note: "다른 번호 070-4123-5678",
    });
    expect(segmentOrders("김민서\n010-2194-8913\n010 5715 8415\n서울 강서구 화곡로 55\n\n디")[0]).toMatchObject({
      name: "김민서", phone: "010-2194-8913", note: "다른 번호 010-5715-8415", vendor: "디",
    });
  });

  it.each([
    ["010-2194-8913", null],
    ["02-123-4567", null],
    ["0505-123-4567", null],
    ["", null],
    ["010-219-8913", "010 번호는 11자리여야 합니다 (지금 10자리)"],
    ["031-123-456", "전화번호 자릿수를 확인하세요 (지금 9자리)"],
    ["없음", "전화번호에 숫자가 없습니다"],
  ])("phoneWarning(%j) → %j", (phone, expected) => {
    expect(phoneWarning(phone)).toBe(expected);
  });
});

// Name formats seen in the combined order chat (names/phones/addresses are fake)
describe("names and labels", () => {
  const one = (text: string) => {
    const orders = segmentOrders(text);
    expect(orders).toHaveLength(1);
    return orders[0];
  };

  it("■ label format, with the phone inside the 주문자 value", () => {
    expect(one(`■ 발주
■ 주문자 :윤서준 /010 5715 8415
■ 상품명 :타이틀리스트 로고 장식 소가죽 자동벨트
■ 수량 : 1
■ 배송지 : 울산 남구 두왕로187번길 22 한솔그린빌 A동 제 5층 제 552호

티`)).toMatchObject({ name: "윤서준", phone: "010-5715-8415", addr1: "울산 남구 두왕로187번길 22", vendor: "티" });
  });

  it("받는이 / 보내는이 blocks: the sender is not the recipient", () => {
    const o = one(`블랙 30 1개

받는이
서서준   010-7028-7336
충남 아산시 한마음로655-24 모종블랑루체 6702동 5236호

보내는이
마루샵 (조민호)

마`);
    expect(o).toMatchObject({ name: "서서준", phone: "010-7028-7336", vendor: "마", note: "" });
    expect(o.raw).toContain("마루샵 (조민호)");
  });

  it("보내는사람 on one line between the contact and the products is ignored", () => {
    const o = one(`한민서
경북 경주시 대안길 37 동천참마을 533호
010-9448-3499

보내는사람 이가은

✅️사우스 라운드넥 니트가디건
     스카이 77사이즈

수정`);
    expect(o).toMatchObject({ name: "한민서", vendor: "수정" });
    expect(o.productText).not.toContain("이가은");
  });

  it("✔받는사람 / *이름: labels with symbols and a trailing period", () => {
    expect(one(`✔️상품명:타이틀리스트  로고 정식 소가죽  자동벨트
*색상:블랙색상.

✔받는사람
*이름:조민서.
*연락처:010 -5647-0837.
*주소:
 경기도 남양주시 다산순환로 461 자이폴라리스아파트 4707동7678호

동`)).toMatchObject({ name: "조민서", phone: "010-5647-0837", addr1: "경기도 남양주시 다산순환로 461", vendor: "동" });
  });

  it("받으시는분 / 받을사람: markers before the name", () => {
    expect(one(`베이지 66

받으시는분
윤하은
010 9896 0030
서울 종로구 자하문로 290-37  유원빌라 4동 856호

디`)).toMatchObject({ name: "윤하은", vendor: "디" });
    expect(one(`사이즈/66

받을사람:
경기도 의왕시 오전동 해모로아파트
600동1496호
신지우
01043539251

디`)).toMatchObject({ name: "신지우", phone: "010-4353-9251", vendor: "디" });
  });

  it.each([
    ["젤리(보미)", "젤리", "(보미)"],
    ["신하은ON", "신하은", "ON"],
    ["이지우FS", "이지우", "FS"],
    ["강민서 (", "강민서", ""],
    ["하늘분식 조서준", "조서준", "하늘분식"],
    ["김 수희", "김수희", ""],
  ])("name line %s → name %s, note %j", (line, name, note) => {
    expect(one(`그레이 66\n\n${line}\n010-2194-8913\n서울 강서구 화곡로 55\n\n디`)).toMatchObject({ name, note, vendor: "디" });
  });

  it("color words and 주소변경 are not names", () => {
    expect(one(`크림\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디`).name).toBe("김민서");
    expect(one(`라이트그레이 66 1개\n\n받는이\n주소변경\n경북 구미시 봉곡동105-2 블루마린\n오서준 01021916434\n\n마`)).toMatchObject({
      name: "오서준", vendor: "마",
    });
  });

  it.each([
    ["김민서", false],
    ["남궁민수", false],
    ["남훈", false],
    ["", false],
    ["카페모아", true],
    ["헤어하나", true],
    ["하루클로젯", true],
    ["동네언니", true],
    ["젤리", true],
  ])("nameNeedsCheck(%j) → %s", (name, expected) => {
    expect(nameNeedsCheck(name)).toBe(expected);
  });
});

// Name, phone and address on one line, in either order (real shapes, fake values)
describe("name on the same line as the address", () => {
  it.each([
    [
      "사우스케이프  [SC] 벨트백 플리츠 스커트**\n\n세피아77\n\n\n광주 서구 풍암신흥로 50 광명메이루즈 614동 4455호 최민서. 01062489842\n\n장",
      { name: "최민서", phone: "010-6248-9842", addr1: "광주 서구 풍암신흥로 50", addr2: "광명메이루즈 614동 4455호", vendor: "장" },
    ],
    [
      "<남은수량 빅 세일> 지포* [ G / F ] 매장판 PLEATED SKIRT (WOMEN)   사이즈 : 66\n\n오지우   010-9250-6977   인천 연수구 랜드마크로 459 (송도동, 더샵 송도 마리나베이) 480동 463호\n\n골마",
      { name: "오지우", phone: "010-9250-6977", addr1: "인천 연수구 랜드마크로 459", vendor: "골마" },
    ],
    [
      "전북 전주시 완산구 효자동4가 농소8길7 푸른대문집 장하은 010 7086 5439\n\n\n사우스버킷 네이비\n\n라라",
      { name: "장하은", addr1: "전북 전주시 완산구 효자동4가 농소8길7", addr2: "푸른대문집", vendor: "라라" },
    ],
    [
      "광주광역시 북구 연제동7-9번지 헤어하나(별이네)010.7815-8473\n\n장",
      { name: "헤어하나", note: "(별이네)", phone: "010-7815-8473", vendor: "장" },
    ],
    [
      "1435. 55사이즈\n\n전북완주군 봉동읍 둔산9로399 렉시안906동 1305호 김서준\n010 3414 1427\n\n디",
      { name: "김서준", addr1: "전북완주군 봉동읍 둔산9로399", addr2: "렉시안906동 1305호", vendor: "디" },
    ],
  ])("%#", (text, expected) => {
    const orders = segmentOrders(text);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject(expected);
  });

  it("a name right after a product line, followed by the phone", () => {
    const [o] = segmentOrders("지포어 [ G / F ] 매장판\nSCOTCH MG4X2(WOMEN)\n235\n강예린\n010-1557-8130\n경기도 이천시 이여로 226번길 226-9\n\n디");
    expect(o).toMatchObject({ name: "강예린", phone: "010-1557-8130", vendor: "디" });
    expect(o.productText).toContain("235");
  });

  it("a 2-character word ending an address line is not taken as a name", () => {
    const [o] = segmentOrders("박지우\n\n010 6427 9189\n\n충남 아산시 선장면 삼봉로 38-5 사계\n\n장");
    expect(o).toMatchObject({ name: "박지우", addr2: "사계" });
  });
});

describe("name label holding something else", () => {
  it("성함: with the address (and the name at the end) → address + name", () => {
    expect(segmentOrders("성함: 전남무안군삼향읍남악3로 27번길9 805호 김민서\n010-2194-8913\n\n디")[0]).toMatchObject({
      name: "김민서", phone: "010-2194-8913", addr1: "전남무안군삼향읍남악3로 27번길9", vendor: "디",
    });
  });

  it("받는분주소 / 핸폰 are labels, not names", () => {
    expect(segmentOrders("김민서\n핸폰: 010-2194-8913\n받는분주소: 서울 강서구 화곡로 55\n\n디")[0]).toMatchObject({
      name: "김민서", phone: "010-2194-8913", addr1: "서울 강서구 화곡로 55", vendor: "디",
    });
  });
});

// Address formats seen in the combined order chat (fake numbers)
describe("address recognition", () => {
  const one = (text: string) => {
    const orders = segmentOrders(text);
    expect(orders).toHaveLength(1);
    return orders[0];
  };

  it.each([
    // no province, "○○시 ○○구" / "○○시○○로" / "○○구 ○○로"
    ["창원시 마산회원구 내서읍 호원로211-4 코오롱 9차547동105호", "창원시 마산회원구 내서읍 호원로211-4", "코오롱 9차547동105호"],
    ["목포시산정로436 골드클래스4차 890동2661호", "목포시산정로436", "골드클래스4차 890동2661호"],
    ["강남구 삼성로243 대치포스코더샵아파트 600동549호", "강남구 삼성로243", "대치포스코더샵아파트 600동549호"],
    ["평택시 고덕국제2로 704 미래도파밀리에 1419동3620호", "평택시 고덕국제2로 704", "미래도파밀리에 1419동3620호"],
    ["경주시 대안길 37 동천참마을 533호", "경주시 대안길 37", "동천참마을 533호"],
    ["포항시남구 대잠동길 12 101동 202호", "포항시남구 대잠동길 12", "101동 202호"],
    // postal code in front
    ["(16519) 대구 수성구 범어천로 720 (범어동, 범어 STX KAN), 614동770호", "대구 수성구 범어천로 720", "(범어동, 범어 STX KAN), 614동770호"],
    ["우편번호 04713, 서울 성동구 왕십리로 12 3층", "서울 성동구 왕십리로 12", "3층"],
    // "○○로61길39" — the road's own number is not the building number
    ["서울시 용산구 이촌로61길39 엘지한강자이아파트  720-2736", "서울시 용산구 이촌로61길39", "엘지한강자이아파트 720-2736"],
    ["경북 경산시 백자로 94길 59 364/4362", "경북 경산시 백자로 94길 59", "364/4362"],
    // jibun (lot number) addresses split after the lot number
    ["인천시 미추홀구주안동148-37 한빛자동차 공업사", "인천시 미추홀구주안동148-37", "한빛자동차 공업사"],
    ["경기도 구리시 인창동43 인창해모로 614동9067호", "경기도 구리시 인창동43", "인창해모로 614동9067호"],
    ["창원시  의창구 명서동 75-4에이비씨", "창원시 의창구 명서동 75-4", "에이비씨"],
    // no number at all: after the last 동/읍/면/리, or before the first part with digits
    ["부산수영구 광안동 쌍용예가아파트513동 455호", "부산수영구 광안동", "쌍용예가아파트513동 455호"],
    ["대구 중구 대신동 동산상가 4층9열5호", "대구 중구 대신동", "동산상가 4층9열5호"],
    ["인천 송도 마리나베이 410동 9751호", "인천 송도 마리나베이", "410동 9751호"],
  ])("%s", (addr, addr1, addr2) => {
    expect(one(`블랙 66\n\n김민서\n010-2194-8913\n${addr}\n\n디`)).toMatchObject({ name: "김민서", addr1, addr2, vendor: "디" });
  });

  it("받는주소 without a colon, and a postal-code line of its own", () => {
    expect(one(`후드티 xl 105\n\n신민서 010-4815-4772\n우편번호  87797\n받는주소 서울시 은평구 연서로83길88 576동 5221호\n\n띠`)).toMatchObject({
      name: "신민서", addr1: "서울시 은평구 연서로83길88", addr2: "576동 5221호", vendor: "띠",
    });
  });

  it("'입니다~' at the end is dropped; a door code goes to the note", () => {
    expect(one(`네이비55\n\n김수희\n010 5422 5963\n경기도 오산시 죽담로441, 호반써밋라포레 436동 8054호입니다~\n\n디`)).toMatchObject({
      addr1: "경기도 오산시 죽담로441", addr2: "호반써밋라포레 436동 8054호",
    });
    expect(one(`김민서 010-2194-8913\n울산 남구 두왕로187번길 22 한솔그린빌 A동 552호 (공동비번 #0000#\n\n티`)).toMatchObject({
      addr2: "한솔그린빌 A동 552호", note: "(공동비번 #0000#",
    });
  });
});

describe("addressNeedsCheck", () => {
  it.each([
    ["서울 강서구 화곡로 55", false],
    ["경기도 구리시 인창동43", false],
    ["부산수영구 광안동", true],
    ["인천 송도 마리나베이", true],
    ["", false],
  ])("%j → %s", (addr1, expected) => {
    expect(addressNeedsCheck(addr1)).toBe(expected);
  });
});

describe("address recognition — more real shapes", () => {
  it("road name with ○가길", () => {
    expect(segmentOrders("그레이\n\n장서준\n010.2155.0057\n서울시 양천구 목동중앙남로4가길 40, 의담탑스빌 770호\n\n디")[0]).toMatchObject({
      addr1: "서울시 양천구 목동중앙남로4가길 40", addr2: "의담탑스빌 770호",
    });
  });

  it("shop name glued to the province", () => {
    expect(segmentOrders("0402. 검2개\n\n카페모아경남 통영시 죽림4로 42-74\n상가 455호\n01050616108\n카페모아\n\n디")[0]).toMatchObject({
      name: "카페모아", addr1: "경남 통영시 죽림4로 42-74", addr2: "상가 455호", vendor: "디",
    });
  });

  it("building-name lines right under a road address continue it", () => {
    expect(segmentOrders("경기 광주시 송정동 광주대로399\n중흥S클라스 파크뷰\n720/7896\n강민서 (01021431123\n\n디")[0]).toMatchObject({
      name: "강민서", addr1: "경기 광주시 송정동 광주대로399", addr2: "중흥S클라스 파크뷰 720/7896", vendor: "디",
    });
  });
});

describe("address and label edge cases (real shapes)", () => {
  it("a remark in parentheses under the address is a note, not part of the address", () => {
    expect(segmentOrders("베이지 66\n\n받으시는분\n윤하은\n010 9896 0030\n서울 종로구 자하문로 290-37  유원빌라 4동 856호\n(검수 잘해서 보내주세요.)\n\n디")[0]).toMatchObject({
      addr2: "유원빌라 4동 856호", note: "(검수 잘해서 보내주세요.)", vendor: "디",
    });
  });

  it("numbered labels and labels with a period", () => {
    expect(segmentOrders("1.성함 : 김민서\n2.주소 : 서울 강서구 화곡로 55 3층\n3. 01021948913\n\n디")[0]).toMatchObject({
      name: "김민서", phone: "010-2194-8913", addr1: "서울 강서구 화곡로 55", addr2: "3층", vendor: "디",
    });
    expect(segmentOrders("그레이 66\n\n성함. 김민서\n주소. 서울 강서구 화곡로 55 3층\n번호. 01021948913\n\n디")[0]).toMatchObject({
      name: "김민서", phone: "010-2194-8913", addr1: "서울 강서구 화곡로 55", vendor: "디",
    });
  });
});
