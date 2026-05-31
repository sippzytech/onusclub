"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import type { ScanResult } from "@stampdeck/shared";

interface LastResult {
  customerName: string | null;
  programName: string;
  appliedAction: "stamp" | "redeem";
  stampsCurrent: number;
  stampsRequired: number;
  rewardText: string;
}

export function ScanClient(): JSX.Element {
  const containerId = "stampdeck-qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  // After a successful scan we cool down so a continuous frame stream doesn't
  // re-submit the same token a dozen times in a row.
  const lastSubmittedAt = useRef<number>(0);
  const lastSubmittedToken = useRef<string>("");

  useEffect(() => {
    return () => {
      // Best-effort cleanup if the user navigates away mid-scan.
      const inst = scannerRef.current;
      if (inst) {
        void inst.stop().catch(() => undefined);
        void inst.clear();
      }
    };
  }, []);

  async function start(): Promise<void> {
    setError(null);
    setStatus("Requesting camera…");
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
          // per-frame failure callback — silent.
        }
      );
      setRunning(true);
      setStatus("Camera active. Show the customer's pass.");
    } catch (err) {
      setRunning(false);
      setStatus(null);
      setError((err as Error).message ?? "Camera failed to start");
    }
  }

  async function stop(): Promise<void> {
    const inst = scannerRef.current;
    if (!inst) return;
    try {
      await inst.stop();
    } catch {
      // ignore
    }
    setRunning(false);
    setStatus(null);
  }

  async function onDecoded(qrToken: string): Promise<void> {
    // Stamp tokens are exactly 64 hex chars. Reject anything else upfront so
    // random QR codes from the wild don't generate noise.
    if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
      setError("That QR code isn't from a Stampdeck pass.");
      return;
    }
    const now = Date.now();
    if (qrToken === lastSubmittedToken.current && now - lastSubmittedAt.current < 4000) {
      // We just acted on this exact token a moment ago.
      return;
    }
    lastSubmittedToken.current = qrToken;
    lastSubmittedAt.current = now;

    setStatus("Recording…");
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrToken, action: "auto" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Scan failed");
      setStatus(null);
      return;
    }
    const data = (await res.json()) as ScanResult;
    const state = data.detail.card.cardState as {
      stamps_current: number;
    };
    setLastResult({
      customerName: data.detail.card.customerName,
      programName: data.detail.card.programName,
      appliedAction: data.appliedAction,
      stampsCurrent: state.stamps_current,
      stampsRequired: data.detail.card.stampsRequired,
      rewardText: data.detail.card.rewardText,
    });
    setError(null);
    setStatus("Ready for next scan.");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-black p-1">
        <div id={containerId} className="w-full aspect-square max-w-md mx-auto" />
      </div>

      <div className="flex gap-3">
        {!running ? (
          <button
            onClick={() => void start()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Start camera
          </button>
        ) : (
          <button
            onClick={() => void stop()}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Stop
          </button>
        )}
        {status ? <span className="text-sm text-gray-600 self-center">{status}</span> : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {lastResult ? (
        <div
          className={
            "rounded-md border p-4 " +
            (lastResult.appliedAction === "redeem"
              ? "border-emerald-200 bg-emerald-50"
              : "border-gray-200 bg-white")
          }
        >
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {lastResult.appliedAction === "redeem" ? "Reward redeemed" : "Stamp added"}
          </p>
          <p className="text-lg font-medium text-gray-900 mt-1">
            {lastResult.customerName ?? "(no name)"} · {lastResult.programName}
          </p>
          <p className="text-sm text-gray-700 mt-2">
            {lastResult.appliedAction === "redeem" ? (
              <>
                Customer claimed: <strong>{lastResult.rewardText}</strong>. Counter back to 0.
              </>
            ) : (
              <>
                Now at {lastResult.stampsCurrent}/{lastResult.stampsRequired} ·{" "}
                {lastResult.stampsRequired - lastResult.stampsCurrent} to go
              </>
            )}
          </p>
        </div>
      ) : null}

      <p className="text-xs text-gray-500">
        Camera access requires HTTPS in production. On localhost it works without HTTPS.
      </p>
    </div>
  );
}
