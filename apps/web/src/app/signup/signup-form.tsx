"use client";

import { useState, type FormEvent } from "react";

interface SignupResponse {
  ok?: boolean;
  error?: string;
  devMagicLink?: string | null;
}

export function SignupForm(): JSX.Element {
  const [businessName, setBusinessName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SignupResponse | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessName,
        ownerEmail,
        ownerName: ownerName.trim() === "" ? undefined : ownerName.trim(),
      }),
    });
    const data = (await res.json()) as SignupResponse;
    setResult(data);
    setPending(false);
  }

  if (result?.ok) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-medium">Account created.</p>
        <p className="mt-1">Check your email for a sign-in link.</p>
        {result.devMagicLink ? (
          <p className="mt-3 text-xs text-emerald-800">
            Dev shortcut:{" "}
            <a className="underline break-all" href={result.devMagicLink}>
              {result.devMagicLink}
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-800">Business name</label>
        <input
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Café Bonsoir"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">Your email</label>
        <input
          required
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">Your name (optional)</label>
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Jane Doe"
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
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
