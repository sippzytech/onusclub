/**
 * One-off repair: drag existing Google Wallet LoyaltyClasses onto the current
 * logo.
 *
 * Why this exists. `ensureLoyaltyClass()` used to GET the class and return
 * early on 200 — it never PATCHed. So every class kept whatever logo was
 * current on the day it was created, forever, with nothing in the logs to say
 * so. Classes created before the `placehold.co` fallback was replaced with the
 * real OnUsClub badge are still pointing at placehold.co, and a Google
 * reviewer assessing the issuer for production sees those placeholder
 * graphics.
 *
 * `ensureLoyaltyClass()` now self-heals on the next stamp, but only for
 * merchants who are actually being stamped. Dormant merchants would stay
 * broken indefinitely. This sweeps all of them in one pass.
 *
 * Deliberately surgical: it PATCHes **only** `programLogo`. A LoyaltyClass
 * also carries `programName` and the reward text, both taken from whichever
 * program happened to create it — and a merchant can have several. Rebuilding
 * the whole class here would mean picking a program arbitrarily and silently
 * changing what customers see on their pass. Not worth it to fix a logo.
 *
 * Run (prod, compiled):
 *   docker compose -f docker-compose.prod.yml exec api \
 *     node dist/scripts/resync-wallet-class-logos.js --dry-run
 *   docker compose -f docker-compose.prod.yml exec api \
 *     node dist/scripts/resync-wallet-class-logos.js
 *
 * Idempotent, and safe to re-run: classes already on the right logo are
 * skipped without a write.
 */
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { walletEnabled, walletRequest } from "../wallet/client.js";
import { classId, logoUriFor, programLogoFor } from "../wallet/state.js";

const DRY_RUN = process.argv.includes("--dry-run");

interface MerchantRow extends RowDataPacket {
  id: string;
  business_name: string;
  brand_color: string | null;
  logo_url: string | null;
}

async function run(): Promise<void> {
  if (!(await walletEnabled())) {
    logger.error("google wallet is not configured on this environment — nothing to do");
    process.exit(1);
  }

  // Driven from our own merchants table rather than by listing the issuer.
  // Classes upstream that no longer map to a merchant are orphans from old
  // testing; repairing their logo would be pointless. They should be deleted
  // in the console instead.
  const [merchants] = await pool.execute<MerchantRow[]>(
    `SELECT id, business_name, brand_color, logo_url
       FROM merchants
      WHERE google_wallet_class_id IS NOT NULL
      ORDER BY created_at`
  );

  let checked = 0;
  let patched = 0;
  let alreadyCorrect = 0;
  let missing = 0;
  let failed = 0;

  for (const m of merchants) {
    checked += 1;
    const branding = {
      id: m.id,
      businessName: m.business_name,
      brandColor: m.brand_color,
      logoUrl: m.logo_url,
    };
    const id = classId(m.id);
    const want = logoUriFor(branding);

    const get = await walletRequest({ method: "GET", path: `/loyaltyClass/${id}` });
    if (!get || get.status === 404) {
      // The DB thinks there is a class but Google disagrees. Left alone on
      // purpose: ensureLoyaltyClass will recreate it on the next stamp, and
      // creating one here from an arbitrary program would set the wrong
      // programName.
      missing += 1;
      logger.warn({ merchantId: m.id, classId: id }, "class not found upstream — skipping");
      continue;
    }
    if (get.status >= 300) {
      failed += 1;
      logger.error({ merchantId: m.id, status: get.status }, "GET class failed");
      continue;
    }

    const remote = (get.data ?? {}) as {
      programLogo?: { sourceUri?: { uri?: string } };
    };
    const current = remote.programLogo?.sourceUri?.uri;

    if (current === want) {
      alreadyCorrect += 1;
      continue;
    }

    logger.info(
      { merchantId: m.id, businessName: m.business_name, from: current ?? "(none)", to: want },
      DRY_RUN ? "would patch logo" : "patching logo"
    );
    if (DRY_RUN) {
      patched += 1;
      continue;
    }

    const res = await walletRequest({
      method: "PATCH",
      path: `/loyaltyClass/${id}`,
      body: { programLogo: programLogoFor(branding) },
    });
    if (!res || res.status >= 300) {
      failed += 1;
      logger.error(
        { merchantId: m.id, status: res?.status, data: res?.data },
        "PATCH logo failed"
      );
      continue;
    }
    patched += 1;
  }

  logger.info(
    { checked, patched, alreadyCorrect, missing, failed, dryRun: DRY_RUN },
    "wallet class logo resync done"
  );
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    logger.error({ err }, "resync failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
