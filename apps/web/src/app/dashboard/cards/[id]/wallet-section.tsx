"use client";

import { useState } from "react";

export function WalletSection({
  walletUrl,
  qrSvg,
  qrToken,
}: {
  walletUrl: string | null;
  qrSvg: string;
  qrToken: string;
}): JSX.Element {
  const [copied, setCopied] = useState<"link" | "token" | null>(null);

  async function copy(text: string, kind: "link" | "token"): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900">Add to Google Wallet</h3>
        {walletUrl ? (
          <>
            <p className="text-xs text-gray-600">
              Send this link to the customer (WhatsApp / SMS). On their phone it
              opens Google Wallet and saves the pass.
            </p>
            <div className="flex gap-2">
              <a
                href={walletUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                Open save link
              </a>
              <button
                onClick={() => void copy(walletUrl, "link")}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
              >
                {copied === "link" ? "Copied!" : "Copy link"}
              </button>
            </div>
            <p className="text-xs text-gray-500 break-all">{walletUrl}</p>
          </>
        ) : (
          <p className="text-xs text-gray-600">
            Google Wallet is not configured yet for this card. The card still
            works — show the QR on the right and stamp from the dashboard.
          </p>
        )}
      </div>
      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900">QR code (fallback)</h3>
        <p className="text-xs text-gray-600">
          Embedded in the wallet pass. Day 5 will let you scan it from the
          dashboard. Token starts <code className="text-xs">{qrToken.slice(0, 8)}…</code>
        </p>
        <div
          className="w-full max-w-[180px] mx-auto"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <button
          onClick={() => void copy(qrToken, "token")}
          className="block mx-auto rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
          {copied === "token" ? "Copied!" : "Copy token"}
        </button>
      </div>
    </div>
  );
}
