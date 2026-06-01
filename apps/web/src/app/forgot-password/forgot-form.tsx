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
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
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
        <label className="block text-sm font-medium text-gray-800">Email</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="you@example.com"
        />
      </div>
      {result?.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {result.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
