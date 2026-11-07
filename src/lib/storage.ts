import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getEnv } from "@/lib/config/env";

/**
 * Files under STORAGE_ROOT (the `appdata` volume in Docker, included in
 * backups). Paths in the database are relative, so the root can move.
 */

export function storageRoot() {
  return path.resolve(getEnv().STORAGE_ROOT);
}

/** Resolve a stored relative path, refusing anything that escapes the root. */
export function resolveStored(relative: string) {
  const root = storageRoot();
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path escapes storage root");
  return full;
}

export const AUDIO_TYPES: Record<string, { ext: string; sniff: (b: Uint8Array) => boolean }> = {
  "audio/mpeg": { ext: "mp3", sniff: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  "audio/mp4": { ext: "m4a", sniff: (b) => String.fromCharCode(...b.slice(4, 8)) === "ftyp" },
  "audio/x-m4a": { ext: "m4a", sniff: (b) => String.fromCharCode(...b.slice(4, 8)) === "ftyp" },
  "audio/ogg": { ext: "ogg", sniff: (b) => String.fromCharCode(...b.slice(0, 4)) === "OggS" },
  "audio/wav": { ext: "wav", sniff: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WAVE" },
  "audio/x-wav": { ext: "wav", sniff: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WAVE" },
  "audio/webm": { ext: "webm", sniff: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};

export class InvalidAudioError extends Error {}

/**
 * Store an uploaded audio file. The declared type must be an allowed audio
 * type AND the file's first bytes must match it (no arbitrary uploads).
 */
export async function storeAudio(userId: string, file: { type: string; bytes: Uint8Array }) {
  const type = AUDIO_TYPES[file.type];
  if (!type || !type.sniff(file.bytes)) throw new InvalidAudioError(`Unsupported or mismatched audio type: ${file.type}`);
  const relative = path.posix.join("media", userId, `${randomUUID()}.${type.ext}`);
  const full = resolveStored(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes, { flag: "wx" });
  return { relative, sha256: createHash("sha256").update(file.bytes).digest("hex"), size: file.bytes.byteLength };
}

export async function removeStored(relative: string) {
  await rm(resolveStored(relative), { force: true });
}

export async function storedSize(relative: string) {
  return (await stat(resolveStored(relative))).size;
}
