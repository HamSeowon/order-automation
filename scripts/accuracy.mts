// Field-level parsing accuracy against the anonymized KakaoTalk order fixtures (src/lib/__fixtures__/kakao-orders.json).
//
//   npm run accuracy                         → score table (+ comparison with recorded runs)
//   npm run accuracy -- --fails addr1        → list the mismatches for one field (name/phone/addr1/addr2/vendor/brand_short/color/size/split)
//   npm run accuracy -- --record "1단계 후"   → also save this run to accuracy-history.json
//   npm run accuracy -- --impl <orders.ts>    → score another implementation (e.g. an old copy), not recorded
//
// Two sets: kakao-orders.json (looked at while writing the rules) and kakao-orders-holdout.json (never looked at — the
// honest number; don't tune rules on it)
//
// Expected values of null are "can't be known from the text" and are not scored.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { draftsFromText, parsePaste } from "../src/lib/orders.ts";
import { parseBrandLines } from "../src/lib/brands.ts";

type Item = { brand_short: string | null; color: string | null; size: string | null };
type Fixture = {
  id: string;
  raw: string;
  expected: { name: string; phone: string; addr1: string; addr2: string; vendor: string; items: Item[] };
  note?: string;
};
type Run = { label: string; date: string; scores: Record<string, number> };

const DIR = new URL("../src/lib/__fixtures__/", import.meta.url);
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL("kakao-orders.json", DIR), "utf8"));
const holdoutFile = new URL("kakao-orders-holdout.json", DIR);
const holdout: Fixture[] = existsSync(holdoutFile) ? JSON.parse(readFileSync(holdoutFile, "utf8")) : [];
const dict = parseBrandLines(readFileSync(new URL("brand-dictionary.txt", DIR), "utf8")).entries;
const HISTORY = new URL("accuracy-history.json", DIR);

const FIELDS = ["split", "name", "phone", "addr1", "addr2", "vendor", "brand_short", "color", "size"] as const;
type Field = (typeof FIELDS)[number];
const LABEL: Record<Field, string> = {
  split: "주문 1건 분리", name: "이름", phone: "전화", addr1: "주소1", addr2: "주소2", vendor: "태그(거래처)",
  brand_short: "브랜드", color: "색상", size: "사이즈",
};

// Addresses are compared ignoring spaces/commas (spacing isn't what we're measuring)
const norm = (f: Field, v: string) => {
  const s = v.trim();
  if (f === "addr1" || f === "addr2") return s.replace(/[\s,]/g, "");
  if (f === "size") return s.toUpperCase();
  return s;
};

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const failsFor = argValue("--fails") as Field | undefined;
const recordLabel = argValue("--record");

// --impl <path>: score another implementation of draftsFromText (e.g. a copy of an older version) without recording.
// Older versions took a third "base" argument ({ source_room, created_by }).
type Drafts = (text: string, d: typeof dict, ...rest: unknown[]) => { groupId: string; fields: Record<string, string> }[];
const implPath = argValue("--impl");
const draftsImpl: Drafts = implPath
  ? ((await import(pathToFileURL(resolve(implPath)).href)) as { draftsFromText: Drafts }).draftsFromText
  : (draftsFromText as unknown as Drafts);
const runDrafts = (text: string) =>
  implPath && draftsImpl.length >= 3 ? draftsImpl(text, dict, { source_room: "", created_by: "" }) : draftsImpl(text, dict);

/** Score one fixture set; prints the table and returns the scores (keys prefixed for the holdout set) */
function scoreSet(title: string, set: Fixture[], prefix: string): Record<string, number> {
  const tally = Object.fromEntries(FIELDS.map((f) => [f, { ok: 0, total: 0 }])) as Record<Field, { ok: number; total: number }>;
  const fails: string[] = [];
  const check = (f: Field, id: string, expected: string | null, actual: string | undefined) => {
    if (expected === null) return;
    const ok = norm(f, expected) === norm(f, actual ?? "");
    tally[f].total++;
    if (ok) tally[f].ok++;
    else if (f === failsFor) fails.push(`${id}: 정답 ${JSON.stringify(expected)} / 결과 ${JSON.stringify(actual ?? "(없음)")}`);
  };

  for (const fx of set) {
    const drafts = runDrafts(fx.raw);
    const groups = [...new Set(drafts.map((d) => d.groupId))];
    check("split", fx.id, "1", String(groups.length));
    const cards = drafts.filter((d) => d.groupId === groups[0]).map((d) => d.fields);
    const first = cards[0];
    for (const f of ["name", "phone", "addr1", "addr2", "vendor"] as const) check(f, fx.id, fx.expected[f], first?.[f]);
    fx.expected.items.forEach((item, i) => {
      for (const f of ["brand_short", "color", "size"] as const) check(f, `${fx.id}#${i + 1}`, item[f], cards[i]?.[f]);
    });
  }

  const pct = (f: Field) => (tally[f].total ? (100 * tally[f].ok) / tally[f].total : 0);
  const scores: Record<string, number> = {};
  for (const f of FIELDS) scores[prefix + f] = Math.round(pct(f) * 10) / 10;
  const all = FIELDS.reduce((a, f) => ({ ok: a.ok + tally[f].ok, total: a.total + tally[f].total }), { ok: 0, total: 0 });
  scores[prefix + "overall"] = Math.round((1000 * all.ok) / all.total) / 10;

  console.log(`\n${title} (주문 ${set.length}건, 브랜드 사전 ${dict.length}줄)\n`);
  for (const f of FIELDS) {
    console.log(`  ${LABEL[f].padEnd(8)} ${scores[prefix + f].toFixed(1).padStart(5)}%  (${tally[f].ok}/${tally[f].total})`);
  }
  console.log(`  ${"전체".padEnd(8)} ${scores[prefix + "overall"].toFixed(1).padStart(5)}%  (${all.ok}/${all.total})`);
  if (failsFor) {
    console.log(`\n[${LABEL[failsFor] ?? failsFor}] 틀린 항목 ${fails.length}건`);
    for (const line of fails) console.log(`  ${line}`);
  }
  return scores;
}

