// 로그인 비밀번호 해시 (기획서 3.1-8, 4.5). 서버·스크립트 전용 — node:crypto 만 사용하고 다른 import 없음
// (scripts/set-password.mts 에서 Node 로 직접 불러오기 때문).
//
// 저장 형식: scrypt$N$r$p$<salt base64>$<hash base64>  — 파라미터를 함께 저장해 나중에 강도를 올려도 기존 해시 검증 가능

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

/** 비밀번호 규칙: 숫자 6자리 (2026-09-27 결정) */
export const PIN_RE = /^\d{6}$/;
export const isValidPin = (pin: string) => PIN_RE.test(pin);

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** 저장된 해시와 비교 (형식이 이상하면 false). 비교는 상수 시간 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
