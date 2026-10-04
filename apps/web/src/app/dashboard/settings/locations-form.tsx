"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseCoordinates, type ShopLocation } from "@onusclub/shared";

/**
 * Shop locations, for proximity notifications.
 *
 * The hard part is getting two numbers out of someone who has no reason to
 * know what a coordinate is. So: one paste box that takes whatever they have —
 * a Google Maps link or the numbers themselves — with the parsed result shown
 * underneath in fields that stay editable.
 *
 * Parsed here as you type purely for feedback. The API parses again and is the
 * authority; it also resolves shortened Share links, which the browser cannot
 * because of CORS.
 */
export function LocationsForm({
  initial,
  maxLocations,
}: {
  initial: ShopLocation[];
  maxLocations: number;
}): JSX.Element {
  const router = useRouter();
  const [locations, setLocations] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const atCap = locations.length >= maxLocations;
  const preview = paste.trim() ? parseCoordinates(paste) : null;

  function resetForm(): void {
    setName("");
    setPaste("");
    setLat("");
    setLng("");
    setError(null);
  }

  /**
   * Fill the editable numbers from a paste, when we can read it here. A
   * shortened Share link cannot be read in the browser, so those just go to
   * the server as-is.
   */
  function onPaste(value: string): void {
    setPaste(value);
    setError(null);
    const parsed = parseCoordinates(value);
    if (parsed.ok) {
      setLat(String(parsed.latitude));
      setLng(String(parsed.longitude));
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Send the typed numbers when we have them — the API prefers them over
      // the link, so a hand-corrected coordinate is not overridden. Otherwise
      // hand over the raw paste and let the server resolve it.
      const body: Record<string, unknown> = { name: name.trim() };
      if (lat.trim() && lng.trim()) {
        body.latitude = Number(lat);
        body.longitude = Number(lng);
      } else {
        body.mapsUrl = paste.trim();
      }

      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { location?: ShopLocation; error?: string };
      if (!res.ok || !data.location) {
        setError(data.error ?? "Could not save that location.");
        return;
      }
      setLocations((prev) => [...prev, data.location!]);
      setAdding(false);
      resetForm();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not remove that location.");
        return;
      }
      setLocations((prev) => prev.filter((l) => l.id !== id));
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-brand-green/20 px-3 py-2 text-sm text-brand-green";

  return (
    <div className="space-y-5">
      <p className="text-sm text-brand-olive">
        When a customer with your card is near one of these, their phone can show it on
        the lock screen — no app, nothing for you to run. Add the shop address of each of
        your locations.
      </p>

      {locations.length === 0 ? (
        <p className="text-sm text-brand-olive border border-dashed border-brand-green/20 rounded-lg px-4 py-6 text-center">
          No locations yet. Passes still work — they just won&apos;t appear when someone
          walks past.
        </p>
      ) : (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand-green/15 bg-brand-cream/40 px-4 py-3"
            >
              <span className="font-medium text-brand-green">{loc.name}</span>
              {loc.address && (
                <span className="text-xs text-brand-olive">{loc.address}</span>
              )}
              {/* Nobody can eyeball 52.3676, so the only honest confirmation is
                  a link that opens where the geofence actually is. */}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-olive underline tabular-nums"
              >
                {loc.latitude}, {loc.longitude} — check on a map ↗
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(loc.id)}
                className="ml-auto text-xs text-brand-olive underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {adding ? (
        <div className="rounded-lg border border-brand-green/15 p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-brand-olive">What is this location called?</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kleine Berg"
              className={`mt-1 ${field}`}
            />
            <span className="block text-xs text-brand-olive mt-1">
              Your customer sees this on their lock screen.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-brand-olive">Where is it?</span>
            <input
              type="text"
              value={paste}
              onChange={(e) => onPaste(e.target.value)}
              placeholder="Paste a Google Maps link, or type 52.3676, 4.9041"
              className={`mt-1 ${field}`}
            />
            {/* The Share button gives a short link with no coordinates in it,
                which is the single most likely way to get stuck here. */}
            <span className="block text-xs text-brand-olive mt-1">
              Open your shop in Google Maps and copy the link from your browser&apos;s
              address bar — that one has the exact spot in it.
            </span>
          </label>

          {preview && !preview.ok && !preview.shortLink && paste.trim().length > 3 && (
            <p className="text-xs text-amber-800">{preview.reason}</p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-brand-olive">
              <span className="block mb-1">Latitude</span>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-32 rounded-lg border border-brand-green/20 px-3 py-2 text-sm text-brand-green font-mono"
              />
            </label>
            <label className="text-xs text-brand-olive">
              <span className="block mb-1">Longitude</span>
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-32 rounded-lg border border-brand-green/20 px-3 py-2 text-sm text-brand-green font-mono"
              />
            </label>
            {lat.trim() && lng.trim() && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-olive underline py-2"
              >
                Check this spot ↗
              </a>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy || !name.trim() || (!paste.trim() && !(lat.trim() && lng.trim()))}
              onClick={save}
              className="px-4 py-2 rounded-full bg-brand-green text-brand-cream text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Add location"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="px-4 py-2 rounded-full border border-brand-green/20 text-brand-olive text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={atCap}
          onClick={() => setAdding(true)}
          className="px-4 py-2 rounded-full border border-brand-green/20 text-brand-green text-sm hover:border-brand-green/50 transition-colors disabled:opacity-50"
        >
          Add a location
        </button>
      )}

      {atCap && (
        <p className="text-xs text-brand-olive">
          {/* Theirs, not ours — worth saying so it does not read as an upsell. */}
          That&apos;s {maxLocations}, the most Apple and Google allow on one card. Remove
          one to add another.
        </p>
      )}

      <p className="text-xs text-brand-olive border-t border-brand-green/10 pt-4">
        Changes reach Google Wallet the next time a card is stamped. Apple passes update
        on their own refresh.
      </p>
    </div>
  );
}
