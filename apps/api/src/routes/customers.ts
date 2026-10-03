import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  CustomerCreateInput,
  CustomerImportInput,
  type Customer,
  type CustomerImportResult,
  type CustomerImportRowError,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { normaliseDate, parseCsv, pickField, toCsv } from "../customers/csv.js";

export const customersRouter: Router = Router();

interface CustomerRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | Date | null;
  created_at: Date;
}

function toIsoDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  // MySQL's DATE returns either ISO string or Date depending on driver config.
  return value.slice(0, 10);
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    birthday: toIsoDate(row.birthday),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

customersRouter.post("/", requireAuth, async (req: Request, res: Response<Customer>) => {
  const ctx = authContext(req);
  const input = CustomerCreateInput.parse(req.body);

  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO customers (id, merchant_id, name, phone, email, birthday)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      ctx.merchantId,
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.birthday ?? null,
    ]
  );

  return res.status(201).json({
    id,
    merchantId: ctx.merchantId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    birthday: input.birthday ?? null,
    createdAt: new Date().toISOString(),
  });
});

customersRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ customers: Customer[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<CustomerRow[]>(
      `SELECT id, merchant_id, name, phone, email, birthday, created_at
         FROM customers
        WHERE merchant_id = ?
        ORDER BY created_at DESC`,
      [ctx.merchantId]
    );
    return res.json({ customers: rows.map(rowToCustomer) });
  }
);

// ---------------------------------------------------------------------------
// CSV export / import
//
// Cafés arrive with a spreadsheet from whatever they used before, and leave
// wanting their list back. Both directions matter: an import-only product is
// one customers feel locked into.
// ---------------------------------------------------------------------------

// GET /v1/customers/export.csv
customersRouter.get("/export.csv", requireAuth, async (req: Request, res: Response) => {
  const ctx = authContext(req);

  const [rows] = await pool.execute<CustomerRow[]>(
    `SELECT id, merchant_id, name, phone, email, birthday, created_at
       FROM customers WHERE merchant_id = ? ORDER BY created_at`,
    [ctx.merchantId]
  );

  const csv = toCsv(
    ["name", "email", "phone", "birthday", "created_at"],
    rows.map((r) => [
      r.name,
      r.email,
      r.phone,
      toIsoDate(r.birthday),
      new Date(r.created_at).toISOString().slice(0, 10),
    ])
  );

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${stamp}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(csv);
});

interface DupRow extends RowDataPacket {
  id: string;
  email: string | null;
  phone: string | null;
}

interface ProgramRow extends RowDataPacket {
  id: string;
  program_type: "stamp" | "points";
}

// POST /v1/customers/import
customersRouter.post(
  "/import",
  requireAuth,
  async (req: Request, res: Response<CustomerImportResult>) => {
    const ctx = authContext(req);
    const input = CustomerImportInput.parse(req.body);

    const parsed = parseCsv(input.csv);
    const skipped: CustomerImportRowError[] = [];

    // Everything already on file, loaded once. An import of 500 rows would
    // otherwise be 1000 lookups; this is two scans of an indexed column.
    const [existingRows] = await pool.execute<DupRow[]>(
      "SELECT id, email, phone FROM customers WHERE merchant_id = ?",
      [ctx.merchantId]
    );
    const seenEmail = new Set(
      existingRows.filter((r) => r.email).map((r) => r.email!.toLowerCase())
    );
    const seenPhone = new Set(
      existingRows.filter((r) => r.phone).map((r) => r.phone!.replace(/\s+/g, ""))
    );

    // Validate the program up front rather than letting the INSERT…SELECT
    // silently match nothing: "imported 200, enrolled 0" with no explanation
    // is a worse answer than a 400.
    if (input.programId) {
      const [progRows] = await pool.execute<ProgramRow[]>(
        "SELECT id, program_type FROM loyalty_programs WHERE id = ? AND merchant_id = ? LIMIT 1",
        [input.programId, ctx.merchantId]
      );
      if (progRows.length === 0) throw ApiError.badRequest("program not found");
    }

    const toCreate: Array<{ name: string; email: string | null; phone: string | null; birthday: string | null }> = [];
    let duplicates = 0;

    parsed.rows.forEach((row, idx) => {
      const line = idx + 2; // +1 for zero-index, +1 for the header row
      const name = pickField(row, "name");
      const email = pickField(row, "email").toLowerCase();
      const phone = pickField(row, "phone").replace(/\s+/g, "");
      const rawBirthday = pickField(row, "birthday");

      if (!email && !phone) {
        skipped.push({ line, reason: "needs an email or a phone number" });
        return;
      }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        skipped.push({ line, reason: `"${email}" is not a valid email` });
        return;
      }
      if (email && seenEmail.has(email)) {
        duplicates += 1;
        return;
      }
      if (phone && seenPhone.has(phone)) {
        duplicates += 1;
        return;
      }

      // A birthday we cannot read confidently is dropped rather than guessed:
      // a wrong one means the birthday sweep messages someone on the wrong day.
      const birthday = rawBirthday ? normaliseDate(rawBirthday) : null;
      if (rawBirthday && !birthday) {
        skipped.push({ line, reason: `could not read the date "${rawBirthday}" — use YYYY-MM-DD` });
        return;
      }

      // Guard against duplicates inside the file itself, not just against
      // what is already stored.
      if (email) seenEmail.add(email);
      if (phone) seenPhone.add(phone);

      toCreate.push({
        name: name || email || phone,
        email: email || null,
        phone: phone || null,
        birthday,
      });
    });

    if (input.dryRun) {
      return res.json({
        dryRun: true,
        delimiter: parsed.delimiter,
        totalRows: parsed.rows.length,
        created: toCreate.length,
        enrolled: 0,
        duplicates,
        skipped,
      });
    }

    const conn = await pool.getConnection();
    let created = 0;
    let enrolled = 0;
    try {
      await conn.beginTransaction();
      for (const c of toCreate) {
        const id = randomUUID();
        await conn.execute<ResultSetHeader>(
          `INSERT INTO customers (id, merchant_id, name, phone, email, birthday)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, ctx.merchantId, c.name, c.phone, c.email, c.birthday]
        );
        created += 1;

        if (input.programId) {
          const cardId = randomUUID();
          const qrToken = randomBytes(32).toString("hex");
          const [ins] = await conn.execute<ResultSetHeader>(
            `INSERT IGNORE INTO loyalty_cards
               (id, merchant_id, customer_id, program_id, qr_token, card_state)
             SELECT ?, ?, ?, p.id, ?,
                    CASE WHEN p.program_type = 'points'
                         THEN JSON_OBJECT('type','points','points_current',0,'total_lifetime',0,'rewards_redeemed',0,'total_expired',0)
                         ELSE JSON_OBJECT('type','stamp','stamps_current',0,'total_lifetime',0,'rewards_redeemed',0)
                    END
               FROM loyalty_programs p
              WHERE p.id = ? AND p.merchant_id = ?`,
            [cardId, ctx.merchantId, id, qrToken, input.programId, ctx.merchantId]
          );
          if (ins.affectedRows > 0) enrolled += 1;
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return res.status(201).json({
      dryRun: false,
      delimiter: parsed.delimiter,
      totalRows: parsed.rows.length,
      created,
      enrolled,
      duplicates,
      skipped,
    });
  }
);
