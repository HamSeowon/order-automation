import { describe, expect, it } from "vitest";
import { splitKakaoPaste } from "./kakao";

// Fictionalized excerpt in the exact shape of a real "대화 내보내기" .txt (English UI):
// BOM, \r\n line endings, U+202F (narrow no-break space) before AM/PM, day separator lines,
// "The message has been deleted." left as a header-less line, waybill/notice messages, a multi-line order message.
const NNBSP = " ";
const EXPORT = [
  "﻿Talk_2026.10.6 01:04-1.txt",
  `Date Saved : Oct 6, 2026 at 2:10${NNBSP}AM`,
  "",
  "",
  "Monday, September 21, 2026",
  `Sep 21, 2026 at 12:42${NNBSP}AM: 직원A  invited 테스트 .`,
  `Sep 21, 2026 at 12:42${NNBSP}AM, W : 오세린 (띠)   452-1234-5678`,
  "",
  "그레이 66  >>  77  교환",
  `Sep 21, 2026 at 12:44${NNBSP}AM, 직원A : 2 photos `,
  `Sep 21, 2026 at 12:44${NNBSP}AM, 직원A : 1828`,
  "",
  "말본 [ MALBON ]",
  "여성 립밴드 세미 와이드 팬츠",
  "브라운55",
  "",
  "김민서",
  "010-2194-8913",
  "인천 미추홀구 낙섬동로7(금호타운)24동3175호",
  "",
  "디",
  "The message has been deleted.",
  `Sep 21, 2026 at 12:50${NNBSP}AM, W : Emoticons `,
  `Sep 21, 2026 at 12:53${NNBSP}AM, W : File: 로젠(파일접수).xlsx`,
  `Sep 21, 2026 at 12:53${NNBSP}AM, W : Photo`,
  "Tuesday, September 22, 2026",
  `Sep 22, 2026 at 4:24${NNBSP}AM, 직원A : 한지호 `,
  "",
  "55 66 품절",
  `Sep 22, 2026 at 4:30${NNBSP}AM, 직원A : ㅡㅡㅡㅡㅡㅡㅡㅡㅡ`,
  `Sep 22, 2026 at 4:31${NNBSP}AM, 직원A : 박도윤`,
  "",
  "합배!!!",
  // Contains a notice word ("교환") but asks for combined shipping → kept for the 합배 step
  `Sep 22, 2026 at 4:31${NNBSP}AM, 직원A : 장터 교환 제품 여기로 같이 보내주시면 됩니다`,
  "",
  "합배",
  `Sep 22, 2026 at 4:32${NNBSP}AM, 직원A : 그레이 66`,
  "",
  "박하은 010 2394 1426",
  "대구 수성구 청수로469  9394동549호",
  "",
  "장터 누락!!!",
].join("\r\n");

describe("splitKakaoPaste — exported chat (.txt)", () => {
  const paste = splitKakaoPaste(EXPORT);

  it("detects the export format and keeps only order-ish messages, without headers", () => {
    expect(paste.structured).toBe(true);
    expect(paste.messages.map((m) => m.text)).toEqual([
      "1828\n\n말본 [ MALBON ]\n여성 립밴드 세미 와이드 팬츠\n브라운55\n\n김민서\n010-2194-8913\n인천 미추홀구 낙섬동로7(금호타운)24동3175호\n\n디",
      // "합배" follow-ups are kept (merged with the previous order in a later step)
      "박도윤\n\n합배!!!",
      "장터 교환 제품 여기로 같이 보내주시면 됩니다\n\n합배",
      // A real order that merely contains a notice word ("누락") is kept because it has a phone number
      "그레이 66\n\n박하은 010 2394 1426\n대구 수성구 청수로469  9394동549호\n\n장터 누락!!!",
    ]);
    expect(paste.messages[0]).toMatchObject({ sender: "직원A", time: "Sep 21, 2026 at 12:44 AM" });
  });

  it("lists every excluded message with a reason", () => {
    expect(paste.excluded.map((m) => [m.reason, m.text])).toEqual([
      ["시스템 메시지", "직원A  invited 테스트 ."],
      ["송장번호(교환·배송 안내)", "오세린 (띠)   452-1234-5678\n\n그레이 66  >>  77  교환"],
      ["사진·이모티콘·파일", "2 photos"],
      ["사진·이모티콘·파일", "Emoticons"],
      ["사진·이모티콘·파일", "File: 로젠(파일접수).xlsx"],
      ["사진·이모티콘·파일", "Photo"],
      ["안내(교환·품절·취소 등)", "한지호\n\n55 66 품절"],
      ["구분선·짧은 답장", "ㅡㅡㅡㅡㅡㅡㅡㅡㅡ"],
    ]);
  });
});

describe("splitKakaoPaste — other formats", () => {
  it("Korean-locale mobile export and PC copy ([이름] [오후 1:32]) are also split into messages", () => {
    const ko = splitKakaoPaste(
      "2026년 9월 21일 월요일\n2026년 9월 21일 오전 1:31, 홍길동님이 들어왔습니다.\n2026년 9월 21일 오전 1:32, 홍길동 : 사진\n2026년 9월 21일 오전 1:33, 홍길동 : 블랙 66\n김민서 01021948913",
    );
    expect(ko.messages.map((m) => m.text)).toEqual(["블랙 66\n김민서 01021948913"]);
    expect(ko.excluded.map((m) => m.reason)).toEqual(["시스템 메시지", "사진·이모티콘·파일"]);

    const pc = splitKakaoPaste("--------------- 2026년 9월 21일 월요일 ---------------\n[홍길동] [오후 1:32] 이모티콘\n[홍길동] [오후 1:33] 블랙 66\n김민서 01021948913");
    expect(pc.messages.map((m) => m.text)).toEqual(["블랙 66\n김민서 01021948913"]);
    expect(pc.excluded).toHaveLength(1);
  });

  it("plain text copied from the app (no headers) passes through as one message; only deleted-message lines are dropped", () => {
    const paste = splitKakaoPaste("블랙 66\r\n\r\n김민서 01021948913\r\nThe message has been deleted.\r\n사진");
    expect(paste).toEqual({
      structured: false,
      messages: [{ sender: "", time: "", text: "블랙 66\n\n김민서 01021948913\n사진" }],
      excluded: [],
    });
  });
});
