// Staff/team accounts. Owner can add and remove staff members; staff log in
// with the same email+password flow as owners and (for now) have identical
// permissions inside the merchant. The role field is there for future,
// finer-grained gating.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { StaffCreateInput, type StaffMember } from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { hashPassword } from "../auth/password.js";

export const staffRouter: Router = Router();

interface StaffRow extends RowDataPacket {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
  created_at: Date;
}

function rowToStaff(row: StaffRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function requireOwner(req: Request): void {
  const ctx = authContext(req);
  if (ctx.role !== "owner") {
    throw new ApiError(
      403,
      "owner_required",
      "only the merchant owner can manage team members"
    );
  }
}

// GET /v1/staff — list all team members on this merchant (any auth'd user).
staffRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ staff: StaffMember[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<StaffRow[]>(
      `SELECT id, email, name, role, created_at
         FROM staff_users WHERE merchant_id = ?
        ORDER BY role DESC, created_at ASC`,
      [ctx.merchantId]
    );
    return res.json({ staff: rows.map(rowToStaff) });
  }
);

// POST /v1/staff — owner-only. Creates a staff_users row with a bcrypt hash;
// the owner shares the credentials with the team member out-of-band.
staffRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response<StaffMember>) => {
    requireOwner(req);
    const ctx = authContext(req);
    const input = StaffCreateInput.parse(req.body);

    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS c FROM staff_users WHERE email = ?",
      [input.email]
    );
    if (Number(existing[0].c) > 0) {
      throw ApiError.conflict("a user with this email already exists");
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await pool.execute<ResultSetHeader>(
      `INSERT INTO staff_users
         (id, merchant_id, email, name, role, password_hash)
       VALUES (?, ?, ?, ?, 'staff', ?)`,
      [
        id,
        ctx.merchantId,
        input.email,
        input.name ?? null,
        Buffer.from(passwordHash, "utf8"),
      ]
    );

    return res.status(201).json({
      id,
      email: input.email,
      name: input.name ?? null,
      role: "staff",
      createdAt: new Date().toISOString(),
    });
  }
);

// DELETE /v1/staff/:id — owner-only. Removes a staff member. Owners can't
// remove themselves (would leave the merchant ownerless).
staffRouter.delete(
  "/:id",
  requireAuth,
  async (req: Request, res: Response<{ ok: true }>) => {
    requireOwner(req);
    const ctx = authContext(req);
    if (req.params.id === ctx.userId) {
      throw ApiError.badRequest("you can't remove yourself");
    }
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, role FROM staff_users WHERE id = ? AND merchant_id = ? LIMIT 1",
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("staff member not found");
    if (rows[0].role === "owner") {
      throw ApiError.badRequest("can't remove an owner");
    }
    await pool.execute("DELETE FROM staff_users WHERE id = ?", [req.params.id]);
    return res.json({ ok: true });
  }
);
