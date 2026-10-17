"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { GoogleButton } from "@/components/google-button";

export function LoginForm({ googleClientId }: { googleClientId: string }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noGoogleAccount, setNoGoogleAccount] = useState(false);

  async function onGoogle(idToken: string): Promise<void> {
    setError(null);
    setNoGoogleAccount(false);
    setPending(true);
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not sign in with Google");
      setPending(false);
      return;
    }
    const data = (await res.json()) as { status: string };
    // On the LOGIN page, "no account yet" is not an error — it is a signpost.
    // The same response on /signup reveals the business-name field instead.
    if (data.status === "needs_business_name") {
      setNoGoogleAccount(true);
      setPending(false);
      return;
    }
    window.location.href = "/dashboard";
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not sign in");
      setPending(false);
      return;
    }
    window.location.href = "/dashboard";
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40";
  const labelClass = "block text-sm font-medium text-brand-green";

  return (
    <div className="space-y-4">
      {/* Google above the form: it is one tap against three fields, so it goes
          where the eye lands first. The password form stays complete below —
          Google refuses to run inside embedded webviews, and an owner locked
          out of their Google account still has to be able to get in. */}
      <GoogleButton
        clientId={googleClientId}
        onCredential={onGoogle}
        text="signin_with"
        disabled={pending}
      />
      {googleClientId !== "" ? (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-brand-green/10" />
          <span className="text-xs text-brand-olive">or</span>
          <span className="h-px flex-1 bg-brand-green/10" />
        </div>
      ) : null}

      {noGoogleAccount ? (
        <div className="rounded-lg border border-brand-gold/40 bg-brand-gold/10 p-3 text-sm text-brand-green">
          No OnUsClub account uses that Google address yet.{" "}
          <Link href="/signup" className="underline underline-offset-4">
            Create one
          </Link>
          .
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
      {/* htmlFor/id on both: without the association a screen reader reads an
          unlabelled text box, and the visible "Email" above it is decoration.
          It also means clicking the label focuses the field. */}
      <div>
        <label htmlFor="login-email" className={labelClass}>
          Email
        </label>
        <input
          id="login-email"
          name="email"
          autoComplete="email"
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="login-password" className={labelClass}>
          Password
        </label>
        <input
          id="login-password"
          name="password"
          autoComplete="current-password"
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="Your password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
      </form>
    </div>
  );
}
