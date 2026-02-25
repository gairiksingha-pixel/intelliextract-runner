import { Fernet } from "fernet-nodejs";

export class FernetSecretService {
  private static decryptionAttempted = false;
  private static readonly ENCRYPTED_VARS: [string, string][] = [
    ["INTELLIEXTRACT_ACCESS_KEY_ENCRYPTED", "INTELLIEXTRACT_ACCESS_KEY"],
    [
      "INTELLIEXTRACT_SECRET_MESSAGE_ENCRYPTED",
      "INTELLIEXTRACT_SECRET_MESSAGE",
    ],
    ["INTELLIEXTRACT_SIGNATURE_ENCRYPTED", "INTELLIEXTRACT_SIGNATURE"],
    ["AWS_ACCESS_KEY_ID_ENCRYPTED", "AWS_ACCESS_KEY_ID"],
    ["AWS_SECRET_ACCESS_KEY_ENCRYPTED", "AWS_SECRET_ACCESS_KEY"],
  ];

  static loadSecrets(): void {
    if (this.decryptionAttempted) return;
    this.decryptionAttempted = true;

    const key = process.env.FERNET_KEY?.trim();
    if (!key) return;

    try {
      const fernet = new Fernet(key);
      for (const [encKey, plainKey] of this.ENCRYPTED_VARS) {
        const encrypted = process.env[encKey]?.trim();
        if (!encrypted) continue;
        try {
          const decrypted = fernet.decrypt(encrypted);
          process.env[plainKey] =
            typeof decrypted === "string" ? decrypted : String(decrypted);
        } catch (_) {}
      }
    } catch (_) {}
  }
}
