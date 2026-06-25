"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ProgramType = "stamp" | "points";

export function CreateProgramForm(): JSX.Element {
  const router = useRouter();
  const [programType, setProgramType] = useState<ProgramType>("stamp");
  const [name, setName] = useState("");
  const [stampsRequired, setStampsRequired] = useState(6);
  const [rewardText, setRewardText] = useState("");
  const [expiryDays, setExpiryDays] = useState<string>("");
  // Points-only fields.
  const [pointsPerEuro, setPointsPerEuro] = useState<string>("1");
  const [pointsForReward, setPointsForReward] = useState<string>("100");
  const [batchExpiryDays, setBatchExpiryDays] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    let body: Record<string, unknown>;
    if (programType === "points") {
      const pointsPerEuroNum = Number(pointsPerEuro);
      const pointsForRewardNum = Number(pointsForReward);
      const batchExpiryNum =
        batchExpiryDays.trim() === "" ? undefined : Number(batchExpiryDays);
      body = {
        programType: "points",
        name,
        rewardText,
        pointsPerEuro: pointsPerEuroNum,
        pointsForReward: pointsForRewardNum,
        ...(batchExpiryNum !== undefined && !Number.isNaN(batchExpiryNum)
          ? { batchExpiryDays: batchExpiryNum }
          : {}),
      };
    } else {
      const parsedExpiry = expiryDays.trim() === "" ? undefined : Number(expiryDays);
      body = {
        programType: "stamp",
        name,
        stampsRequired,
        rewardText,
        ...(parsedExpiry !== undefined && !Number.isNaN(parsedExpiry)
          ? { expiryDays: parsedExpiry }
          : {}),
      };
    }
    const res = await fetch("/api/programs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errBody.error ?? "could not create program");
      return;
    }
    // Reset to a sensible default for the next entry.
    setName("");
    setStampsRequired(6);
    setRewardText("");
    setExpiryDays("");
    setPointsPerEuro("1");
    setPointsForReward("100");
    setBatchExpiryDays("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      {/* Program type selector */}
      <div>
        <label className="block text-sm font-medium text-gray-800">Program type</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["stamp", "points"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setProgramType(t)}
              className={
                "rounded-md border px-3 py-2 text-sm font-medium transition " +
                (programType === t
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 bg-white text-gray-800 hover:border-gray-500")
              }
            >
              {t === "stamp" ? "Stamps" : "Points"}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {programType === "stamp"
            ? "Customer earns 1 stamp per visit. Reward at the stamp threshold."
            : "Customer earns points per €1 spent. Reward at the points threshold."}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-800">Program name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder={programType === "stamp" ? "Coffee stamp card" : "Brunch points"}
        />
      </div>

      {programType === "stamp" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-800">Stamps required</label>
            <input
              required
              type="number"
              min={1}
              max={100}
              value={stampsRequired}
              onChange={(e) => setStampsRequired(parseInt(e.target.value, 10))}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800">Expiry (optional)</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="days of inactivity"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank for cards that never expire.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800">Points per €1</label>
              <input
                required
                type="number"
                step="0.01"
                min={0.01}
                max={1000}
                value={pointsPerEuro}
                onChange={(e) => setPointsPerEuro(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                e.g. 1 = each €1 earns 1 point. 10 = each €1 earns 10 points.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Points for reward
              </label>
              <input
                required
                type="number"
                min={1}
                max={1_000_000}
                value={pointsForReward}
                onChange={(e) => setPointsForReward(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="100"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800">
              Points expire after (optional)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={batchExpiryDays}
              onChange={(e) => setBatchExpiryDays(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="days from when each batch was earned"
            />
            <p className="mt-1 text-xs text-gray-500">
              Each batch of points expires this many days after the transaction.
              Leave blank for points that never expire.
            </p>
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-800">Reward</label>
        <input
          required
          value={rewardText}
          onChange={(e) => setRewardText(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="A free coffee"
        />
      </div>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create program"}
      </button>
    </form>
  );
}
