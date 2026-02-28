export class FileMetadataService {
  /**
   * Resolves brand and purchaser from a filename given a map of valid brand-purchaser pairs.
   * Format usually: BRAND_PURCHASER_REST.ext or BRAND_REST.ext
   */
  static resolveMetadata(
    filename: string,
    brandPurchasers: Record<string, string[]>,
    fallbackPurchaser?: string,
  ): { brand: string; purchaser: string } {
    const brand = filename.split("_")[0] || "";
    let purchaser = "";

    const rest = filename.slice(brand.length + 1);
    const possiblePurchasers = brandPurchasers[brand] || [];

    // Try to find the longest matching purchaser name to avoid partial matches
    const sortedPurchasers = [...possiblePurchasers].sort(
      (a, b) => b.length - a.length,
    );

    for (const p of sortedPurchasers) {
      if (rest.startsWith(p + "_") || rest === p || rest.startsWith(p + ".")) {
        purchaser = p;
        break;
      }
    }

    if (!purchaser && fallbackPurchaser) {
      purchaser = fallbackPurchaser;
    }

    return { brand, purchaser };
  }
}
