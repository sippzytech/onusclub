"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerImportResult } from "@onusclub/shared";

interface Props {
  programs: Array<{ id: string; name: string }>;
}

/**
 * CSV import / export.
 *
 * The import is deliberately two-step: pick a file, see exactly what will
 * happen, then confirm. A café's customer list is often the only copy they
 * have, and "imported 180, skipped 20" after the fact is no use — they need to
 * see which 20, and why, while they can still fix the spreadsheet.
 *
 * The file is read in the browser and posted as text. The api has no multipart
 * handling, and adding it for one feature is more surface than this needs.
 */
export function CustomerImportExport({ programs }: Props): JSX.Element {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string>("");
  const [preview, setPreview] = useState<CustomerImportResult | null>(null);
  const [done, setDone] = useState<CustomerImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setCsv(null);
    setFileName(null);
    setPreview(null);
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = ev.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await send(text, true);
  }

  async function send(text: string, dryRun: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customers/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: text,
          dryRun,
          ...(programId ? { programId } : {}),
        }),
      });
      const data = (await res.json()) as { result?: CustomerImportResult; error?: string };
      if (!res.ok || !data.result) {
        setError(data.error ?? "Import failed.");
        return;
      }
      if (dryRun) setPreview(data.result);
      else {
        setDone(data.result);
        setPreview(null);
        setCsv(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card bg-white border border-brand-green/10 p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-brand-green">Import &amp; export</h2>
        <a
          href="/api/customers/export"
          className="text-sm px-4 py-2 rounded-full border border-brand-green/20 text-brand-green hover:border-brand-green/50 transition-colors"
        >
          Export all customers (.csv)
        </a>
      </div>

      <div className="text-sm text-brand-olive space-y-1">
        <p>
          Upload a spreadsheet to add your existing customers. A column for{" "}
          <strong>name</strong>, and at least one of <strong>email</strong> or{" "}
          <strong>phone</strong>. <strong>Birthday</strong> is optional.
        </p>
        <p>
          Excel files exported from a Dutch computer use semicolons — that works, you
          don&apos;t need to change anything. Nothing is written until you confirm.
        </p>
      </div>

      {programs.length > 0 && (
        <label className="block text-sm">
          <span className="text-brand-olive">Also give everyone a card on</span>
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className="mt-1 block w-full max-w-sm rounded-lg border border-brand-green/20 px-3 py-2 text-brand-green bg-white"
          >
            <option value="">Don&apos;t create cards</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-brand-olive mt-1">
            No emails are sent — tell them in person, or send invites later.
          </span>
        </label>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        disabled={busy}
        className="block text-sm text-brand-olive file:mr-3 file:px-4 file:py-2 file:rounded-full file:border file:border-brand-green/20 file:bg-white file:text-brand-green file:text-sm hover:file:border-brand-green/50"
      />

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {preview && (
        <div className="rounded-lg border border-brand-green/15 bg-brand-cream/40 p-4 space-y-3">
          <p className="text-sm text-brand-green">
            <strong>{fileName}</strong> — {preview.totalRows} row
            {preview.totalRows === 1 ? "" : "s"} read
            {preview.delimiter !== "," && (
              <span className="text-brand-olive">
                {" "}
                (separated by &ldquo;{preview.delimiter === "\t" ? "tab" : preview.delimiter}&rdquo;)
              </span>
            )}
          </p>
          <ul className="text-sm text-brand-green space-y-1">
            <li>
              <strong>{preview.created}</strong> new customer
              {preview.created === 1 ? "" : "s"} will be added
            </li>
            {preview.duplicates > 0 && (
              <li className="text-brand-olive">
                {preview.duplicates} already on your list — left untouched
              </li>
            )}
            {preview.skipped.length > 0 && (
              <li className="text-amber-800">
                {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"} cannot be
                imported
              </li>
            )}
          </ul>

          {preview.skipped.length > 0 && (
            <ul className="text-xs text-amber-800 space-y-0.5 max-h-40 overflow-auto">
              {preview.skipped.slice(0, 20).map((rowError) => (
                <li key={rowError.line}>
                  Line {rowError.line}: {rowError.reason}
                </li>
              ))}
              {preview.skipped.length > 20 && <li>…and {preview.skipped.length - 20} more</li>}
            </ul>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy || preview.created === 0}
              onClick={() => csv && send(csv, false)}
              className="px-4 py-2 rounded-full bg-brand-green text-brand-cream text-sm disabled:opacity-50"
            >
              {busy
                ? "Importing…"
                : `Import ${preview.created} customer${preview.created === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-full border border-brand-green/20 text-brand-olive text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Added {done.created} customer{done.created === 1 ? "" : "s"}
          {done.enrolled > 0 && `, and gave ${done.enrolled} a card`}.
          {done.duplicates > 0 && ` ${done.duplicates} were already on your list.`}
        </div>
      )}
    </div>
  );
}
