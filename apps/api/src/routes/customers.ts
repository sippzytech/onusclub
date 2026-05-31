import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { CustomerCreateInput, type Customer } from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";

export const customersRouter: Router = Router();

interface CustomerRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: Date;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

customersRouter.post("/", requireAuth, async (req: Request, res: Response<Customer>) => {
  const ctx = authContext(req);
  const input = CustomerCreateInput.parse(req.body);

  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO customers (id, merchant_id, name, phone, email)
     VALUES (?, ?, ?, ?, ?)`,
    [id, ctx.merchantId, input.name, input.phone ?? null, input.email ?? null]
  );

  return res.status(201).json({
    id,
    merchantId: ctx.merchantId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    createdAt: new Date().toISOString(),
  });
});

customersRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ customers: Customer[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<CustomerRow[]>(
      `SELECT id, merchant_id, name, phone, email, created_at
         FROM customers
        WHERE merchant_id = ?
        ORDER BY created_at DESC`,
      [ctx.merchantId]
    );
    return res.json({ customers: rows.map(rowToCustomer) });
  }
);
