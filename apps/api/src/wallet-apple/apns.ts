// APNs (Apple Push Notification service) client for Apple Wallet live updates.
//
// Wallet pass push is a thin slice of APNs:
//   - Always production endpoint (`api.push.apple.com`), regardless of dev/prod
//     environment. Sandbox APNs is only for iOS app push during development.
//   - Topic = the pass type identifier (e.g. pass.com.onusclub.loyalty)
//   - Push type = "background"
//   - Payload = empty JSON `{}`
//   - Cert-based auth (HTTP/2 client cert from the Pass Type ID push cert)
//
// We extract PEM cert + key from the .p12 using node-forge (same dance as
// the pass signer in client.ts), then maintain a single long-lived HTTP/2
// session and reuse it across requests. APNs allows ~10 multiplexed streams
// per connection by default — plenty for our fan-out volumes.

import { readFile } from "node:fs/promises";
import { connect, type ClientHttp2Session } from "node:http2";
import forge from "node-forge";
import { env } from "../config.js";
import { logger } from "../logger.js";

const APNS_HOST = "https://api.push.apple.com";

interface ApnsCredentials {
  certPem: Buffer;
  keyPem: Buffer;
}

let cachedCreds: ApnsCredentials | null = null;
let credsLoadError: string | null = null;
let session: ClientHttp2Session | null = null;

function extractPemPair(
  p12Buffer: Buffer,
  password: string
): { certPem: Buffer; keyPem: Buffer } {
  const p12Asn1 = forge.asn1.fromDer(
    forge.util.createBuffer(p12Buffer.toString("binary"))
  );
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ]?.[0];
  if (!certBag?.cert) throw new Error("apns p12 missing certificate");
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ]?.[0];
  if (!keyBag?.key) throw new Error("apns p12 missing private key");

  // Emit the key as UNENCRYPTED PEM. node-forge's encryptRsaPrivateKey wraps
  // the key in a format Node's OpenSSL silently chokes on during TLS init
  // (empty error event, then session destroyed). The key is already in
  // process memory either way — re-encrypting it just makes the file
  // unreadable without the passphrase, which doesn't apply when it never
  // touches disk.
  const keyPem = forge.pki.privateKeyToPem(
    keyBag.key as forge.pki.rsa.PrivateKey
  );
  return {
    certPem: Buffer.from(forge.pki.certificateToPem(certBag.cert), "utf8"),
    keyPem: Buffer.from(keyPem, "utf8"),
  };
}

async function loadCreds(): Promise<ApnsCredentials | null> {
  if (cachedCreds) return cachedCreds;
  if (credsLoadError) return null;

  // Preferred path: read pre-extracted PEM cert + key directly. node-forge's
  // PEM output is rejected silently by Node 20's OpenSSL during the TLS
  // client-cert handshake (empty 'error' event, session destroyed). The
  // user generates these once on the VPS with:
  //   openssl pkcs12 -in onusclub-push.p12 -clcerts -nokeys -legacy \
  //     -out push-cert.pem -passin "pass:..."
  //   openssl pkcs12 -in onusclub-push.p12 -nocerts -nodes -legacy \
  //     -out push-key.pem -passin "pass:..."
  // then sets APPLE_APNS_CERT_PEM_PATH + APPLE_APNS_KEY_PEM_PATH in .env.
  if (env.APPLE_APNS_CERT_PEM_PATH && env.APPLE_APNS_KEY_PEM_PATH) {
    try {
      const [certPem, keyPem] = await Promise.all([
        readFile(env.APPLE_APNS_CERT_PEM_PATH),
        readFile(env.APPLE_APNS_KEY_PEM_PATH),
      ]);
      cachedCreds = { certPem, keyPem };
      logger.info(
        { cert: env.APPLE_APNS_CERT_PEM_PATH, key: env.APPLE_APNS_KEY_PEM_PATH },
        "apns credentials loaded (PEM)"
      );
      return cachedCreds;
    } catch (err) {
      credsLoadError = (err as Error).message;
      logger.warn(
        { err: credsLoadError },
        "apns: failed to load PEM cert/key — pushes disabled"
      );
      return null;
    }
  }

  // Fallback: extract from .p12 via node-forge. Known to fail TLS handshake
  // on Node 20 / Alpine. Kept for backwards compatibility but the PEM path
  // above is the recommended setup.
  if (!env.APPLE_APNS_P12_PATH || !env.APPLE_APNS_P12_PASSWORD) {
    credsLoadError =
      "neither APPLE_APNS_CERT_PEM_PATH+APPLE_APNS_KEY_PEM_PATH nor APPLE_APNS_P12_PATH+APPLE_APNS_P12_PASSWORD set";
    logger.warn(
      "apns: not configured — pass live-update pushes disabled (passes will still download)"
    );
    return null;
  }
  try {
    const buf = await readFile(env.APPLE_APNS_P12_PATH);
    const { certPem, keyPem } = extractPemPair(buf, env.APPLE_APNS_P12_PASSWORD);
    cachedCreds = { certPem, keyPem };
    logger.info(
      { path: env.APPLE_APNS_P12_PATH },
      "apns credentials loaded (p12 — may fail TLS, prefer PEM)"
    );
    return cachedCreds;
  } catch (err) {
    credsLoadError = (err as Error).message;
    logger.warn(
      { err: credsLoadError, path: env.APPLE_APNS_P12_PATH },
      "apns: failed to load p12 — pushes disabled"
    );
    return null;
  }
}

