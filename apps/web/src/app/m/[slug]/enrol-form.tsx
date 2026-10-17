"use client";

import { useState, type FormEvent } from "react";
import type { PublicEnrolResult, PublicProgram } from "@onusclub/shared";
import { GoogleButton } from "@/components/google-button";

interface SuccessState {
  walletSaveUrl: string | null;
  existing: boolean;
}

export function PublicEnrolForm({
  slug,
  programs,
  googleClientId,
}: {
  slug: string;
  programs: PublicProgram[];
  /** "" when the deployment has no client id — then no button renders. */
  googleClientId: string;
}): JSX.Element {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  /**
   * Shared submit for both paths.
   *
   * `googleIdToken` is the only identity the server will read when present —
   * it ignores the name and email fields entirely in that case. So this does
   * not bother clearing them: it cannot matter, by design on the server side
   * rather than by discipline here.
   */
  async function enrol(googleIdToken?: string): Promise<void> {
    setError(null);
    setPending(true);
    const res = await fetch(`/api/public/${slug}/enrol`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(googleIdToken ? { googleIdToken } : {}),
        name: name.trim() === "" ? undefined : name,
        phone: phone.trim() === "" ? undefined : phone.trim(),
        email: email.trim() === "" ? undefined : email.trim(),
        // Birthday still comes from the form on BOTH paths. Google does not
        // return one without an extra scope and a People API call, and most
        // accounts never set it — so this keeps feeding the birthday sweep.
        birthday: birthday.trim() === "" ? undefined : birthday.trim(),
        programId,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not sign up");
      return;
    }
    const data = (await res.json()) as PublicEnrolResult;
    setSuccess({ walletSaveUrl: data.walletSaveUrl, existing: data.existing });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (phone.trim() === "" && email.trim() === "") {
      setError("Add a phone or email so the café can recognise you.");
      return;
    }
    await enrol();
  }

  if (success) {
    return (
      <div className="space-y-4 rounded-card border border-brand-gold/30 bg-brand-gold/10 p-5 text-center">
        <p className="font-serif text-2xl text-brand-green">
          {success.existing ? "Welcome back!" : "You're in 🎉"}
        </p>
        <p className="text-sm text-brand-green">
          {success.existing
            ? "We already have a card for you. Add it to your wallet:"
            : "Tap below to save your loyalty card to your phone."}
        </p>
        {success.walletSaveUrl ? (
          <a
            href={success.walletSaveUrl}
            className="inline-block rounded-full bg-brand-green px-6 py-3 text-sm font-medium text-white hover:bg-brand-green-deep transition-colors"
          >
            Add to Google Wallet
          </a>
        ) : (
          <p className="text-sm text-brand-olive">
            Wallet save link is not available yet. Please ask the café for assistance.
          </p>
        )}
        <p className="text-xs text-brand-olive">
          After saving, show the pass on your next visit and the staff will stamp it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {programs.length > 1 ? (
        <div>
          <label className="block text-sm font-medium text-brand-green">
            Pick a card
          </label>
          <div className="mt-2 space-y-2">
            {programs.map((p) => (
              <label
                key={p.id}
                className={
                  "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors " +
                  (programId === p.id
                    ? "border-brand-green bg-brand-cream"
                    : "border-brand-green/10 hover:bg-brand-cream/40")
                }
              >
                <input
                  type="radio"
                  name="program"
                  value={p.id}
                  checked={programId === p.id}
                  onChange={() => setProgramId(p.id)}
                  className="mt-1 accent-brand-green"
                />
                <span className="text-sm">
                  <span className="font-medium text-brand-green">{p.name}</span>
                  <br />
                  <span className="text-brand-olive">
                    {p.stampsRequired} stamps → {p.rewardText}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {/*
        Equal weight: the Google button and the full manual form are both
        visible, neither hidden behind a disclosure.

        A Google tap enrols IMMEDIATELY — it carries the card choice above and
        the verified name + email, which is everything the server needs. One
        tap, card created.

        The birthday is the one thing it skips, because Google does not return
        one without an extra scope and a People API call. That is an accepted
        trade: birthday is optional today and plenty of people skip it anyway,
        whereas a second screen asking for it would undo the one-tap win. A
        customer who wants the birthday treat uses the form below.
      */}
      <GoogleButton
        clientId={googleClientId}
        onCredential={(idToken) => enrol(idToken)}
        text="continue_with"
        disabled={pending}
      />
      {googleClientId !== "" ? (
        <>
          <p className="text-center text-xs text-brand-olive -mt-1">
            One tap — we get your name and email from Google.
          </p>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-brand-green/10" />
            <span className="text-xs text-brand-olive">or enter your details</span>
            <span className="h-px flex-1 bg-brand-green/10" />
          </div>
        </>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-brand-green">Your name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="Jane Doe"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-brand-green">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
            placeholder="+31 6 …"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-green">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
            placeholder="you@example.com"
          />
        </div>
      </div>
      <p className="text-xs text-brand-olive -mt-2">Phone or email is enough — we just need a way to know it&apos;s you next time.</p>
      <div>
        <label className="block text-sm font-medium text-brand-green">Birthday (optional)</label>
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
        />
        <p className="mt-1 text-xs text-brand-olive">
          We&apos;ll send you a little treat on your birthday.
        </p>
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand-green px-4 py-3 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
      >
        {pending ? "Creating your card…" : "Get my loyalty card"}
      </button>
    </form>
  );
}
