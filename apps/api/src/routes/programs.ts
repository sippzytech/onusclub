import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  StampProgramCreateInput,
  type Program,
  type StampProgramConfig,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";

export const programsRouter: Router = Router();

interface ProgramRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  name: string;
  program_type: Program["programType"];
  config_json: unknown;
  reward_text: string;
  active: number;
  created_at: Date;
}

function rowToProgram(row: ProgramRow): Program {
  // mysql2 may return JSON columns as either parsed objects or strings depending
  // on server config. Normalize once here so consumers don't have to.
  const config =
    typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    programType: row.program_type,
    configJson: config,
    rewardText: row.reward_text,
    active: row.active === 1,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

programsRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response<Program>) => {
    const ctx = authContext(req);
    const input = StampProgramCreateInput.parse(req.body);

    const id = randomUUID();
    const config: StampProgramConfig & { expiry_days?: number } = {
      type: "stamp",
      stamps_required: input.stampsRequired,
    };
    if (input.expiryDays !== undefined) {
      config.expiry_days = input.expiryDays;
    }

    await pool.execute<ResultSetHeader>(
      `INSERT INTO loyalty_programs
         (id, merchant_id, name, program_type, config_json, reward_text, active)
       VALUES (?, ?, ?, 'stamp', ?, ?, TRUE)`,
      [id, ctx.merchantId, input.name, JSON.stringify(config), input.rewardText]
    );

    return res.status(201).json({
      id,
      merchantId: ctx.merchantId,
      name: input.name,
      programType: "stamp",
      configJson: config,
      rewardText: input.rewardText,
      active: true,
      createdAt: new Date().toISOString(),
    });
  }
);

programsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ programs: Program[] }>) => {
    const ctx = authContext(req);

    const [rows] = await pool.execute<ProgramRow[]>(
      `SELECT id, merchant_id, name, program_type, config_json, reward_text, active, created_at
         FROM loyalty_programs
        WHERE merchant_id = ?
        ORDER BY created_at DESC`,
      [ctx.merchantId]
    );
    return res.json({ programs: rows.map(rowToProgram) });
  }
);