async function openSession(): Promise<ClientHttp2Session | null> {
  const creds = await loadCreds();
  if (!creds) return null;
  return new Promise<ClientHttp2Session | null>((resolve) => {
    const s = connect(APNS_HOST, {
      cert: creds.certPem,
      key: creds.keyPem,
    });
    // Wait for the TLS handshake + HTTP/2 SETTINGS to complete OR for the
    // initial 'error' event before returning. We DON'T treat the error as
    // fatal — Apple's APNs sometimes emits a transient error during the
    // handshake that the session recovers from once the request is sent.
    // The per-request retry path in sendApnsPush picks up real failures.
    let settled = false;
    const done = (val: ClientHttp2Session | null): void => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    s.once("connect", () => done(s));
    s.once("error", (err) => {
      logger.warn(
        { err: err.message || "(no message)" },
        "apns session emitted error during connect — sending request anyway"
      );
      // Return the session, not null. If the request fails too, tryOnce
      // will catch it and the caller retries on a fresh session.
      done(s);
    });
    s.once("close", () => {
      if (session === s) session = null;
    });
    // Belt-and-braces timeout — APNs usually connects in <500ms.
    setTimeout(() => done(s), 3000).unref();
  });
}

async function getSession(): Promise<ClientHttp2Session | null> {
  if (session && !session.closed && !session.destroyed) return session;
  const fresh = await openSession();
  if (fresh) session = fresh;
  return fresh;
}

/** Force the next push to open a fresh session. Used by the retry path. */
function dropSession(): void {
  if (session && !session.closed) {
    try {
      session.close();
    } catch {
      // ignore
    }
  }
  session = null;
}

export interface ApnsResult {
  pushToken: string;
  ok: boolean;
  status: number;
  reason?: string;
}

interface PushAttempt {
  ok: boolean;
  status: number;
  reason?: string;
  // True when the failure is a transient session/stream error worth
  // retrying on a fresh connection. False for HTTP-level rejections
  // (which would just fail the same way on retry).
  retryable: boolean;
}

function tryOnce(
  sess: ClientHttp2Session,
  pushToken: string,
  passTypeIdentifier: string
): Promise<PushAttempt> {
  return new Promise<PushAttempt>((resolve) => {
    let req;
    try {
      req = sess.request({
        ":method": "POST",
        ":path": `/3/device/${pushToken}`,
        "apns-topic": passTypeIdentifier,
        "apns-push-type": "background",
        "apns-priority": "5",
      });
    } catch (err) {
      // request() throws synchronously when called on a destroyed session
      // (ERR_HTTP2_INVALID_SESSION). Treat as retryable so the caller
      // re-opens a fresh session and tries once more.
      resolve({
        ok: false,
        status: 0,
        reason: (err as Error).message || "session unusable",
        retryable: true,
      });
      return;
    }
    let status = 0;
    let body = "";

    req.on("response", (headers) => {
      status = (headers[":status"] as number | undefined) ?? 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (status === 200) {
        resolve({ ok: true, status, retryable: false });
        return;
      }
      let reason: string | undefined;
      try {
        reason = JSON.parse(body).reason as string;
      } catch {
        reason = body || undefined;
      }
      resolve({ ok: false, status, reason, retryable: false });
    });
    req.on("error", (err) => {
      // Stream-level errors (cancellation, connection died mid-request) are
      // worth a single retry on a fresh session. Status 0 = we never got a
      // response.
      const msg = err.message || "";
      const retryable =
        msg.includes("canceled") ||
        msg.includes("CANCEL") ||
        msg.includes("GOAWAY") ||
        msg.includes("ECONNRESET") ||
        msg.includes("closed");
      resolve({ ok: false, status: 0, reason: msg || "stream error", retryable });
    });
    req.end("{}");
  });
}

/**
 * Send a Wallet pass-update push to a single device. Resolves to a result —
 * never throws. Retries once with a fresh session on transient HTTP/2 stream
 * errors (the kind APNs throws when an idle session is being recycled).
 *
 * APNs status semantics:
 *   200 = delivered
 *   410 = device deregistered (we should clean up the row)
 *   401/403 = auth issue (cert problem)
 *   400 = malformed (bug in our code)
 *   429 = rate-limited
 *   5xx = transient APNs issue
 */
export async function sendApnsPush(
  pushToken: string,
  passTypeIdentifier: string
): Promise<ApnsResult> {
  let sess = await getSession();
  if (!sess) {
    return { pushToken, ok: false, status: 0, reason: "apns not configured" };
  }
  let attempt = await tryOnce(sess, pushToken, passTypeIdentifier);
  if (!attempt.ok && attempt.retryable) {
    // Toss the bad session and try a fresh one. Don't retry again if this
    // also fails — keep the result so the caller sees the real reason.
    dropSession();
    sess = await getSession();
    if (sess) attempt = await tryOnce(sess, pushToken, passTypeIdentifier);
  }
  return {
    pushToken,
    ok: attempt.ok,
    status: attempt.status,
    reason: attempt.reason,
  };
}

/**
 * Fan out the same pass-update push to many devices. Each result is returned
 * independently — partial failures are normal (stale tokens, etc.).
 */
export async function sendApnsPushBatch(
  pushTokens: string[],
  passTypeIdentifier: string
): Promise<ApnsResult[]> {
  if (pushTokens.length === 0) return [];
  return Promise.all(pushTokens.map((t) => sendApnsPush(t, passTypeIdentifier)));
}

/** Test-only: drop the cached session + creds so the next call re-loads. */
export function _resetApnsForTest(): void {
  if (session && !session.closed) session.close();
  session = null;
  cachedCreds = null;
  credsLoadError = null;
}
