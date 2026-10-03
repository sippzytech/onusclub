"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MerchantBranding } from "@onusclub/shared";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Logo and brand colour.
 *
 * The file is read in the browser and sent as base64 — the api has no
 * multipart handling, and one upload endpoint does not justify adding it. Same
 * call as the CSV importer.
 *
 * Size and type are checked here too, not because the server trusts the
 * browser (it inspects the file's own header) but because a café on a café
 * wifi should not upload four megabytes to be told no.
 */
export function BrandingForm({ initial }: { initial: MerchantBranding }): JSX.Element {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [brandColor, setBrandColor] = useState<string>(initial.brandColor ?? "#14271C");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function patch(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/me/branding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { branding?: MerchantBranding; error?: string };
      if (!res.ok || !data.branding) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setLogoUrl(data.branding.logoUrl);
      setBrandColor(data.branding.brandColor ?? "#14271C");
      setSaved(true);
      // Wallet passes and the card preview both read this.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please use one under 2 MB.`);
      ev.target.value = "";
      return;
    }
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    await patch({ logoBase64: btoa(binary) });
    ev.target.value = "";
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-brand-green">Your logo</h3>
        <p className="text-xs text-brand-olive mt-1">
          Shown on your customers&apos; wallet passes. A square PNG of at least 660×660 looks
          best; anything under 200×200 will be refused because it goes blurry on a phone.
        </p>

        <div className="flex items-center gap-4 mt-3">
          <div className="w-20 h-20 rounded-lg border border-brand-green/15 bg-brand-cream flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              // Served from our own API, so next/image would need remote-pattern
              // config for no benefit on an 80px preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Your logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[10px] text-brand-olive text-center px-1">No logo yet</span>
            )}
          </div>

          <div className="space-y-2">
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={onFile}
              disabled={busy}
              className="block text-sm text-brand-olive file:mr-3 file:px-4 file:py-2 file:rounded-full file:border file:border-brand-green/20 file:bg-white file:text-brand-green file:text-sm hover:file:border-brand-green/50"
            />
            {logoUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ logoBase64: null })}
                className="text-xs text-brand-olive underline"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>

        {!logoUrl && (
          <p className="text-xs text-brand-olive mt-3">
            Until you upload one, passes show the OnUsClub badge.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-brand-green">Brand colour</h3>
        <p className="text-xs text-brand-olive mt-1">
          Used as the background on cards and passes. A design saved in the card builder
          overrides this for that program.
        </p>
        <div className="flex items-center gap-3 mt-3">
          <input
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="w-12 h-10 rounded border border-brand-green/20 bg-white cursor-pointer"
          />
          <input
            type="text"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="w-32 rounded-lg border border-brand-green/20 px-3 py-2 text-sm text-brand-green font-mono"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ brandColor })}
            className="px-4 py-2 rounded-full bg-brand-green text-brand-cream text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save colour"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm text-emerald-700">Saved.</p>}

      <p className="text-xs text-brand-olive border-t border-brand-green/10 pt-4">
        Changes reach Google Wallet the next time a card is stamped. Apple passes update on
        their own refresh.
      </p>
    </div>
  );
}
