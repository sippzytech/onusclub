"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import type { ScanResult } from "@onusclub/shared";

const SAME_TOKEN_COOLDOWN_MS = 30_000;

type Status =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "detecting"; token: string }
  | { kind: "result"; result: LastResult }
  | { kind: "warning"; message: string; token: string }
  | { kind: "error"; message: string };

interface LastResult {
  customerName: string | null;
  programName: string;
  appliedAction: "stamp" | "redeem";
  stampsCurrent: number;
  stampsRequired: number;
  rewardText: string;
  token: string;
}

export function ScanClient(): JSX.Element {
  const containerId = "stampdeck-qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastSubmittedAt = useRef<number>(0);
  const lastSubmittedToken = useRef<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [running, setRunning] = useState(false);

  useEffect(() => {
    return () => {
      const inst = scannerRef.current;
      if (!inst) return;
      // html5-qrcode states: 1=NOT_STARTED, 2=SCANNING, 3=PAUSED.
      // Calling stop() on a NOT_STARTED scanner throws AND console.errors,
      // which Next.js turns into a full-page "Application error" overlay.
      void teardown(inst);
    };
  }, []);

  async function teardown(inst: Html5Qrcode): Promise<void> {
    try {
      const state = inst.getState();
      // 2 = SCANNING, 3 = PAUSED. Only these two states accept stop().
      if (state === 2 || state === 3) {
        await inst.stop().catch(() => undefined);
      }
    } catch {
      // getState() shouldn't throw, but be defensive.
    }
    try {
      inst.clear();
    } catch {
      // ignore
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
      await inst.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
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
    if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
      // ignore non-Stampdeck QR codes silently — keeps the camera scanning.
      return;
    }
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

    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrToken, action: "auto" }),
    });

    if (res.status === 409) {
      // Server enforces "once per day per card" via the scan path. Show a
      // friendly amber notice — not a red error.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({
        kind: "warning",
        message: body.error ?? "Already stamped today. Try again tomorrow.",
        token: qrToken,
      });
      return;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: "error", message: body.error ?? "Scan failed" });
      return;
    }

    const data = (await res.json()) as ScanResult;
    const state = data.detail.card.cardState as { stamps_current: number };
    setStatus({
      kind: "result",
      result: {
        customerName: data.detail.card.customerName,
        programName: data.detail.card.programName,
        appliedAction: data.appliedAction,
        stampsCurrent: state.stamps_current,
        stampsRequired: data.detail.card.stampsRequired,
        rewardText: data.detail.card.rewardText,
        token: qrToken,
      },
    });
  }

  function clearResult(): void {
    setStatus(running ? { kind: "scanning" } : { kind: "idle" });
  }

  const cameraVisible = running || status.kind === "starting";
  // Frame styling driven by state.
  let frameClass = "border-gray-300";
  if (status.kind === "scanning")
    frameClass = "border-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.15)] animate-pulse";
  if (status.kind === "detecting") frameClass = "border-amber-500";
  if (status.kind === "result")
    frameClass =
      status.result.appliedAction === "redeem"
        ? "border-emerald-500"
        : "border-emerald-400";
  if (status.kind === "warning") frameClass = "border-amber-500";
  if (status.kind === "error") frameClass = "border-red-500";

  return (
    <div className="space-y-4">
      <div className={"rounded-xl border-2 p-1 transition-colors " + frameClass}>
        <div
          id={containerId}
          className={
            "w-full aspect-square max-w-md mx-auto bg-black rounded-lg overflow-hidden " +
            (cameraVisible ? "" : "flex items-center justify-center")
          }
        >
          {!cameraVisible ? (
            <p className="text-sm text-gray-300 px-4 text-center">
              Press <span className="font-medium">Start camera</span> to scan a
              customer&apos;s loyalty pass.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {!running ? (
          <button
            onClick={() => void start()}
            disabled={status.kind === "starting"}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {status.kind === "starting" ? "Starting…" : "Start camera"}
          </button>
        ) : (
          <button
            onClick={() => void stop()}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Stop
          </button>
        )}

        {status.kind === "scanning" ? (
          <span className="inline-flex items-center gap-2 text-sm text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
            Ready — point at a customer&apos;s pass QR
          </span>
        ) : null}
        {status.kind === "detecting" ? (
          <span className="inline-flex items-center gap-2 text-sm text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Recording stamp…
          </span>
        ) : null}
      </div>

      {status.kind === "warning" ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start justify-between gap-3">
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
        <div
          className={
            "rounded-md border p-4 flex items-start justify-between gap-3 " +
            (status.result.appliedAction === "redeem"
              ? "border-emerald-200 bg-emerald-50"
              : "border-emerald-200 bg-emerald-50")
          }
        >
          <div>
            <p className="text-xs uppercase tracking-wide text-emerald-700 font-medium">
              {status.result.appliedAction === "redeem"
                ? "Reward redeemed"
                : "+1 stamp"}
            </p>
            <p className="text-lg font-medium text-emerald-900 mt-1">
              {status.result.customerName ?? "(no name)"} ·{" "}
              {status.result.programName}
            </p>
            <p className="text-sm text-emerald-800 mt-2">
              {status.result.appliedAction === "redeem" ? (
                <>
                  Reward unlocked: <strong>{status.result.rewardText}</strong>. Counter
                  back to 0.
                </>
              ) : (
                <>
                  Now at {status.result.stampsCurrent}/{status.result.stampsRequired} ·{" "}
                  {status.result.stampsRequired - status.result.stampsCurrent} to go
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
      ) : null}

      <p className="text-xs text-gray-500">
        Each pass can only be stamped once per day — a safety net so an
        accidental double-scan doesn&apos;t over-stamp.
      </p>
    </div>
  );
}
