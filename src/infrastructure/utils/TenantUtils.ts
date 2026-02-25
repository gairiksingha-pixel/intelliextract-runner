export function loadBrandPurchasers(): Record<string, string[]> {
  const raw = process.env.S3_TENANT_PURCHASERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch (_) {}
  return {};
}

export function getPairsForSchedule(
  brands: string[],
  purchasers: string[],
  brandPurchaserMap: Record<string, string[]>,
) {
  let brandList = Array.isArray(brands) ? brands.filter(Boolean) : [];
  let purchaserList = Array.isArray(purchasers)
    ? purchasers.filter(Boolean)
    : [];

  if (brandList.length === 0 && purchaserList.length === 0) return [];
  if (brandList.length === 0) brandList = Object.keys(brandPurchaserMap || {});
  if (purchaserList.length === 0) {
    const set = new Set<string>();
    brandList.forEach((b) => {
      (brandPurchaserMap[b] || []).forEach((p: string) => set.add(p));
    });
    purchaserList = Array.from(set);
  }

  const pairs: Array<{ tenant: string; purchaser: string }> = [];
  brandList.forEach((tenant) => {
    const allowed = brandPurchaserMap[tenant];
    if (!allowed) return;
    purchaserList.forEach((purchaser) => {
      if (allowed.indexOf(purchaser) !== -1) {
        pairs.push({ tenant, purchaser });
      }
    });
  });
  return pairs;
}
