"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function AddCustomerForm(): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (phone.trim() === "" && email.trim() === "") {
      setError("phone or email is required");
      return;
    }
    setPending(true);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        phone: phone.trim() === "" ? undefined : phone.trim(),
        email: email.trim() === "" ? undefined : email.trim(),
        birthday: birthday.trim() === "" ? undefined : birthday.trim(),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not add customer");
      return;
    }
    setName("");
    setPhone("");
    setEmail("");
    setBirthday("");
    router.refresh();
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-brand-green/10 bg-brand-cream/40 px-3 py-2 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/30";
  const labelClass = "block text-sm font-medium text-brand-green";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className={labelClass}>Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Jane Doe"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
            placeholder="+31 6 …"
          />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="jane@example.com"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Birthday (optional)</label>
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-brand-olive">
          Used by the birthday sweep to send an automatic greeting + bonus.
        </p>
      </div>
      <p className="text-xs text-brand-olive">At least one of phone or email is required.</p>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green-deep disabled:opacity-50 transition-colors"
      >
        {pending ? "Adding…" : "Add customer"}
      </button>
    </form>
  );
}
