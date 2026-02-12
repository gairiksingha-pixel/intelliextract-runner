/**
 * Optional decryption of env secrets using Fernet (e.g. tokens encrypted with Python cryptography.fernet).
 * Set FERNET_KEY in env and use *_ENCRYPTED vars; at runtime they are decrypted and set as the plain vars.
 */

import { Fernet } from "fernet-nodejs";

const FERNET_KEY_ENV = "FERNET_KEY";

/** Pairs of (encrypted env var name, plain env var name) to decrypt and set. */
const ENCRYPTED_VARS: [string, string][] = [
  ["INTELLIEXTRACT_ACCESS_KEY_ENCRYPTED", "INTELLIEXTRACT_ACCESS_KEY"],
  ["INTELLIEXTRACT_SECRET_MESSAGE_ENCRYPTED", "INTELLIEXTRACT_SECRET_MESSAGE"],
  ["INTELLIEXTRACT_SIGNATURE_ENCRYPTED", "INTELLIEXTRACT_SIGNATURE"],
  ["AWS_ACCESS_KEY_ID_ENCRYPTED", "AWS_ACCESS_KEY_ID"],
  ["AWS_SECRET_ACCESS_KEY_ENCRYPTED", "AWS_SECRET_ACCESS_KEY"],
];

let decryptionAttempted = false;

/**
 * If FERNET_KEY is set, decrypt any *_ENCRYPTED env vars and set the corresponding plain vars.
 * Call this after dotenv has loaded (e.g. in config or api-client).
 */
export function loadSecrets(): void {
  if (decryptionAttempted) return;
  decryptionAttempted = true;

  const key = process.env[FERNET_KEY_ENV]?.trim();
  if (!key) return;

  try {
    const fernet = new Fernet(key);
    for (const [encryptedKey, plainKey] of ENCRYPTED_VARS) {
      const encrypted = process.env[encryptedKey]?.trim();
      if (!encrypted) continue;
      try {
        const decrypted = fernet.decrypt(encrypted);
        process.env[plainKey] =
          typeof decrypted === "string" ? decrypted : String(decrypted);
      } catch {
        // Skip this var on decrypt error (e.g. wrong key or corrupted token)
      }
    }
  } catch {
    // FERNET_KEY invalid or Fernet init failed; leave env as-is
  }
}
