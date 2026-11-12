// Cross-merchant customer search and timelines — the support view.
//
// When a café writes in with "my customer says their stamps disappeared",
// this is where that gets answered. The search spans every tenant on purpose;
// the alternative is asking the café owner for an internal id first, which
// nobody has.

import { Router, type Request, type Response } from "express";
import { CustomerBlockInput, type BlockScope, type CustomerIdentity } from "@onusclub/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type {
  AdminCustomerCard,
  AdminCustomerDetail,
  AdminCustomerHit,
  AdminCustomerSearch,
} from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../errors.js";
import { adminContext } from "../../admin/authorize.js";
import { writeAuditLog, writeAuditLogPooled } from "../../admin/audit.js";
import {
  hashIdentifier,
  normaliseEmail,
  normalisePhone,
  recordBlock,
} from "../../customers/blocks.js";

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

// ---------------------------------------------------------------------------
// Removing and blocking, from the platform side (Day 32)
//
// Same two actions a café owner has in routes/customers.ts, plus the one it
// cannot use: `scope: "platform"`, which blocks the person at every café.
//
// ⚠️ Cross-tenant by design, which is why this lives under routes/admin/.
// Authorization is applied once to the /v1/admin mount in index.ts.
// ---------------------------------------------------------------------------

interface AdminCustomerRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

async function loadCustomerAnywhere(customerId: string): Promise<AdminCustomerRow> {
  const [rows] = await pool.execute<AdminCustomerRow[]>(
    "SELECT id, merchant_id, name, email, phone FROM customers WHERE id = ? LIMIT 1",
    [customerId]
  );
  if (rows.length === 0) throw ApiError.notFound("customer not found");
  return rows[0];
}

/** DELETE /v1/admin/customers/:id — remove, from any café. */
adminCustomersRouter.delete(
  "/:id",
  async (req: Request, res: Response<{ removed: true }>) => {
    const actor = adminContext(req);
    const c = await loadCustomerAnywhere(req.params.id);

    await writeAuditLogPooled({
      actor,
      action: "customer.remove",
      merchantId: c.merchant_id,
      targetType: "customer",
      targetId: c.id,
      reason: "removed by a platform admin",
      before: { name: c.name, hasEmail: Boolean(c.email), hasPhone: Boolean(c.phone) },
    });
    await pool.execute("DELETE FROM customers WHERE id = ?", [c.id]);
    return res.json({ removed: true });
  }
);

/**
 * POST /v1/admin/customers/:id/block — block at one café, or everywhere.
 *
 * `scope: "platform"` writes `merchant_id = NULL`, which `findBlock` matches
 * for every merchant. Only this route can produce that row.
 *
 * ⚠️ A platform block still only blocks the cards at the café the customer
 * row belongs to — we cannot block cards we cannot see from one row. The
 * block list is what stops them at every other café, on their next enrolment.
 * Worth knowing: a platform-blocked person with an existing card elsewhere
 * keeps that card working until someone blocks it too.
 */
