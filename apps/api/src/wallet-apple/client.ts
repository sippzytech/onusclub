import { readFile } from "node:fs/promises";
import forge from "node-forge";
import { env } from "../config.js";
import { logger } from "../logger.js";

export interface AppleWalletCredentials {
  teamIdentifier: string;
  passTypeIdentifier: string;
  // PEM-encoded buffers — passkit-generator wants them separately. We extract
  // both from the .p12 once at boot using node-forge.
  signerCertPem: Buffer;
  signerKeyPem: Buffer;
  signerKeyPassphrase: string;
  wwdrPem: Buffer;
}

let cached: AppleWalletCredentials | null = null;
let loadError: string | null = null;

function extractPemPair(
  p12Buffer: Buffer,
  password: string
): { certPem: Buffer; keyPem: Buffer } {
  // node-forge parses PKCS#12 via ASN.1 + binary string round-trips.
  const p12Asn1 = forge.asn1.fromDer(
    forge.util.createBuffer(p12Buffer.toString("binary"))
  );
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Cert bag: the public certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error("p12 missing certificate");

  // Key bag: shrouded (encrypted) PKCS#8 — Keychain's default export format
  const keyBags = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) throw new Error("p12 missing private key");

  // Re-encrypt the private key PEM with the SAME passphrase so passkit-
  // generator can still use signerKeyPassphrase to decrypt — keeps the key
  // encrypted at-rest in memory rather than as a plaintext PEM.
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

async function load(): Promise<AppleWalletCredentials | null> {
  if (cached) return cached;
  if (loadError) return null;

  // Empty env vars are the canonical "Apple Wallet not configured" signal —
  // lets dev / CI run without Apple set up at all.
  const missing: string[] = [];
  if (!env.APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
  if (!env.APPLE_PASS_TYPE_ID) missing.push("APPLE_PASS_TYPE_ID");
  if (!env.APPLE_PASS_P12_PATH) missing.push("APPLE_PASS_P12_PATH");
  if (!env.APPLE_PASS_P12_PASSWORD) missing.push("APPLE_PASS_P12_PASSWORD");
  if (!env.APPLE_WWDR_PATH) missing.push("APPLE_WWDR_PATH");
  if (missing.length > 0) {
    loadError = `missing env: ${missing.join(", ")}`;
    logger.warn({ missing }, "apple wallet not configured — endpoint will 503");
    return null;
  }

  try {
    const [p12Buffer, wwdrPem] = await Promise.all([
      readFile(env.APPLE_PASS_P12_PATH),
      readFile(env.APPLE_WWDR_PATH),
    ]);
    const { certPem, keyPem } = extractPemPair(p12Buffer, env.APPLE_PASS_P12_PASSWORD);
    cached = {
      teamIdentifier: env.APPLE_TEAM_ID,
      passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
      signerCertPem: certPem,
      signerKeyPem: keyPem,
      signerKeyPassphrase: env.APPLE_PASS_P12_PASSWORD,
      wwdrPem,
    };
    logger.info(
      { passTypeId: env.APPLE_PASS_TYPE_ID, teamId: env.APPLE_TEAM_ID },
      "apple wallet client initialized"
    );
    return cached;
  } catch (err) {
    loadError = (err as Error).message;
    logger.warn(
      { p12Path: env.APPLE_PASS_P12_PATH, err: loadError },
      "apple wallet credentials failed to load — endpoint will 503"
    );
    return null;
  }
}

export async function appleWalletEnabled(): Promise<boolean> {
  return (await load()) !== null;
}

export async function appleWalletCredentials(): Promise<AppleWalletCredentials | null> {
  return load();
}
