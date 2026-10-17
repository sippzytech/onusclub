"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Google's own "Sign in with Google" button, rendered by Google's script.
 *
 * Deliberately not a hand-rolled button calling an OAuth URL. Google's
 * branding guidelines require their mark and wording, and their script handles
 * One Tap, the popup, and the ID token callback. We render a container and let
 * it fill it.
 *
 * 🚨 `clientId` arrives as a PROP, never from `process.env` in this file.
 *
 * Next.js inlines `NEXT_PUBLIC_*` into client bundles at BUILD time, while
 * docker-compose.prod.yml supplies env at RUNTIME. A client component reading
 * one would compile to the empty string in production — the button would
 * silently never render, and .env would look perfectly correct. Every existing
 * NEXT_PUBLIC_ read in this repo is in a *server* component, which is why they
 * work. So the server page reads GOOGLE_OAUTH_CLIENT_ID and passes it down.
 *
 * The id is public by design: it ships in the page HTML either way. There is
 * no secret in this flow at all — the ID-token flow has no redirect and never
 * uses Google's client secret.
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GsiCredentialResponse {
  credential: string;
}

interface GsiIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    // Off deliberately — see the comment at the render below.
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "small" | "medium" | "large";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      width?: number;
      logo_alignment?: "left" | "center";
    }
  ) => void;
}

// Google's script attaches itself to window. Declared rather than `any`, per
// the no-`any` rule in CLAUDE.md.
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiIdApi } };
  }
}

/** Load Google's script once per page, however many buttons ask for it. */
function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${GSI_SRC}"]`
  );
  if (existing) {
    // A second component mounted while the first load is still in flight.
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gsi failed")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi failed"));
    document.head.appendChild(script);
  });
}

export function GoogleButton({
  clientId,
  onCredential,
  text = "continue_with",
  disabled = false,
}: {
  /** From the server component. Empty string means the feature is off. */
  clientId: string;
  /** Receives the raw ID token. Verified server-side, never decoded here. */
  onCredential: (idToken: string) => void | Promise<void>;
  text?: "signin_with" | "signup_with" | "continue_with";
  disabled?: boolean;
}): JSX.Element | null {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // The callback is held in a ref so that re-renders (every keystroke in the
  // parent form) do not re-initialise Google's script. Without this, the
  // button flickers and remounts as the user types.
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    if (clientId === "") return;
    let cancelled = false;

    void loadGsi()
      .then(() => {
        if (cancelled) return;
        const id = window.google?.accounts?.id;
        if (!id || !container.current) {
          setFailed(true);
          return;
        }
        id.initialize({
          client_id: clientId,
          callback: (response) => {
            void callback.current(response.credential);
          },
          // No automatic sign-in. On the café-owner pages it would hijack a
          // deliberate password login; on the customer enrolment page it would
          // sign up whoever last used that phone at the counter, which on a
          // shared device is the wrong person entirely.
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        id.renderButton(container.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "pill",
          logo_alignment: "center",
        });
      })
      .catch(() => {
        // Script blocked — a tracker blocker, an offline phone, or an embedded
        // webview where Google refuses to run. Not an error state to shout
        // about: the password form and the manual enrolment form are both
        // right there, which is exactly why neither was removed.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  // Nothing rendered at all when the deployment has no client id, so a café
  // never sees a button that cannot work.
  if (clientId === "" || failed) return null;

  return (
    <div
      ref={container}
      // Google renders an iframe-backed button; pointer-events is the only
      // reliable way to disable it while a request is in flight.
      className={`flex justify-center ${disabled ? "pointer-events-none opacity-50" : ""}`}
    />
  );
}
