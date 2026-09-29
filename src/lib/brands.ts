// Brand-dictionary input validation and bulk-entry parsing (pure functions, shared by server and client)

export type BrandInput = { full_name: string; short_form: string };

const MAX_LEN = 100;

/** Comparison key ignoring case and surrounding whitespace (same rule as the DB's unique index lower(btrim(full_name))) */
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

// Each line is "full name <separator> short form". Looks for tab (pasting two Excel columns) / = / → / -> / comma, in that order.
// Commas can appear inside brand names, so a comma separator is matched on its last occurrence.
const SEPARATORS = ["\t", "=", "→", "->"];

export type BrandLineParse = {
  entries: BrandInput[];
  /** Lines that couldn't be parsed (1-based line numbers) */
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
    // If the same entry appears twice in the list, the later line wins
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
