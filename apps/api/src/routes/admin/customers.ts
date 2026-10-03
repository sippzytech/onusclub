// Cross-merchant customer search and timelines — the support view.
//
// When a café writes in with "my customer says their stamps disappeared",
// this is where that gets answered. The search spans every tenant on purpose;
// the alternative is asking the café owner for an internal id first, which
// nobody has.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type {
  AdminCustomerCard,
  AdminCustomerDetail,
  AdminCustomerHit,
  AdminCustomerSearch,
} from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../errors.js";

export const adminCustomersRouter: Router = Router();

/** Hard cap on search results. Reported to the caller rather than silently applied. */
const SEARCH_LIMIT = 50;

/** Visits, consistently with the merchant list — see TXN_TYPES in admin/overview.ts. */
const TXN_TYPES = "('stamp', 'redeem', 'points_add', 'review_reward')";

interface CustomerRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  merchant_name: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: Date;
  cards: number;
  visits: number;
  last_visit: Date | null;
}

const CUSTOMER_SELECT = `
  SELECT cu.id, cu.merchant_id, cu.name, cu.email, cu.phone, cu.created_at,
         m.business_name AS merchant_name,
         COUNT(DISTINCT c.id)                                       AS cards,
         COUNT(CASE WHEN e.event_type IN ${TXN_TYPES} THEN e.id END) AS visits,
         MAX(CASE WHEN e.event_type IN ${TXN_TYPES} THEN e.created_at END) AS last_visit
    FROM customers cu
    JOIN merchants m       ON m.id = cu.merchant_id
    LEFT JOIN loyalty_cards c ON c.customer_id = cu.id
    LEFT JOIN card_events e   ON e.card_id = c.id
`;

function rowToHit(r: CustomerRow): AdminCustomerHit {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    name: r.name,
    email: r.email,
    phone: r.phone,
    createdAt: new Date(r.created_at).toISOString(),
    cards: Number(r.cards),
    visits: Number(r.visits),
    lastVisitAt: r.last_visit ? new Date(r.last_visit).toISOString() : null,
  };
}

/**
 * GET /v1/admin/customers?q=...&merchantId=...
 *
 * `q` matches name, email or phone. Requires at least two characters — an
 * empty search across every tenant would return the entire customer table,
 * which is both useless and the single worst accidental query here.
 */
adminCustomersRouter.get("/", async (req: Request, res: Response<AdminCustomerSearch>) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const merchantId = typeof req.query.merchantId === "string" ? req.query.merchantId : "";

  if (q.length < 2 && !merchantId) {
    return res.json({ query: q, customers: [], truncated: false });
  }

  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    // LIKE with a leading wildcard cannot use an index. Deliberate: this is an
    // interactive support lookup run a handful of times a day, and the
    // alternative (exact-prefix only) would fail the common case of searching
    // a surname or the tail of a phone number.
    where.push("(cu.name LIKE ? OR cu.email LIKE ? OR cu.phone LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (merchantId) {
    where.push("cu.merchant_id = ?");
    params.push(merchantId);
  }

  // LIMIT is +1 so "there are more" is a fact rather than a guess.
  const [rows] = await pool.execute<CustomerRow[]>(
    `${CUSTOMER_SELECT}
      WHERE ${where.join(" AND ")}
      GROUP BY cu.id
      ORDER BY last_visit IS NULL, last_visit DESC, cu.created_at DESC
      LIMIT ${SEARCH_LIMIT + 1}`,
    params
  );

  return res.json({
    query: q,
    customers: rows.slice(0, SEARCH_LIMIT).map(rowToHit),
    truncated: rows.length > SEARCH_LIMIT,
  });
});

interface CardRow extends RowDataPacket {
  id: string;
  program_id: string;
  program_name: string;
  program_type: string;
  reward_text: string;
  program_config: unknown;
  status: string;
  card_state: unknown;
  qr_token: string;
  google_wallet_object_id: string | null;
  apple_registrations: number;
  created_at: Date;
  last_event_at: Date | null;
}

interface BalanceRow extends RowDataPacket {
  card_id: string;
  balance: string | number | null;
}

interface TimelineRow extends RowDataPacket {
  id: number;
  card_id: string;
  program_name: string;
  event_type: string;
  amount_cents: number | string | null;
  note: string | null;
  actor_email: string | null;
  created_at: Date;
}

interface AlsoRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  merchant_name: string;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

/**
 * Human-readable balance.
 *
 * ⚠️ For points cards the number comes from `points_batches`, NOT from
 * `card_state.points_current`. That column is a cache of
 * SUM(points_remaining) which the café's next transaction recomputes, so a
 * drifted value there would be displayed here as fact. The batch ledger is
 * authoritative; see computePointsBalance in cards/operations.ts.
 */
