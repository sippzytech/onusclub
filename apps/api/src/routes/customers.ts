import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  CustomerBlockInput,
  CustomerCreateInput,
  CustomerImportInput,
  type Customer,
  type CustomerBlock,
  type CustomerImportResult,
  type CustomerImportRowError,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { normaliseDate, parseCsv, pickField, toCsv } from "../customers/csv.js";
import { recordBlock } from "../customers/blocks.js";
import { writeAuditLog, writeAuditLogPooled } from "../admin/audit.js";

export const customersRouter: Router = Router();

interface BlockRow extends RowDataPacket {
  id: number;
  merchant_id: string | null;
  display_hint: string;
  reason: string;
  actor_email: string;
  created_at: Date;
}

function rowToBlock(r: BlockRow): CustomerBlock {
  return {
    id: Number(r.id),
    merchantId: r.merchant_id,
    displayHint: r.display_hint,
    reason: r.reason,
    actorEmail: r.actor_email,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

interface ActorEmailRow extends RowDataPacket {
  email: string;
}

/**
 * The acting staff user's email, for the audit row.
 *
 * `admin_audit_log` denormalises the email on purpose — there is no FK to
 * staff_users, so the log must capture it at write time or stop naming anyone
 * the day an account is deleted. The JWT carries only the id, so this is one
 * indexed read per write. Audit writes are rare; correctness beats saving it.
 */
async function actorEmail(userId: string): Promise<string> {
  const [rows] = await pool.execute<ActorEmailRow[]>(
    "SELECT email FROM staff_users WHERE id = ? LIMIT 1",
    [userId]
  );
  return rows[0]?.email ?? "(unknown)";
}

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

// ---------------------------------------------------------------------------
// Removing and blocking customers (Day 32)
//
// The café-owner half. The admin half lives in routes/admin/customers.ts and
// adds the platform-wide scope.
//
// Every handler here is merchant-scoped by the WHERE clause, so a café can
// only ever reach its own rows — the cross-tenant suite in smoke.ts asserts it.
// ---------------------------------------------------------------------------

/**
 * DELETE /v1/customers/:id — remove a customer from this café.
 *
 * The FK cascade from `customers` clears their cards, events and points
 * batches. They can enrol again afterwards and start from zero, which is the
 * difference between this and a block: removing is a reset, not a punishment.
 */
customersRouter.delete(
  "/:id",
  requireAuth,
  async (req: Request, res: Response<{ removed: true }>) => {
    const ctx = authContext(req);

    const [rows] = await pool.execute<CustomerRow[]>(
      "SELECT id, name, email, phone FROM customers WHERE id = ? AND merchant_id = ? LIMIT 1",
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("customer not found");

    await writeAuditLogPooled({
      actor: { userId: ctx.userId, email: await actorEmail(ctx.userId), merchantId: ctx.merchantId },
      action: "customer.remove",
      merchantId: ctx.merchantId,
      targetType: "customer",
      targetId: req.params.id,
      reason: "removed by the café",
      before: { name: rows[0].name, hasEmail: Boolean(rows[0].email), hasPhone: Boolean(rows[0].phone) },
    });

    await pool.execute("DELETE FROM customers WHERE id = ? AND merchant_id = ?", [
      req.params.id,
      ctx.merchantId,
    ]);
    return res.json({ removed: true });
  }
);

/**
 * POST /v1/customers/:id/block — block a customer from THIS café.
 *
 * Two writes in one transaction, because either alone is half a feature:
 * the card status stops the pass working now, the block row stops them
 * enrolling again later.
 *
 * ⚠️ A café owner cannot reach the platform scope. `scope` is accepted in the
 * contract so one shape serves both surfaces, and rejected here.
 */
customersRouter.post(
  "/:id/block",
  requireAuth,
  async (req: Request, res: Response<{ blocked: true }>) => {
    const ctx = authContext(req);
    const input = CustomerBlockInput.parse(req.body);
    if (input.scope === "platform") {
      // 403 rather than 400: the request is well-formed, the caller is not
      // allowed to make it.
      throw new ApiError(
        403,
        "forbidden",
        "only a platform admin can block a customer from every café"
      );
    }

    const [rows] = await pool.execute<CustomerRow[]>(
      "SELECT id, name, email, phone FROM customers WHERE id = ? AND merchant_id = ? LIMIT 1",
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("customer not found");
    const c = rows[0];
    if (!c.email && !c.phone) {
      // Nothing to match on at the next enrolment, so the block would be
      // decorative. Say so rather than pretending it worked.
      throw ApiError.badRequest(
        "this customer has no email or phone, so there is nothing to block them by — remove them instead"
      );
    }

    const email = await actorEmail(ctx.userId);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "UPDATE loyalty_cards SET status = 'blocked' WHERE customer_id = ? AND merchant_id = ?",
        [c.id, ctx.merchantId]
      );
      await recordBlock(conn, {
        merchantId: ctx.merchantId,
        email: c.email,
        phone: c.phone,
        reason: input.reason,
        actorUserId: ctx.userId,
        actorEmail: email,
      });
      await writeAuditLog(conn, {
        actor: { userId: ctx.userId, email, merchantId: ctx.merchantId },
        action: "customer.block",
        merchantId: ctx.merchantId,
        targetType: "customer",
        targetId: c.id,
        reason: input.reason,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return res.json({ blocked: true });
  }
);

/** GET /v1/customer-blocks — this café's own blocks, newest first. */
customersRouter.get(
  "/blocks/list",
  requireAuth,
  async (req: Request, res: Response<{ blocks: CustomerBlock[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BlockRow[]>(
      `SELECT id, merchant_id, display_hint, reason, actor_email, created_at
         FROM customer_blocks
        WHERE merchant_id = ?
        ORDER BY id DESC
        LIMIT 200`,
      [ctx.merchantId]
    );
    return res.json({ blocks: rows.map(rowToBlock) });
  }
);

/**
 * DELETE /v1/customers/blocks/:blockId — lift one of this café's blocks.
 *
 * ⚠️ Scoped to `merchant_id` so a café cannot lift a PLATFORM block, which has
 * `merchant_id IS NULL` and therefore never matches. That is the point: a
 * platform ban is not something the banned café can undo.
 *
 * Lifting does not un-block their existing cards. Those were blocked as a
 * separate act and are un-blocked separately — a café lifting a ban to let
 * someone start again usually wants them to start again.
 */
customersRouter.delete(
  "/blocks/:blockId",
  requireAuth,
  async (req: Request, res: Response<{ lifted: true }>) => {
    const ctx = authContext(req);
    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM customer_blocks WHERE id = ? AND merchant_id = ?",
      [req.params.blockId, ctx.merchantId]
    );
    if (result.affectedRows === 0) throw ApiError.notFound("block not found");

    await writeAuditLogPooled({
      actor: { userId: ctx.userId, email: await actorEmail(ctx.userId), merchantId: ctx.merchantId },
      action: "customer.unblock",
      merchantId: ctx.merchantId,
      targetType: "customer_block",
      targetId: req.params.blockId,
      reason: "lifted by the café",
    });
    return res.json({ lifted: true });
  }
);
