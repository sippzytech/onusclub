"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import type { ScanResult } from "@onusclub/shared";

const SAME_TOKEN_COOLDOWN_MS = 30_000;

// State machine: idle → starting → scanning → detecting → (result | awaiting_amount | warning | error)
type Status =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "detecting"; token: string }
  | { kind: "result"; result: LastResult }
  | { kind: "awaiting_amount"; card: PointsCardScan; token: string; busy: boolean; err: string | null }
  | { kind: "warning"; message: string; token: string }
  | { kind: "error"; message: string };

interface LastResult {
  customerName: string | null;
  programName: string;
  rewardText: string;
  // Unified display fields — populated from either stamps or points based on
  // appliedAction. For 'add-points' we show "+N points (€X transaction)" etc.
  appliedAction: "stamp" | "redeem" | "add-points";
  current: number;
  target: number;
  unit: "stamps" | "points";
  pointsAdded?: number;       // only for add-points
  amountCharged?: number;     // only for add-points
  token: string;
  // Day 15 revenue capture. The event that was just written, so staff can
  // optionally attach what the customer spent — after the fact, because the
  // stamp itself must not wait on anyone typing.
  cardId: string;
  eventId: number | null;
  // Non-null when the amount is already known (points transactions derive it
  // from the bill the merchant typed), which suppresses the prompt.
  amountCents: number | null;
}

// Lifecycle of the optional "what did they spend?" box on the success card.
type SaleState = "idle" | "saving" | "saved";

interface PointsCardScan {
  cardId: string;
  customerName: string | null;
  programName: string;
  rewardText: string;
  currentBalance: number;
  pointsForReward: number;
  pointsPerEuro: number;
  eligibleToRedeem: boolean;
}

