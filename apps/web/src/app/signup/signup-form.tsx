"use client";

import { useState, type FormEvent } from "react";
import { GoogleButton } from "@/components/google-button";

interface SignupResponse {
  ok?: boolean;
  error?: string;
}

/**
 * The verified identity Google gave us, held while the owner types the one
 * thing Google cannot tell us: what their café is called.
 *
 * The token is kept so the second request can be verified again server-side.
 * We never trust `email` or `name` from this object on the way back — the api
 * re-reads them from the token it verifies.
 */
interface PendingGoogle {
  idToken: string;
  email: string;
  name: string | null;
}

export function SignupForm({ googleClientId }: { googleClientId: string }): JSX.Element {
  const [businessName, setBusinessName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState<PendingGoogle | null>(null);

  /**
   * First Google call. Two outcomes:
   *  - the address already has an account → signed in, straight to dashboard
   *  - no account → we are handed the verified identity and ask for the café
   *    name, because Google gives us a person, not a business
   */
  async function onGoogle(idToken: string): Promise<void> {
    setError(null);
    setPending(true);
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not sign up with Google");
      return;
    }
    const data = (await res.json()) as {
      status: string;
      email?: string;
      name?: string | null;
    };
    if (data.status === "needs_business_name") {
      setGoogle({
        idToken,
        email: data.email ?? "",
        name: data.name ?? null,
      });
      return;
    }
    // Already had an account — signing up is just signing in.
    window.location.href = "/dashboard";
  }

  /** Second Google call: same token, plus the business name. */
  async function onGoogleCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!google) return;
    setError(null);
    setPending(true);
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: google.idToken, businessName }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // Most likely cause: the Google token expired while they were typing.
      // Saying so beats a bare "could not create account".
      setError(body.error ?? "could not create account — try Google again");
      setPending(false);
      return;
    }
    window.location.href = "/dashboard";
  }

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

  const inputClass =
    "mt-1 block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-3 py-2.5 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/40";

  // Google identified the person but not the business, so this collapses the
  // five-field form down to the single thing still missing. The password
  // fields are gone, not disabled: this account will have password_hash NULL
  // and sign in with Google. (Forgot-password can add one later if they want
  // both doors.)
  if (google) {
    return (
      <form onSubmit={onGoogleCreate} className="space-y-4">
        <div className="rounded-lg border border-brand-green/15 bg-brand-cream/40 p-3 text-sm">
          <p className="text-brand-olive text-xs">Signing up as</p>
          <p className="text-brand-green font-medium">{google.email}</p>
          {google.name ? <p className="text-brand-olive">{google.name}</p> : null}
        </div>
        <div>
          <label
            htmlFor="google-business"
            className="block text-sm font-medium text-brand-green"
          >
            What&apos;s your business called?
          </label>
          <input
            id="google-business"
            autoComplete="organization"
            required
            autoFocus
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={inputClass}
            placeholder="Café Bonsoir"
          />
          <p className="mt-1 text-xs text-brand-olive">
            Your customers see this on their loyalty card.
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
          className="w-full rounded-full bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setGoogle(null);
            setError(null);
          }}
          className="w-full text-xs text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
        >
          Use a password instead
        </button>
      </form>
    );
  }

  // htmlFor/id on every field: without the association a screen reader reads
  // five unlabelled boxes, and clicking a label does not focus its input.
  return (
    <div className="space-y-4">
      {/* One tap against five fields, so it goes first. The password form
          stays complete below — Google will not run in an embedded webview,
          and not every owner wants a Google account on their business. */}
      <GoogleButton
        clientId={googleClientId}
        onCredential={onGoogle}
        text="signup_with"
        disabled={pending}
      />
      {googleClientId !== "" ? (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-brand-green/10" />
          <span className="text-xs text-brand-olive">or</span>
          <span className="h-px flex-1 bg-brand-green/10" />
        </div>
      ) : null}

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
    </div>
  );
}
