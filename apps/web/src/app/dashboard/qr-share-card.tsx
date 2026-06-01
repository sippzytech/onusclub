"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrShareCard({ publicUrl }: { publicUrl: string }): JSX.Element {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toString(publicUrl, { type: "svg", margin: 1, width: 200 })
      .then(setQrSvg)
      .catch(() => setQrSvg(null));
  }, [publicUrl]);

  async function copyUrl(): Promise<void> {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadPng(): Promise<void> {
    const dataUrl = await QRCode.toDataURL(publicUrl, { margin: 2, width: 1024 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "stampdeck-signup-qr.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <section className="rounded-md border border-gray-200 bg-white p-6">
      <div className="flex flex-col md:flex-row items-start gap-8">
        <div className="shrink-0 mx-auto md:mx-0">
          {qrSvg ? (
            <div
              className="w-[200px] h-[200px] bg-white rounded p-3 border border-gray-100"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="w-[200px] h-[200px] bg-gray-100 rounded animate-pulse" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Customer signup</p>
            <h3 className="text-base font-medium text-gray-900 mt-1">
              Your QR code
            </h3>
          </div>
          <p className="text-sm text-gray-600">
            Print this and put it on your counter. Customers scan with their phone,
            fill in their details, and the loyalty card lands in their Google Wallet —
            no app to download.
          </p>
          <p className="text-xs text-gray-500 break-all border-t border-gray-100 pt-3">
            {publicUrl}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => void downloadPng()}
              className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
            >
              Download PNG
            </button>
            <button
              onClick={() => void copyUrl()}
              className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              Preview
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
