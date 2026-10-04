"use client";

import { useState, type FormEvent } from "react";

interface SignupResponse {
  ok?: boolean;
  error?: string;
}

export function SignupForm(): JSX.Element {
  const [businessName, setBusinessName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessName,
        ownerEmail,
        password,
        ownerName: ownerName.trim() === "" ? undefined : ownerName.trim(),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not create account");
      setPending(false);
      return;
    }
    // Cookie is set by the server route; go straight to dashboard.
    window.location.href = "/dashboard";
  }

  // htmlFor/id on every field: without the association a screen reader reads
  // five unlabelled boxes, and clicking a label does not focus its input.
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="signup-business" className="block text-sm font-medium text-brand-green">
          Business name
        </label>
        <input
          id="signup-business"
          autoComplete="organization"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="Café Bonsoir"
        />
      </div>
      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium text-brand-green">
          Your email
        </label>
        <input
          id="signup-email"
          autoComplete="email"
          required
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="signup-name" className="block text-sm font-medium text-brand-green">
          Your name (optional)
        </label>
        <input
          id="signup-name"
          autoComplete="name"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="Jane Doe"
        />
      </div>
      <div>
        <label htmlFor="signup-password" className="block text-sm font-medium text-brand-green">
          Password
        </label>
        <input
          id="signup-password"
          autoComplete="new-password"
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label htmlFor="signup-confirm" className="block text-sm font-medium text-brand-green">
          Confirm password
        </label>
        <input
          id="signup-confirm"
          autoComplete="new-password"
          required
          type="password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40"
          placeholder="Re-enter your password"
        />
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