adminCustomersRouter.post(
  "/:id/block",
  async (req: Request, res: Response<{ blocked: true; scope: BlockScope }>) => {
    const actor = adminContext(req);
    const input = CustomerBlockInput.parse(req.body);
    const scope: BlockScope = input.scope ?? "merchant";
    const c = await loadCustomerAnywhere(req.params.id);

    if (!c.email && !c.phone) {
      throw ApiError.badRequest(
        "this customer has no email or phone, so there is nothing to block them by — remove them instead"
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "UPDATE loyalty_cards SET status = 'blocked' WHERE customer_id = ?",
        [c.id]
      );
      await recordBlock(conn, {
        merchantId: scope === "platform" ? null : c.merchant_id,
        email: c.email,
        phone: c.phone,
        reason: input.reason,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      });
      await writeAuditLog(conn, {
        actor,
        action: "customer.block",
        merchantId: scope === "platform" ? null : c.merchant_id,
        targetType: "customer",
        targetId: c.id,
        reason: input.reason,
        after: { scope },
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return res.json({ blocked: true, scope });
  }
);

/** GET /v1/admin/customers/blocks/all — every block, any café, newest first. */
adminCustomersRouter.get(
  "/blocks/all",
  async (_req: Request, res: Response<{ blocks: AdminBlockRow[] }>) => {
    const [rows] = await pool.query<AdminBlockListRow[]>(
      `SELECT b.id, b.merchant_id, b.display_hint, b.reason, b.actor_email, b.created_at,
              m.business_name
         FROM customer_blocks b
         LEFT JOIN merchants m ON m.id = b.merchant_id
        ORDER BY b.id DESC
        LIMIT 500`
    );
    return res.json({
      blocks: rows.map((r) => ({
        id: Number(r.id),
        merchantId: r.merchant_id,
        // Null merchant_id is a platform block; a non-null one whose merchant
        // has been deleted shows as discontinued rather than vanishing.
        merchantName:
          r.merchant_id === null ? null : r.business_name ?? "(café discontinued)",
        displayHint: r.display_hint,
        reason: r.reason,
        actorEmail: r.actor_email,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    });
  }
);

/** DELETE /v1/admin/customers/blocks/:blockId — lift any block, including platform. */
adminCustomersRouter.delete(
  "/blocks/:blockId",
  async (req: Request, res: Response<{ lifted: true }>) => {
    const actor = adminContext(req);
    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM customer_blocks WHERE id = ?",
      [req.params.blockId]
    );
    if (result.affectedRows === 0) throw ApiError.notFound("block not found");

    await writeAuditLogPooled({
      actor,
      action: "customer.unblock",
      targetType: "customer_block",
      targetId: req.params.blockId,
      reason: "lifted by a platform admin",
    });
    return res.json({ lifted: true });
  }
);

/** Row shape for the cross-tenant block list. */
interface AdminBlockListRow extends RowDataPacket {
  id: number;
  merchant_id: string | null;
  display_hint: string;
  reason: string;
  actor_email: string;
  created_at: Date;
  business_name: string | null;
}

/** What /blocks/all returns. Defined here rather than in shared: admin-only. */
interface AdminBlockRow {
  id: number;
  merchantId: string | null;
  /** Null for a platform block; "(café discontinued)" if the café is gone. */
  merchantName: string | null;
  displayHint: string;
  reason: string;
  actorEmail: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// GET /v1/admin/customer-identities?q= — the cross-café view (Day 32, Stage 2)
//
// 💡 DERIVED, NOT STORED. The original ask was for a "master customer table".
// There is no such table and there should not be one: `customers` already
// holds email and phone per merchant, so the same person at three cafés is
// three rows differing only by `merchant_id`. Grouping them at query time
// gives the same answer with no second copy to keep in step — and this
// codebase has been bitten four times by stored data drifting from its source
// (logo_url, points_current, the RFM thresholds, staff_user_id).
//
// A GROUP BY cannot be out of date.
//
// ⚠️ Deleted cafés do NOT appear here. Deleting a café cascades its customers,
// so there is no row left to show — which is the retention behaviour the
// hashed-block-list split was chosen for. "(café discontinued)" shows up in
// the BLOCK list, where the row deliberately outlives its café.
// ---------------------------------------------------------------------------

interface BlockScopeRow extends RowDataPacket {
  merchant_id: string | null;
  email_hash: string | null;
  phone_hash: string | null;
}

interface IdentityRow extends RowDataPacket {
  customer_id: string;
  merchant_id: string;
  business_name: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  active_cards: number;
  blocked_cards: number;
}

adminCustomersRouter.get(
  "/identities/search",
  async (req: Request, res: Response<{ identities: CustomerIdentity[]; capped: boolean }>) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ identities: [], capped: false });

    const like = `%${q}%`;
    const [rows] = await pool.execute<IdentityRow[]>(
      `SELECT cu.id AS customer_id, cu.merchant_id, cu.name, cu.email, cu.phone,
              m.business_name,
              SUM(c.status = 'active')  AS active_cards,
              SUM(c.status = 'blocked') AS blocked_cards
         FROM customers cu
         JOIN merchants m ON m.id = cu.merchant_id
         LEFT JOIN loyalty_cards c ON c.customer_id = cu.id
        WHERE cu.name LIKE ? OR cu.email LIKE ? OR cu.phone LIKE ?
        GROUP BY cu.id, cu.merchant_id, cu.name, cu.email, cu.phone, m.business_name
        ORDER BY cu.created_at DESC
        LIMIT 300`,
      [like, like, like]
    );

    // Union-find over the result set: two rows are the same person if they
    // share a normalised email OR a normalised phone.
    //
    // Transitive on purpose. A row with (email X, no phone) at café A and a
    // row with (email X, phone Y) at café B link on the email; a third row
    // with (phone Y, no email) at café C then joins them both. Matching on a
    // single field would leave that person looking like two people.
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r) ?? r;
      return r;
    };
    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };
    const keyOf = (r: IdentityRow): string[] => {
      const keys: string[] = [`row:${r.customer_id}`];
      if (r.email) keys.push(`e:${normaliseEmail(r.email)}`);
      if (r.phone) keys.push(`p:${normalisePhone(r.phone)}`);
      return keys;
    };
    for (const r of rows) {
      for (const k of keyOf(r)) if (!parent.has(k)) parent.set(k, k);
      const [rowKey, ...ids] = keyOf(r);
      for (const id of ids) union(rowKey, id);
    }

    const grouped = new Map<string, IdentityRow[]>();
    for (const r of rows) {
      const root = find(`row:${r.customer_id}`);
      const list = grouped.get(root) ?? [];
      list.push(r);
      grouped.set(root, list);
    }

    // ⚠️ Blocked state comes from `customer_blocks`, NOT from card status.
    //
    // Counting blocked cards looked right and was wrong: a customer with no
    // cards can still be blocked — blocking writes a block row and updates
    // whatever cards exist, which may be none — and the panel would then show
    // a blocked person as fine. Card status is a side effect of blocking; the
    // block list is the authority.
    const allHashes: string[] = [];
    for (const group of grouped.values()) {
      for (const r of group) {
        if (r.email) allHashes.push(hashIdentifier(normaliseEmail(r.email)));
        if (r.phone) allHashes.push(hashIdentifier(normalisePhone(r.phone)));
      }
    }
    const blockedMerchants = new Set<string>();
    let anyPlatformBlock = new Set<string>();
    if (allHashes.length > 0) {
      const ph = allHashes.map(() => "?").join(",");
      const [blockRows] = await pool.execute<BlockScopeRow[]>(
        `SELECT merchant_id, email_hash, phone_hash
           FROM customer_blocks
          WHERE email_hash IN (${ph}) OR phone_hash IN (${ph})`,
        [...allHashes, ...allHashes]
      );
      for (const b of blockRows) {
        if (b.merchant_id === null) {
          // Platform-wide: keyed by hash so it can be matched per identity.
          if (b.email_hash) anyPlatformBlock.add(b.email_hash);
          if (b.phone_hash) anyPlatformBlock.add(b.phone_hash);
        } else {
          blockedMerchants.add(b.merchant_id);
        }
      }
    }

    const identities: CustomerIdentity[] = [];
    for (const group of grouped.values()) {
      const first = group[0];
      const groupHashes = group.flatMap((r) => [
        ...(r.email ? [hashIdentifier(normaliseEmail(r.email))] : []),
        ...(r.phone ? [hashIdentifier(normalisePhone(r.phone))] : []),
      ]);
      const blockedEverywhere = groupHashes.some((h) => anyPlatformBlock.has(h));
      identities.push({
        blockedEverywhere,
        // No stable cross-café id exists — there is no master row — so the
        // first customer id doubles as the group's handle for the UI.
        key: first.customer_id,
        name: group.find((g) => g.name)?.name ?? null,
        email: group.find((g) => g.email)?.email ?? null,
        phone: group.find((g) => g.phone)?.phone ?? null,
        cafes: group.map((g) => ({
          customerId: g.customer_id,
          merchantId: g.merchant_id,
          businessName: g.business_name,
          activeCards: Number(g.active_cards ?? 0),
          /** From the block list, so it is true even with no cards. */
          blocked: blockedMerchants.has(g.merchant_id) || blockedEverywhere,
        })),
      });
    }
    // Most-connected first: someone holding cards at four cafés is the
    // interesting row, and the reason this view exists.
    identities.sort((a, b) => b.cafes.length - a.cafes.length);

    return res.json({ identities, capped: rows.length === 300 });
  }
);
