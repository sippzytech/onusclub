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
  keyPassphrase: string;
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

  const encryptedKey = forge.pki.encryptRsaPrivateKey(
    keyBag.key as forge.pki.rsa.PrivateKey,
    password,
    { algorithm: "aes256" }
  );
  return {
    certPem: Buffer.from(forge.pki.certificateToPem(certBag.cert), "utf8"),
    keyPem: Buffer.from(encryptedKey, "utf8"),
  };
}

async function loadCreds(): Promise<ApnsCredentials | null> {
  if (cachedCreds) return cachedCreds;
  if (credsLoadError) return null;
  if (!env.APPLE_APNS_P12_PATH || !env.APPLE_APNS_P12_PASSWORD) {
    credsLoadError = "APPLE_APNS_P12_PATH / APPLE_APNS_P12_PASSWORD not set";
    logger.warn(
      "apns: not configured — pass live-update pushes disabled (passes will still download)"
    );
    return null;
  }
  try {
    const buf = await readFile(env.APPLE_APNS_P12_PATH);
    const { certPem, keyPem } = extractPemPair(buf, env.APPLE_APNS_P12_PASSWORD);
    cachedCreds = {
      certPem,
      keyPem,
      keyPassphrase: env.APPLE_APNS_P12_PASSWORD,
    };
    logger.info({ path: env.APPLE_APNS_P12_PATH }, "apns credentials loaded");
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

async function getSession(): Promise<ClientHttp2Session | null> {
  if (session && !session.closed && !session.destroyed) return session;
  const creds = await loadCreds();
  if (!creds) return null;
  session = connect(APNS_HOST, {
    cert: creds.certPem,
    key: creds.keyPem,
    passphrase: creds.keyPassphrase,
  });
  session.on("error", (err) => {
    logger.warn({ err: err.message }, "apns session error");
  });
  session.on("close", () => {
    // Force a fresh connect on the next push.
    session = null;
  });
  return session;
}

export interface ApnsResult {
  pushToken: string;
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * Send a Wallet pass-update push to a single device. Resolves to a result —
 * never throws. APNs status semantics:
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
  const sess = await getSession();
  if (!sess) {
    return { pushToken, ok: false, status: 0, reason: "apns not configured" };
  }

  return new Promise<ApnsResult>((resolve) => {
    const req = sess.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": passTypeIdentifier,
      "apns-push-type": "background",
      "apns-priority": "5",
    });
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
        resolve({ pushToken, ok: true, status });
        return;
      }
      let reason: string | undefined;
      try {
        reason = JSON.parse(body).reason as string;
      } catch {
        reason = body || undefined;
      }
      resolve({ pushToken, ok: false, status, reason });
    });
    req.on("error", (err) => {
      resolve({ pushToken, ok: false, status: 0, reason: err.message });
    });

    // Wallet pass-update push payload is just {}
    req.end("{}");
  });
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
