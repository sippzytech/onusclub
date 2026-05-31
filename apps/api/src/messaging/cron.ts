import cron from "node-cron";
import { logger } from "../logger.js";
import { runBirthdaySweep, runInactivitySweep } from "./operations.js";

const TZ = "Europe/Amsterdam";

let started = false;

/**
 * Register the daily cron jobs. Called once at api startup. Safe to call more
 * than once — re-registration would create duplicates so we guard.
 */
export function startMessagingCrons(): void {
  if (started) return;
  started = true;

  // Birthday sweep at 08:00 Europe/Amsterdam.
  cron.schedule(
    "0 8 * * *",
    () => {
      runBirthdaySweep().catch((err: unknown) => {
        logger.error({ err }, "scheduled birthday sweep crashed");
      });
    },
    { timezone: TZ }
  );

  // Inactivity sweep at 10:00 Europe/Amsterdam.
  cron.schedule(
    "0 10 * * *",
    () => {
      runInactivitySweep().catch((err: unknown) => {
        logger.error({ err }, "scheduled inactivity sweep crashed");
      });
    },
    { timezone: TZ }
  );

  logger.info({ tz: TZ }, "messaging crons registered (08:00 birthday, 10:00 inactivity)");
}
