"use client";

import { useState, type FormEvent } from "react";
import type { PublicEnrolResult, PublicProgram } from "@onusclub/shared";

interface SuccessState {
  walletSaveUrl: string | null;
  existing: boolean;
}

export function PublicEnrolForm({
  slug,
  programs,
}: {
  slug: string;
  programs: PublicProgram[];
}): JSX.Element {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (phone.trim() === "" && email.trim() === "") {
      setError("Add a phone or email so the café can recognise you.");
      return;
    }
    setPending(true);
    const res = await fetch(`/api/public/${slug}/enrol`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        phone: phone.trim() === "" ? undefined : phone.trim(),
        email: email.trim() === "" ? undefined : email.trim(),
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
