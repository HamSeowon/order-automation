// 브랜드 딕셔너리 입력값 검증·일괄 등록 파싱 (순수 함수, 서버/클라이언트 공용)

export type BrandInput = { full_name: string; short_form: string };

const MAX_LEN = 100;

/** 대소문자·앞뒤 공백 무시 비교 키 (DB 유일 인덱스 lower(btrim(full_name)) 와 동일 규칙) */
export const brandKey = (fullName: string) => fullName.trim().toLowerCase();

export function validateBrand(input: unknown): { ok: true; value: BrandInput } | { ok: false; error: string } {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const full_name = typeof src.full_name === "string" ? src.full_name.trim() : "";
  const short_form = typeof src.short_form === "string" ? src.short_form.trim() : "";
  if (!full_name) return { ok: false, error: "브랜드 전체 이름을 입력하세요." };
  if (!short_form) return { ok: false, error: "줄임말을 입력하세요." };
  if (full_name.length > MAX_LEN || short_form.length > MAX_LEN) {
    return { ok: false, error: `${MAX_LEN}자 이하로 입력하세요.` };
  }
  return { ok: true, value: { full_name, short_form } };
}

// 한 줄에 "전체이름 <구분자> 줄임말". 엑셀에서 두 열 복사(탭) / = / → / -> / 쉼표 순으로 찾는다.
// 쉼표는 브랜드 이름에 들어갈 수 있어 가장 마지막 쉼표 기준.
const SEPARATORS = ["\t", "=", "→", "->"];

export type BrandLineParse = {
  entries: BrandInput[];
  /** 해석하지 못한 줄 (줄 번호는 1부터) */
  errors: { line: number; text: string }[];
};

export function parseBrandLines(text: string): BrandLineParse {
  const entries: BrandInput[] = [];
  const errors: BrandLineParse["errors"] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let full = "";
    let short = "";
    const sep = SEPARATORS.find((s) => line.includes(s));
    if (sep) {
      const at = line.indexOf(sep);
      full = line.slice(0, at);
      short = line.slice(at + sep.length);
    } else if (line.includes(",")) {
      const at = line.lastIndexOf(",");
      full = line.slice(0, at);
      short = line.slice(at + 1);
    }
    const v = validateBrand({ full_name: full, short_form: short });
    if (!v.ok) {
      errors.push({ line: i + 1, text: line });
      return;
    }
    // 같은 목록 안에서 중복되면 뒤에 나온 줄이 우선
    const key = brandKey(v.value.full_name);
    const prev = seen.get(key);
    if (prev !== undefined) entries[prev] = v.value;
    else {
      seen.set(key, entries.length);
      entries.push(v.value);
    }
  });
  return { entries, errors };
}
