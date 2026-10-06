// create_invoice_export against the real migrations, in an in-memory Postgres (PGlite).
// Never call this function on the real DB to test it: it marks every unexported real order as exported (see CLAUDE.md).

import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { invoiceRows, type InvoiceSource } from "./invoice";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // Roles that Supabase provides and the migrations grant/revoke on
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  return db;
}

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";

async function addOrder(db: PGlite, group: string, product: string) {
  await db.query(
    `insert into public.orders (order_group_id, name, phone, addr1, product_name, color, size, vendor)
     values ($1, '김민서', '010-2194-8913', '서울 강서구 화곡로 55', $2, '블랙', '66', '디')`,
    [group, product],
  );
}

type Row = InvoiceSource & { export_id: string | null };
const exportedRows = async (db: PGlite, exportId: string) =>
  (await db.query<Row>("select * from public.orders where export_id = $1 order by created_at, order_group_id, id", [exportId])).rows;

describe("create_invoice_export with n합배 groups (PGlite)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  }, 60_000);

  it("claims every product row of a group into the same export → one label row per group", async () => {
    await addOrder(db, G1, "팬츠");
    await addOrder(db, G1, "스커트");
    await addOrder(db, G2, "모자");

    const { rows: [exp] } = await db.query<{ id: string; order_count: number }>(
      "select * from public.create_invoice_export(null, 'tester')",
    );
    // order_count counts product rows (3), the file has one row per parcel (2)
    expect(exp.order_count).toBe(3);
    const rows = await exportedRows(db, exp.id);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.export_id))).toEqual(new Set([exp.id]));

    const label = invoiceRows(rows);
    expect(label.map((r) => r[3])).toEqual(["2합배-팬츠-블랙 66, 스커트-블랙 66", "모자-블랙 66"]);

    // Nothing left: a second export finds no orders (the whole group was claimed at once)
    await expect(db.query("select * from public.create_invoice_export(null, 'tester')")).rejects.toThrow(/NO_ORDERS_TO_EXPORT/);
  }, 60_000);

  it("a product added to a group after its export goes into the next file on its own (no duplicate label)", async () => {
    await addOrder(db, G1, "팬츠");
    const { rows: [first] } = await db.query<{ id: string }>("select * from public.create_invoice_export(null, 'tester')");
    await addOrder(db, G1, "스커트");
    const { rows: [second] } = await db.query<{ id: string; order_count: number }>(
      "select * from public.create_invoice_export(null, 'tester')",
    );
    expect(second.order_count).toBe(1);
    expect(invoiceRows(await exportedRows(db, first.id)).map((r) => r[3])).toEqual(["팬츠-블랙 66"]);
    expect(invoiceRows(await exportedRows(db, second.id)).map((r) => r[3])).toEqual(["스커트-블랙 66"]);
  }, 60_000);
});