function balanceLabel(row: CardRow, pointsBalance: number | undefined): string {
  if (row.program_type === "points") {
    const cfg = parseJson<{ points_for_reward?: number }>(row.program_config);
    const threshold = cfg.points_for_reward;
    const balance = pointsBalance ?? 0;
    return threshold
      ? `${balance} of ${threshold} points`
      : `${balance} point${balance === 1 ? "" : "s"}`;
  }
  const state = parseJson<{ stamps_current?: number }>(row.card_state);
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  return `${state.stamps_current ?? 0} of ${cfg.stamps_required ?? 0} stamps`;
}

/** GET /v1/admin/customers/:id — the full picture for one person at one café. */
adminCustomersRouter.get("/:id", async (req: Request, res: Response<AdminCustomerDetail>) => {
  const customerId = req.params.id;

  const [customerRows] = await pool.execute<CustomerRow[]>(
    `${CUSTOMER_SELECT} WHERE cu.id = ? GROUP BY cu.id`,
    [customerId]
  );
  if (customerRows.length === 0) throw ApiError.notFound("customer not found");
  const customer = rowToHit(customerRows[0]);

  const [cardRows] = await pool.execute<CardRow[]>(
    `SELECT c.id, c.program_id, c.status, c.card_state, c.qr_token,
            c.google_wallet_object_id, c.created_at, c.last_event_at,
            p.name AS program_name, p.program_type, p.reward_text,
            p.config_json AS program_config,
            (SELECT COUNT(*) FROM apple_pass_registrations r WHERE r.card_id = c.id)
              AS apple_registrations
       FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.customer_id = ?
      ORDER BY c.created_at ASC`,
    [customerId]
  );

  // One aggregate for every card at once rather than per-card, and from the
  // ledger rather than the cached column.
  const balances = new Map<string, number>();
  if (cardRows.length > 0) {
    const [balanceRows] = await pool.query<BalanceRow[]>(
      `SELECT card_id, COALESCE(SUM(points_remaining), 0) AS balance
         FROM points_batches
        WHERE card_id IN (${cardRows.map(() => "?").join(",")})
          AND points_remaining > 0
          AND (expires_at IS NULL OR expires_at > NOW())
        GROUP BY card_id`,
      cardRows.map((c) => c.id)
    );
    for (const b of balanceRows) balances.set(b.card_id, Number(b.balance ?? 0));
  }

  const cards: AdminCustomerCard[] = cardRows.map((c) => ({
    id: c.id,
    programId: c.program_id,
    programName: c.program_name,
    programType: c.program_type,
    rewardText: c.reward_text,
    status: c.status,
    balanceLabel: balanceLabel(c, balances.get(c.id)),
    qrToken: c.qr_token,
    hasGooglePass: c.google_wallet_object_id !== null,
    appleRegistrations: Number(c.apple_registrations),
    createdAt: new Date(c.created_at).toISOString(),
    lastEventAt: c.last_event_at ? new Date(c.last_event_at).toISOString() : null,
  }));

  // Joined to staff_users for attribution. `card_events.staff_user_id` has
  // existed since 001 and nothing has ever written it, so this is null for
  // every historical row — honest rather than invented. Manual adjustments
  // populate it.
  const [timelineRows] = await pool.execute<TimelineRow[]>(
    `SELECT e.id, e.card_id, e.event_type, e.amount_cents, e.note, e.created_at,
            p.name AS program_name,
            su.email AS actor_email
       FROM card_events e
       JOIN loyalty_cards c    ON c.id = e.card_id
       JOIN loyalty_programs p ON p.id = c.program_id
       LEFT JOIN staff_users su ON su.id = e.staff_user_id
      WHERE c.customer_id = ?
      ORDER BY e.id DESC
      LIMIT 200`,
    [customerId]
  );

  // Matched on contact details, not merged. `customers` is per-merchant by
  // design, and joining identities would let one café's correction alter
  // another café's records.
  const [alsoRows] = await pool.execute<AlsoRow[]>(
    `SELECT cu.id, cu.merchant_id, m.business_name AS merchant_name
       FROM customers cu
       JOIN merchants m ON m.id = cu.merchant_id
      WHERE cu.id <> ?
        AND cu.merchant_id <> ?
        AND ((? IS NOT NULL AND cu.email = ?) OR (? IS NOT NULL AND cu.phone = ?))
      ORDER BY m.business_name
      LIMIT 20`,
    [
      customerId,
      customer.merchantId,
      customer.email,
      customer.email,
      customer.phone,
      customer.phone,
    ]
  );

  return res.json({
    customer,
    cards,
    events: timelineRows.map((e) => ({
      id: Number(e.id),
      cardId: e.card_id,
      programName: e.program_name,
      eventType: e.event_type,
      amountCents: e.amount_cents === null ? null : Number(e.amount_cents),
      note: e.note,
      actorEmail: e.actor_email,
      createdAt: new Date(e.created_at).toISOString(),
    })),
    alsoMemberAt: alsoRows.map((a) => ({
      merchantId: a.merchant_id,
      merchantName: a.merchant_name,
      customerId: a.id,
    })),
  });
});
