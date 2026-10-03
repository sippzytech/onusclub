// Validation for merchant-uploaded images.
//
// Done by reading the file's own header rather than trusting the declared
// content type, because the declared type comes from the browser and a
// mislabelled file would be served back to Google and Apple as something it
// is not. The header is the only thing that actually knows.
//
// No resizing: there is no raster image library in this project, and adding
// one to crop a café's logo is not worth the dependency. Instead the limits
// are stated plainly in the UI and a too-small file is refused, which is
// kinder than silently rendering something blurry on a customer's wallet pass.

import { createHash } from "node:crypto";

export interface ImageInfo {
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** Google's logo guidance is 660px square; this is the floor we refuse below. */
export const MIN_DIMENSION = 200;
/** Google rejects anything over 5 MB. Well under that keeps passes quick to fetch. */
export const MAX_BYTES = 2 * 1024 * 1024;

function readPng(buf: Buffer): ImageInfo | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  // IHDR is always the first chunk, so width/height sit at a fixed offset.
  return {
    contentType: "image/png",
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function readJpeg(buf: Buffer): ImageInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  // Walk the segment markers to the first start-of-frame, which carries the
  // dimensions. JPEG has no fixed offset the way PNG does.
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1; // resync past padding
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc), which share the
    // range but are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        contentType: "image/jpeg",
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null; // malformed; refuse rather than loop
    offset += 2 + segmentLength;
  }
  return null;
}

export type ImageRejection =
  | { ok: false; reason: string }
  | { ok: true; info: ImageInfo; version: string };

export function inspectImage(buf: Buffer): ImageRejection {
  if (buf.length === 0) return { ok: false, reason: "The file is empty." };
  if (buf.length > MAX_BYTES) {
    return {
      ok: false,
      reason: `That image is ${(buf.length / 1024 / 1024).toFixed(1)} MB. Please use one under 2 MB.`,
    };
  }

  const info = readPng(buf) ?? readJpeg(buf);
  if (!info) {
    return { ok: false, reason: "That does not look like a PNG or JPEG image." };
  }
  if (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION) {
    return {
      ok: false,
      reason: `That image is ${info.width}×${info.height}. Please use at least ${MIN_DIMENSION}×${MIN_DIMENSION} — smaller looks blurry on a wallet pass.`,
    };
  }

  return {
    ok: true,
    info,
    // Short content hash: identical bytes give an identical URL, so replacing a
    // logo busts Google's cache while re-uploading the same file does not.
    version: createHash("sha256").update(buf).digest("hex").slice(0, 12),
  };
}