const scores = scoreSet("정확도 — 정답 세트 (규칙을 만들 때 본 주문)", fixtures, "");
// Holdout: orders never looked at while writing the rules — the honest number
if (holdout.length) Object.assign(scores, scoreSet("정확도 — 검증 세트 (규칙을 만들 때 안 본 주문)", holdout, "holdout_"));

// Whole-file check against the private export (private/*.txt, never committed) — aggregate counts only.
// There's no gold for the whole file, so these are proxies: how many order cards form, and how many are complete.
const privateDir = new URL("../private/", import.meta.url);
const exportFile = existsSync(privateDir) ? readdirSync(privateDir).find((f) => f.endsWith(".txt")) : undefined;
if (exportFile) {
  const text = readFileSync(new URL(encodeURIComponent(exportFile), privateDir), "utf8");
  const { drafts, excluded } = parsePaste(text, dict);
  const groups = new Map(drafts.map((d) => [d.groupId, d.fields]));
  const complete = [...groups.values()].filter((f) => f.name.trim() && f.phone.trim() && f.addr1.trim()).length;
  scores.file_orders = groups.size;
  scores.file_complete = groups.size ? Math.round((1000 * complete) / groups.size) / 10 : 0;
  scores.file_excluded = excluded.length;
  console.log(`\n전체 내보내기 파일 (private/, 참고용 — 정답 없음)`);
  console.log(`  주문 카드 묶음  ${groups.size}개  (전화번호가 있는 메시지 ${phoneMessages(text)}개)`);
  console.log(`  이름·전화·주소 모두 채워짐  ${scores.file_complete.toFixed(1)}%  (${complete}/${groups.size})`);
  console.log(`  제외된 메시지  ${excluded.length}개`);
}

let history: Run[] = [];
try {
  history = JSON.parse(readFileSync(HISTORY, "utf8"));
} catch {}
if (recordLabel && implPath) console.log("\n(--impl 실행은 기록하지 않습니다)");
else if (recordLabel) {
  history = [...history.filter((r) => r.label !== recordLabel), { label: recordLabel, date: new Date().toISOString().slice(0, 10), scores }];
  writeFileSync(HISTORY, JSON.stringify(history, null, 2) + "\n");
  console.log(`\n'${recordLabel}' 기록을 저장했습니다.`);
}
if (history.length) {
  const cols = [...FIELDS, "overall"] as const;
  console.log(`\n기록 비교 (%)\n`);
  console.log(["단계".padEnd(14), ...cols.map((c) => (c === "overall" ? "전체" : LABEL[c]).slice(0, 5).padStart(6, " "))].join(" "));
  for (const r of history) {
    console.log([r.label.padEnd(14), ...cols.map((c) => (r.scores[c]?.toFixed(1) ?? "-").padStart(6))].join(" "));
  }
  if (history.some((r) => r.scores.holdout_overall !== undefined)) {
    console.log(`\n검증 세트 비교 (%)\n`);
    for (const r of history.filter((h) => h.scores.holdout_overall !== undefined)) {
      console.log([r.label.padEnd(14), ...cols.map((c) => (r.scores[`holdout_${c}`]?.toFixed(1) ?? "-").padStart(6))].join(" "));
    }
  }
  if (history.some((r) => r.scores.file_orders !== undefined)) {
    console.log(`\n전체 파일 비교 (주문 묶음 수 / 필수 3항목 채움 % / 제외 메시지 수)\n`);
    for (const r of history) {
      const s = r.scores;
      console.log(`${r.label.padEnd(14)} ${String(s.file_orders ?? "-").padStart(6)} ${(s.file_complete?.toFixed(1) ?? "-").padStart(7)} ${String(s.file_excluded ?? "-").padStart(6)}`);
    }
  }
}

/** Rough count of real orders in the export: messages (by header) that contain a phone number and no waybill */
function phoneMessages(text: string): number {
  return text
    .split(/\r?\n(?=[A-Z][a-z]{2} \d{1,2}, \d{4} at )/)
    .filter((m) => /0\d{1,2}[\s.\-)]*\d{3,4}[\s.\-]*\d{4}/.test(m) && !/452-\d{4}-\d{4}/.test(m)).length;
}
