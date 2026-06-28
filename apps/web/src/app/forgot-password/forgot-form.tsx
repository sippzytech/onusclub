"use client";

import { useState, type FormEvent } from "react";

interface ForgotResponse {
  ok?: boolean;
  error?: string;
  devResetLink?: string;
}

export function ForgotPasswordForm(): JSX.Element {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ForgotResponse | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const res = await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as ForgotResponse;
    setResult(data);
    setPending(false);
  }

  if (result?.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-medium">Check your email.</p>
        <p className="mt-1">
          If an account exists for this address, a password reset link is on its way.
          The link expires in an hour.
        </p>
        {result.devResetLink ? (
          <p className="mt-3 text-xs text-emerald-800">
            Dev shortcut:{" "}
            <a className="underline break-all" href={result.devResetLink}>
              {result.devResetLink}
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-brand-green">Email</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="you@example.com"
        />
      </div>
      {result?.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {result.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
