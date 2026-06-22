"use client";

import { useState } from "react";

export function WalletSection({
  cardId,
  walletUrl,
  applePassUrl,
  qrSvg,
  qrToken,
  customerHasEmail,
}: {
  cardId: string;
  walletUrl: string | null;
  applePassUrl: string | null;
  qrSvg: string;
  qrToken: string;
  customerHasEmail: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState<"link" | "apple" | "token" | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  async function copy(text: string, kind: "link" | "apple" | "token"): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  async function resendInvite(): Promise<void> {
    setResending(true);
    setResendMsg(null);
    const res = await fetch(`/api/cards/${cardId}/resend-invite`, { method: "POST" });
    setResending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setResendMsg(`Failed: ${body.error ?? "send failed"}`);
      return;
    }
    const body = (await res.json()) as { emailedTo?: string };
    setResendMsg(`Re-sent to ${body.emailedTo ?? "customer"}.`);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            {customerHasEmail ? (
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <button
                  onClick={() => void resendInvite()}
                  disabled={resending}
                  className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {resending ? "Sending…" : "Resend invite email"}
                </button>
                {resendMsg ? <p className="text-xs text-gray-600">{resendMsg}</p> : null}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                No email on file for this customer — invite emails disabled.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-600">
            Google Wallet is not configured yet for this card. The card still
            works — show the QR on the right and stamp from the dashboard.
          </p>
        )}
      </div>
      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900">Add to Apple Wallet</h3>
        {applePassUrl ? (
          <>
            <p className="text-xs text-gray-600">
              For iPhone users. Tapping this link on iOS opens Wallet and saves
              the pass. Same QR, same stamp count.
            </p>
            <div className="flex gap-2">
              <a
                href={applePassUrl}
                className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                Download pass
              </a>
              <button
                onClick={() => void copy(applePassUrl, "apple")}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
              >
                {copied === "apple" ? "Copied!" : "Copy link"}
              </button>
            </div>
            <p className="text-xs text-gray-500 break-all">{applePassUrl}</p>
          </>
        ) : (
          <p className="text-xs text-gray-600">
            Apple Wallet is not configured yet on this server. iPhone customers
            can still use the QR on the right for stamping.
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
