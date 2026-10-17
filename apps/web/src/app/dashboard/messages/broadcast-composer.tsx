"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  CampaignDraft,
  CampaignDraftResponse,
  DraftLanguage,
  Program,
  RfmSegment,
} from "@onusclub/shared";

export function BroadcastComposer({
  aiAvailable,
}: {
  /** False when the deployment has no Anthropic key — then no button is shown. */
  aiAvailable: boolean;
}): JSX.Element {
  const router = useRouter();
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "filtered">("all");
  const [minStamps, setMinStamps] = useState<string>("");
  const [withBirthdayThisMonth, setWithBirthdayThisMonth] = useState(false);
  const [programId, setProgramId] = useState<string>("");
  const [rfmSegment, setRfmSegment] = useState<string>("");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programsLoaded = useRef(false);

  // --- AI drafting -------------------------------------------------------
  const [occasion, setOccasion] = useState("");
  const [language, setLanguage] = useState<DraftLanguage>("nl");
  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  async function onDraft(): Promise<void> {
    setDrafting(true);
    setDraftError(null);
    const res = await fetch("/api/broadcast-drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // The segment and program the merchant has ALREADY chosen below, so
        // the copy is written for the audience that will receive it. Only sent
        // in filtered mode — in "all" mode there is no segment to write for.
        ...(filterMode === "filtered" && rfmSegment !== ""
          ? { rfmSegment: rfmSegment as RfmSegment }
          : {}),
        ...(filterMode === "filtered" && programId !== "" ? { programId } : {}),
        ...(occasion.trim() !== "" ? { occasion: occasion.trim() } : {}),
        language,
      }),
    });
    setDrafting(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setDraftError(errBody.error ?? "could not write a draft");
      return;
    }
    const data = (await res.json()) as CampaignDraftResponse;
    setDrafts(data.drafts);
    setDraftCount(data.audienceCount);
  }

  /**
   * Apply a draft. Sets the two inputs and nothing else — from here the
   * merchant is editing an ordinary form, with the same character counters
   * and the same Send button as if they had typed it themselves.
   */
  function useDraft(draft: CampaignDraft): void {
    setHeader(draft.header);
    setBody(draft.body);
  }

  // Lazy-load programs only when the filtered mode is opened.
  useEffect(() => {
    if (filterMode !== "filtered" || programsLoaded.current) return;
    programsLoaded.current = true;
    fetch("/api/programs-list")
      .then((r) => (r.ok ? r.json() : { programs: [] }))
      .then((data: { programs: Program[] }) => setPrograms(data.programs ?? []))
      .catch(() => undefined);
  }, [filterMode]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const audienceFilter =
      filterMode === "all"
        ? undefined
        : {
            ...(minStamps.trim() !== ""
              ? { minLifetimeStamps: Number(minStamps) }
              : {}),
            ...(withBirthdayThisMonth ? { withBirthdayThisMonth: true } : {}),
            ...(programId !== "" ? { programId } : {}),
            ...(rfmSegment !== "" ? { rfmSegment } : {}),
          };
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ header, body, audienceFilter }),
    });
    setPending(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errBody.error ?? "failed to start broadcast");
      return;
    }
    setHeader("");
    setBody("");
    setMinStamps("");
    setWithBirthdayThisMonth(false);
    setProgramId("");
    setFilterMode("all");
    // Clear the suggestions too. Leaving them up after a send invites a second
    // click on an option that was written for an audience no longer selected.
    setDrafts([]);
    setDraftCount(null);
    setOccasion("");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-gray-200 bg-white p-4"
    >
      {/*
        Audience first, deliberately.
        Before AI drafting this block sat below the two text inputs, which was
        fine when the merchant wrote the copy themselves. Now the draft is
        written FOR a specific segment, so choosing the audience has to come
        first — otherwise everyone presses Draft on an empty audience and gets
        generic copy, then wonders why segmentation made no difference.
      */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-800">Audience</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={filterMode === "all"}
              onChange={() => setFilterMode("all")}
            />
            All active customers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={filterMode === "filtered"}
              onChange={() => setFilterMode("filtered")}
            />
            Only customers who match…
          </label>
        </div>
        {filterMode === "filtered" ? (
          <div className="mt-3 space-y-3 pl-6 border-l border-gray-100 ml-1">
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Have collected at least N lifetime stamps
              </label>
              <input
                type="number"
                min={0}
                value={minStamps}
                onChange={(e) => setMinStamps(e.target.value)}
                placeholder="e.g. 5 — leave blank for no minimum"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={withBirthdayThisMonth}
                onChange={(e) => setWithBirthdayThisMonth(e.target.checked)}
              />
              Have a birthday this month
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Only a customer segment
              </label>
              <select
                value={rfmSegment}
                onChange={(e) => setRfmSegment(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Any segment</option>
                <option value="at_risk">At risk — regulars who have gone quiet</option>
                <option value="champions">Champions — recent and frequent</option>
                <option value="promising">Promising — coming back, not yet regular</option>
                <option value="new">New — one visit so far</option>
                <option value="sleeping">Sleeping — occasional, drifted away</option>
                <option value="lost">Lost — long gone</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Segments are on the Analytics page. &ldquo;At risk&rdquo; is usually the one
                worth messaging.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Only customers on a specific program
              </label>
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— any program —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">
              Filters combine with AND. If you leave them all blank this is the
              same as sending to all active customers.
            </p>
          </div>
        ) : null}
      </fieldset>

      {aiAvailable ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <label className="block text-sm font-medium text-gray-800">
              Stuck on the words?
            </label>
            {/* A two-button toggle rather than a select: there are two options
                and a dropdown for two options is a worse control. */}
            <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
              {(["nl", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  className={`px-2 py-1 ${
                    language === code
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {code === "nl" ? "Nederlands" : "English"}
                </button>
              ))}
            </div>
          </div>
          <input
            value={occasion}
            maxLength={200}
            onChange={(e) => setOccasion(e.target.value)}
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="What's the occasion? e.g. nieuwe winterkaart — optional"
          />
          <button
            type="button"
            onClick={() => void onDraft()}
            disabled={drafting}
            className="mt-2 rounded-md border border-gray-900 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
          >
            {drafting ? "Writing…" : "Draft with AI"}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            {filterMode === "filtered" && rfmSegment !== ""
              ? "Written for the segment you picked above."
              : "Pick a customer segment above and the copy will be written for them."}
          </p>

          {draftError ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {draftError}
            </div>
          ) : null}

          {drafts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {draftCount !== null ? (
                <p className="text-xs text-gray-500">
                  For the {draftCount} customer{draftCount === 1 ? "" : "s"} in this
                  segment:
                </p>
              ) : null}
              {drafts.map((draft, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => useDraft(draft)}
                  className="block w-full rounded-md border border-gray-200 bg-white p-3 text-left hover:border-gray-900"
                >
                  <p className="text-sm font-medium text-gray-900">{draft.header}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{draft.body}</p>
                </button>
              ))}
              {/* Not decoration. The copy is about to go to real customers on
                  their lock screen, and nothing downstream checks it. */}
              <p className="text-xs text-gray-500">
                Claude wrote these. Click one to load it, then read it before you
                send.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-gray-800">
          Notification title
          <span className="ml-2 text-xs text-gray-400">{header.length}/60</span>
        </label>
        <input
          required
          value={header}
          maxLength={60}
          onChange={(e) => setHeader(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Friday special: 20% off all drinks"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">
          Message body
          <span className="ml-2 text-xs text-gray-400">{body.length}/200</span>
        </label>
        <textarea
          required
          value={body}
          maxLength={200}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Show your loyalty card and we'll knock 20% off any drink this Friday."
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
        {pending ? "Starting…" : "Send broadcast"}
      </button>
      <p className="text-xs text-gray-500">
        Customers can mute notifications from a specific business inside Google
        Wallet at any time.
      </p>
    </form>
  );
}
