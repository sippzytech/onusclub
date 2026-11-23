/**
 * The words a customer actually reads on their lock screen.
 *
 * WHY THIS IS SHARED AND PURE
 *
 * The same moment — a stamp being added — produces a notification on two
 * platforms through two completely different mechanisms: Google takes a
 * header/body pair via `addMessage`, Apple bakes a `changeMessage` string
 * into the pass at build time and substitutes `%@` itself. Written twice they
 * drift, and the drift is invisible to anyone not holding both phones.
 *
 * So the copy lives here, in one pure module with no imports, and each wallet
 * adapts it. Pure also means `pnpm check:messages` can assert every milestone
 * without a database, a wallet, or a phone.
 *
 * 🚨 THE RULE THAT MATTERS: `%@` IS APPLE'S, NOT OURS.
 *
 * Apple replaces `%@` in a changeMessage with the field's new value, and a
 * changeMessage WITHOUT `%@` is ignored — the customer then gets iOS's own
 * flat "pass updated" text, which is the complaint that produced this file.
 * `appleChangeMessage` therefore guarantees the token is present. Google must
 * never see it, so `googleMessage` renders the number inline instead.
 */

export interface PassCopy {
  header: string;
  body: string;
}

export interface ProgressCopyInput {
  businessName: string;
  /** Balance AFTER the event. */
  current: number;
  /** Stamps needed, or points needed, for the reward. */
  total: number;
  unitLabel: "stamps" | "points";
  rewardText: string;
}

/**
 * Small rotating set so a regular who visits twice a week is not read the
 * identical sentence every time.
 *
 * Keyed on the balance, NOT on random: the same event must produce the same
 * words every time it is rendered. A pass can be rebuilt several times for
 * one stamp — an APNs retry, a device re-registering, a second device — and
 * text that changed between those renders would look like two separate
 * events to the customer.
 */
const MID_PROGRESS: ReadonlyArray<(n: string, biz: string) => PassCopy> = [
  (n, biz) => ({ header: `☕ Stamp added at ${biz}`, body: `${n} — nice one.` }),
  (n, biz) => ({ header: `✨ That's another at ${biz}`, body: `${n} — keep them coming.` }),
  (n, biz) => ({ header: `👏 Stamp collected at ${biz}`, body: `${n} — well on your way.` }),
];

/**
 * Copy for a balance-changing event, milestone-aware.
 *
 * `countText` is injected rather than built here so Apple can pass its `%@`
 * placeholder and Google can pass the real numbers.
 */
function progressCopy(input: ProgressCopyInput, countText: string): PassCopy {
  const { businessName, current, total, unitLabel, rewardText } = input;
  const isStamps = unitLabel === "stamps";
  const remaining = Math.max(0, total - current);

  // Reward reached. The only one that asks for an action.
  //
  // Uses countText like every other branch, so `appleChangeMessage` never has
  // to bolt the placeholder on afterwards.
  if (remaining === 0) {
    return {
      header: `🎉 Reward unlocked at ${businessName}`,
      body: `${countText} — ${rewardText}. Show this card to claim it.`,
    };
  }

  // One away. The single most motivating thing we can say, so it gets its
  // own case rather than being folded into the generic progress line.
  if (remaining === 1) {
    return {
      header: `🔥 One ${isStamps ? "stamp" : "point"} to go at ${businessName}`,
      body: `${countText} — your next visit earns ${rewardText}.`,
    };
  }

  // First one. A card with a single stamp on it needs to explain itself.
  if (current <= 1) {
    return {
      header: `✨ Your first ${isStamps ? "stamp" : "points"} at ${businessName}`,
      body: `${countText} — ${remaining} more and ${rewardText} is yours.`,
    };
  }

  if (!isStamps) {
    return {
      header: `⭐ Points added at ${businessName}`,
      body: `${countText} — ${remaining} to go for ${rewardText}.`,
    };
  }

  // Halfway deserves a mention; it is the point people give up at.
  if (current * 2 >= total) {
    return {
      header: `🙌 Over halfway at ${businessName}`,
      body: `${countText} — just ${remaining} to go.`,
    };
  }

  const pick = MID_PROGRESS[current % MID_PROGRESS.length];
  return pick
    ? pick(countText, businessName)
    : { header: `☕ Stamp added at ${businessName}`, body: `${countText} — nice one.` };
}

/** Header + body for Google's `addMessage`, with real numbers inline. */
export function googleProgressMessage(input: ProgressCopyInput): PassCopy {
  return progressCopy(input, `${input.current}/${input.total}`);
}

/**
 * Apple's `changeMessage` for the balance field.
 *
 * Returns ONE string, because that is all Apple takes, and it always contains
 * `%@` — Apple drops a changeMessage without it and falls back to its own
 * generic wording.
 */
export function appleChangeMessage(input: ProgressCopyInput): string {
  // `%@` becomes the field's new value, which is already formatted "4 / 6".
  const { header, body } = progressCopy(input, "%@");
  const line = `${header} — ${body}`;
  // Belt and braces: every branch of progressCopy uses countText, but a
  // future branch that forgot would silently regress to iOS's generic text
  // rather than failing. Appending is ugly; being ignored is worse.
  return line.includes("%@") ? line : `${line} (%@)`;
}

/** Welcome message, sent once when the card is created. */
export function signupMessage(input: {
  businessName: string;
  total: number;
  unitLabel: "stamps" | "points";
  rewardText: string;
}): PassCopy {
  const isStamps = input.unitLabel === "stamps";
  return {
    header: `👋 Welcome to ${input.businessName}`,
    body: isStamps
      ? `Collect ${input.total} stamps and get ${input.rewardText}.`
      : `Earn points on every purchase — ${input.total} gets you ${input.rewardText}.`,
  };
}

/** After a reward is claimed. */
export function redeemMessage(input: {
  businessName: string;
  unitLabel: "stamps" | "points";
  rewardText: string;
}): PassCopy {
  return {
    header: `✅ Enjoy your ${input.rewardText}`,
    body:
      input.unitLabel === "stamps"
        ? `Your card at ${input.businessName} is back to zero — start the next one.`
        : `Points deducted at ${input.businessName}. Keep earning.`,
  };
}