export function ScanClient(): JSX.Element {
  const containerId = "onusclub-qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastSubmittedAt = useRef<number>(0);
  const lastSubmittedToken = useRef<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [running, setRunning] = useState(false);
  const [amount, setAmount] = useState<string>("");
  // Separate from `amount` (which drives the points card's pre-scan prompt):
  // this one is the post-stamp sale box, and the two are never on screen at
  // the same time but do need independent lifetimes.
  const [saleAmount, setSaleAmount] = useState<string>("");
  const [saleState, setSaleState] = useState<SaleState>("idle");
  const [saleErr, setSaleErr] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      const inst = scannerRef.current;
      if (!inst) return;
      void teardown(inst);
    };
  }, []);

  async function teardown(inst: Html5Qrcode): Promise<void> {
    try {
      const state = inst.getState();
      if (state === 2 || state === 3) {
        await inst.stop().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
    try {
      inst.clear();
    } catch {
      /* ignore */
    }
  }

  async function start(): Promise<void> {
    setStatus({ kind: "starting" });
    try {
      const mod = await import("html5-qrcode");
      if (!scannerRef.current) {
        scannerRef.current = new mod.Html5Qrcode(containerId);
      }
      const inst = scannerRef.current;
      // Pick a square qrbox size that fits the viewport. The library's
      // overlay otherwise stretches to a rectangle on portrait mobile
      // viewports (looks like a barcode scanner). Single number = guaranteed
      // square per html5-qrcode's docs. We compute it once before start()
      // based on the actual rendered camera container width, so on small
      // phones it stays inside the visible area and on laptops it's big
      // enough to be useful.
      const container = document.getElementById(containerId);
      const containerWidth = container?.clientWidth ?? 320;
      const qrboxSize = Math.min(
        Math.max(Math.floor(containerWidth * 0.7), 180),
        320
      );

      await inst.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: qrboxSize,
        },
        (decoded) => void onDecoded(decoded),
        () => {
          /* silent per-frame failure */
        }
      );
      setRunning(true);
      setStatus({ kind: "scanning" });
    } catch (err) {
      setRunning(false);
      setStatus({ kind: "error", message: (err as Error).message ?? "Camera failed to start" });
    }
  }

  async function stop(): Promise<void> {
    const inst = scannerRef.current;
    if (inst) {
      try {
        const state = inst.getState();
        if (state === 2 || state === 3) {
          await inst.stop();
        }
      } catch {
        /* ignore */
      }
    }
    setRunning(false);
    setStatus({ kind: "idle" });
  }

  async function onDecoded(qrToken: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(qrToken)) return;
    const now = Date.now();
    if (
      qrToken === lastSubmittedToken.current &&
      now - lastSubmittedAt.current < SAME_TOKEN_COOLDOWN_MS
    ) {
      return;
    }
    lastSubmittedToken.current = qrToken;
    lastSubmittedAt.current = now;

    setStatus({ kind: "detecting", token: qrToken });
    await submitScan(qrToken, { action: "auto" });
  }

  /**
   * Single network call helper. Used both for the initial auto-dispatch and
   * for the follow-up calls after the merchant types an amount or hits
   * "Redeem reward" on a points card.
   */
  async function submitScan(
    qrToken: string,
    body: { action: "auto" | "stamp" | "redeem" | "add-points"; amount?: number }
  ): Promise<void> {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrToken, ...body }),
    });

    if (res.status === 409) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({
        kind: "warning",
        message: b.error ?? "Already stamped today. Try again tomorrow.",
        token: qrToken,
      });
      return;
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: "error", message: b.error ?? "Scan failed" });
      return;
    }

    const data = (await res.json()) as ScanResult;

    if (data.status === "needs_amount") {
      // Points card scanned with action='auto' — UI must collect the bill
      // amount (or the merchant can immediately redeem if eligible).
      setAmount("");
      setStatus({
        kind: "awaiting_amount",
        token: qrToken,
        busy: false,
        err: null,
        card: {
          cardId: data.cardId,
          customerName: data.customerName,
          programName: data.programName,
          rewardText: data.rewardText,
          currentBalance: data.currentBalance,
          pointsForReward: data.pointsForReward,
          pointsPerEuro: data.pointsPerEuro,
          eligibleToRedeem: data.eligibleToRedeem,
        },
      });
      return;
    }

    // status === "applied" — render success card
    const detail = data.detail;
    const isPoints = detail.card.programType === "points";
    const rawState = detail.card.cardState as Record<string, number | undefined>;
    const current = isPoints
      ? rawState.points_current ?? 0
      : rawState.stamps_current ?? 0;
    const target = isPoints
      ? detail.card.pointsForReward ?? 0
      : detail.card.stampsRequired;

    // For add-points we want to display how many points were just added and
    // the bill amount. Both are in the most recent points_add event.
    let pointsAdded: number | undefined;
    let amountCharged: number | undefined;
    if (data.appliedAction === "add-points") {
      const latest = detail.events.find((e) => e.eventType === "points_add");
      const d = latest?.deltaJson as
        | { points_earned?: number; amount_euros?: number }
        | undefined;
      pointsAdded = d?.points_earned;
      amountCharged = d?.amount_euros;
    }

    // events come back newest-first, so [0] is the one this scan just wrote.
    const latestEvent = detail.events[0];

    setSaleAmount("");
    setSaleState("idle");
    setSaleErr(null);
    setStatus({
      kind: "result",
      result: {
        customerName: detail.card.customerName,
        programName: detail.card.programName,
        rewardText: detail.card.rewardText,
        appliedAction: data.appliedAction,
        current,
        target,
        unit: isPoints ? "points" : "stamps",
        pointsAdded,
        amountCharged,
        token: qrToken,
        cardId: detail.card.id,
        eventId: latestEvent?.id ?? null,
        amountCents: latestEvent?.amountCents ?? null,
      },
    });
  }

  /**
   * Attach the sale amount to the event this scan just created. Deliberately
   * a separate round-trip from the stamp: the stamp has already succeeded and
   * is not rolled back if this fails, so the worst case is a visit recorded
   * without revenue — exactly what skipping the box does anyway.
   */
  async function onSaleAmountSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status.kind !== "result" || status.result.eventId === null) return;
    const num = Number(saleAmount);
    if (!num || num <= 0) {
      setSaleErr("Enter a positive amount in euros");
      return;
    }
    setSaleState("saving");
    setSaleErr(null);
    const res = await fetch(
      `/api/cards/${status.result.cardId}/events/${status.result.eventId}/amount`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: num }),
      }
    );
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setSaleState("idle");
      setSaleErr(b.error ?? "Could not save the amount");
      return;
    }
    setSaleState("saved");
  }

  async function onAmountSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status.kind !== "awaiting_amount") return;
    const num = Number(amount);
    if (!num || num <= 0) {
      setStatus({ ...status, err: "Enter a positive amount in euros" });
      return;
    }
    setStatus({ ...status, busy: true, err: null });
    await submitScan(status.token, { action: "add-points", amount: num });
  }

  async function onRedeemClick(): Promise<void> {
    if (status.kind !== "awaiting_amount") return;
    setStatus({ ...status, busy: true, err: null });
    await submitScan(status.token, { action: "redeem" });
  }

  function clearResult(): void {
    setStatus(running ? { kind: "scanning" } : { kind: "idle" });
    setAmount("");
    setSaleAmount("");
    setSaleState("idle");
    setSaleErr(null);
  }

  const cameraVisible = running || status.kind === "starting";
  // Static border color per state — no pulsing/fading animation. The state
  // change itself is the feedback; an animated frame on top of a live camera
  // feed reads as visual noise.
  let frameClass = "border-brand-green/20";
  if (status.kind === "scanning") frameClass = "border-brand-gold";
  if (status.kind === "detecting") frameClass = "border-brand-gold-light";
  if (status.kind === "awaiting_amount") frameClass = "border-brand-gold";
  if (status.kind === "result") frameClass = "border-emerald-500";
  if (status.kind === "warning") frameClass = "border-amber-500";
  if (status.kind === "error") frameClass = "border-red-500";

  // Live preview of points-from-amount on the awaiting_amount form.
  const previewPoints =
    status.kind === "awaiting_amount" && Number(amount) > 0
      ? Math.floor(Number(amount) * status.card.pointsPerEuro)
      : null;

  return (
    <div className="space-y-4">
      {/* Dark-green camera panel matching mock 3 */}
      <div className="rounded-card bg-brand-green text-white p-6">
        <p className="text-xs uppercase tracking-wider text-white/60">
          Staff mode
        </p>
        <div
          className={
            "mt-4 rounded-xl border-2 p-1 transition-colors " + frameClass
          }
        >
          <div
            id={containerId}
            className={
              "w-full aspect-square max-w-md mx-auto bg-brand-green-deepest rounded-lg overflow-hidden " +
              (cameraVisible ? "" : "flex items-center justify-center")
            }
          >
            {!cameraVisible ? (
              <p className="text-sm text-white/60 px-4 text-center">
                Press <span className="font-medium text-white">Start camera</span> to
                scan a customer&apos;s loyalty pass.
              </p>
            ) : null}
          </div>
        </div>
        <p className="text-center text-white/70 text-sm mt-4">
          Hold their wallet card to the camera, or have them tap to display the QR.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
          {!running ? (
            <button
              onClick={() => void start()}
              disabled={status.kind === "starting"}
              className="rounded-full bg-brand-gold px-5 py-2 text-sm font-medium text-brand-green hover:bg-brand-gold-light disabled:opacity-50 transition-colors"
            >
              {status.kind === "starting" ? "Starting…" : "Start camera"}
            </button>
          ) : (
            <button
              onClick={() => void stop()}
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-medium text-white hover:bg-white/5 transition-colors"
            >
              Stop
            </button>
          )}
          {status.kind === "scanning" ? (
            <span className="inline-flex items-center gap-2 text-xs text-brand-gold-light">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-gold animate-pulse" />
              Ready
            </span>
          ) : null}
          {status.kind === "detecting" ? (
            <span className="inline-flex items-center gap-2 text-xs text-brand-gold-light">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-gold animate-pulse" />
              Reading…
            </span>
          ) : null}
        </div>
      </div>

      {/* Points card needs the merchant to enter the bill amount */}
      {status.kind === "awaiting_amount" ? (
        <div className="rounded-card border border-brand-gold/40 bg-brand-cream p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-gold font-medium">
                Points card
              </p>
              <p className="font-serif text-xl text-brand-green mt-1">
                {status.card.customerName ?? "(no name)"} · {status.card.programName}
              </p>
              <p className="text-sm text-brand-olive mt-1 tabular-nums">
                Balance: <strong className="text-brand-green">{status.card.currentBalance}</strong> /{" "}
                {status.card.pointsForReward} points · {status.card.pointsPerEuro} pt per €1 ·
                reward: <strong className="text-brand-green">{status.card.rewardText}</strong>
              </p>
            </div>
            <button
              onClick={clearResult}
              className="text-xs underline text-brand-olive hover:text-brand-green shrink-0"
            >
              Cancel
            </button>
          </div>
          <form onSubmit={(e) => void onAmountSubmit(e)} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-green">
                Transaction amount (€)
              </label>
              <input
                type="number"
                step="0.01"
                min={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25.00"
                autoFocus
                className="mt-1 block w-40 rounded-lg border border-brand-green/10 bg-white px-3 py-2 text-sm tabular-nums text-brand-green focus:outline-none focus:border-brand-green/30"
              />
            </div>
            <button
              type="submit"
              disabled={status.busy || !amount}
              className="rounded-full bg-brand-green px-5 py-2 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
            >
              {status.busy ? "Adding…" : "Add transaction"}
            </button>
            {previewPoints !== null ? (
              <span className="text-xs text-brand-olive">
                = <span className="font-medium text-brand-green">{previewPoints}</span> points
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void onRedeemClick()}
              disabled={status.busy || !status.card.eligibleToRedeem}
              title={
                status.card.eligibleToRedeem
                  ? "Customer has enough points to redeem"
                  : `Need ${status.card.pointsForReward - status.card.currentBalance} more points`
              }
              className="rounded-full bg-brand-gold px-5 py-2 text-sm font-medium text-brand-green hover:bg-brand-gold-light disabled:opacity-40 ml-auto transition-colors"
            >
              {status.busy ? "…" : "Redeem reward"}
            </button>
          </form>
          {status.err ? (
            <p className="text-xs text-red-700">{status.err}</p>
          ) : null}
        </div>
      ) : null}

      {status.kind === "warning" ? (
        <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Already stamped today</p>
            <p className="mt-1 text-amber-800">{status.message}</p>
          </div>
          <button
            onClick={clearResult}
            className="text-xs underline text-amber-900 hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {status.kind === "error" ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start justify-between gap-3">
          <span>{status.message}</span>
          <button
            onClick={clearResult}
            className="text-xs underline text-red-900 hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {status.kind === "result" ? (
        <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-700 font-medium">
              {status.result.appliedAction === "redeem"
                ? "Reward redeemed"
                : status.result.appliedAction === "add-points"
                ? `+${status.result.pointsAdded ?? "?"} points${
                    status.result.amountCharged !== undefined
                      ? ` (€${status.result.amountCharged.toFixed(2)})`
                      : ""
                  }`
                : "+1 stamp"}
            </p>
            <p className="font-serif text-xl text-emerald-900 mt-1">
              {status.result.customerName ?? "(no name)"} ·{" "}
              {status.result.programName}
            </p>
            <p className="text-sm text-emerald-800 mt-2 tabular-nums">
              {status.result.appliedAction === "redeem" ? (
                <>
                  Reward unlocked: <strong>{status.result.rewardText}</strong>.{" "}
                  Now at {status.result.current} / {status.result.target}{" "}
                  {status.result.unit}.
                </>
              ) : (
                <>
                  Now at {status.result.current} / {status.result.target}{" "}
                  {status.result.unit} ·{" "}
                  {Math.max(0, status.result.target - status.result.current)}{" "}
                  to go
                </>
              )}
            </p>
          </div>
          <button
            onClick={clearResult}
            className="text-xs underline text-emerald-900 hover:no-underline"
          >
            Dismiss
          </button>
        </div>

        {/* Optional sale amount. Shown only when this event does not already
          * carry one — points transactions get theirs from the bill the
          * merchant typed before the scan applied. Skipping is a non-action:
          * scan the next customer and this disappears. */}
        {status.result.eventId !== null && status.result.amountCents === null ? (
          <div className="border-t border-emerald-200 pt-3">
            {saleState === "saved" ? (
              <p className="text-xs text-emerald-800">
                Sale amount saved — it will show up in this week&apos;s revenue.
              </p>
            ) : (
              <form
                onSubmit={(e) => void onSaleAmountSubmit(e)}
                className="flex flex-wrap items-end gap-3"
              >
                <div>
                  <label className="block text-xs font-medium text-emerald-900">
                    Sale amount (€){" "}
                    <span className="font-normal text-emerald-700">
                      — optional, skip to carry on
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    value={saleAmount}
                    onChange={(e) => setSaleAmount(e.target.value)}
                    placeholder="12.50"
                    className="mt-1 block w-36 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm tabular-nums text-emerald-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saleState === "saving" || !saleAmount}
                  className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                >
                  {saleState === "saving" ? "Saving…" : "Save amount"}
                </button>
                {saleErr ? (
                  <span className="text-xs text-red-700">{saleErr}</span>
                ) : null}
              </form>
            )}
          </div>
        ) : null}
        </div>
      ) : null}

      <p className="text-xs text-brand-olive">
        Stamp cards: one stamp per day per card (anti double-scan). The sale
        amount afterwards is optional — enter it and the dashboard can show
        revenue and average sale. Points cards: enter the bill amount when
        prompted, since it sets how many points are earned.
      </p>
    </div>
  );
}
