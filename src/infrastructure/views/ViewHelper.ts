export class ViewHelper {
  static formatBrandDisplayName(brandId: string | null): string {
    if (!brandId) return "N/A";
    const b = brandId.toLowerCase();
    if (b.includes("no-cow")) return "No Cow";
    if (b.includes("sundia")) return "Sundia";
    if (b.includes("tractor-beverage")) return "Tractor";
    if (brandId === "p3" || brandId === "pipe") return "PIPE";
    return brandId;
  }

  static formatPurchaserDisplayName(purchaserId: string | null): string {
    if (!purchaserId) return "N/A";
    const p = purchaserId.toLowerCase();
    if (p.includes("8c03bc63-a173-49d2-9ef4-d3f4c540fae8")) return "Temp 1";
    if (p.includes("a451e439-c9d1-41c5-b107-868b65b596b8")) return "Temp 2";
    if (p.includes("dot_foods")) return "DOT Foods";
    if (p === "640" || p === "641" || p.includes("640") || p.includes("641"))
      return "DMC";
    if (p === "843") return "HPI";
    if (p === "895") return "HPD";
    if (p === "897") return "HPM";
    if (p === "991") return "HPT";
    if (p.includes("kehe")) return "KeHE";
    if (p.includes("unfi")) return "UNFI";
    return purchaserId;
  }

  static escHtml(s: string | null): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
