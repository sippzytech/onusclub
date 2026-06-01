"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { StaffMember } from "@stampdeck/shared";

export function TeamList({
  staff,
  currentUserId,
  isOwner,
}: {
  staff: StaffMember[];
  currentUserId: string;
  isOwner: boolean;
}): JSX.Element {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-form state
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function remove(id: string): Promise<void> {
    if (!confirm("Remove this team member? They'll lose access immediately.")) return;
    setRemoving(id);
    setError(null);
    const res = await fetch(`/api/staff/${id}`, { method: "DELETE" });
    setRemoving(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not remove");
      return;
    }
    router.refresh();
  }

  async function add(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name: name.trim() === "" ? undefined : name.trim(),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not add team member");
      return;
    }
    setEmail("");
    setName("");
    setPassword("");
    setShowAdd(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {staff.map((s) => (
          <li
            key={s.id}
            className="rounded-md border border-gray-200 bg-white p-4 text-sm flex items-center justify-between gap-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{s.name ?? s.email}</span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-xs " +
                    (s.role === "owner"
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-700")
                  }
                >
                  {s.role}
                </span>
                {s.id === currentUserId ? (
                  <span className="text-xs text-gray-500">(you)</span>
                ) : null}
              </div>
              <div className="text-gray-600 mt-1">{s.email}</div>
            </div>
            {isOwner && s.role !== "owner" && s.id !== currentUserId ? (
              <button
                onClick={() => void remove(s.id)}
                disabled={removing === s.id}
                className="text-xs text-red-700 underline hover:no-underline disabled:opacity-50"
              >
                {removing === s.id ? "Removing…" : "Remove"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {isOwner ? (
        showAdd ? (
          <form
            onSubmit={add}
            className="space-y-3 rounded-md border border-gray-200 bg-white p-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-800">Email</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="cashier@cafe.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Jane Doe"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Initial password
              </label>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Min 8 characters"
              />
              <p className="mt-1 text-xs text-gray-500">
                Share this password with your team member out-of-band (in person, text,
                or WhatsApp). They&apos;ll be able to change it later via Forgot
                password.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add team member"}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add team member
          </button>
        )
      ) : null}
    </div>
  );
}
