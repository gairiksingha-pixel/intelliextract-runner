import { GetExtractionDataUseCase } from "../../core/use-cases/GetExtractionDataUseCase.js";
import { GetInventoryDataUseCase } from "../../core/use-cases/GetInventoryDataUseCase.js";
import { PageLayout } from "../../infrastructure/views/PageLayout.js";
import { DataExplorerView } from "../../infrastructure/views/DataExplorerView.js";
import { InventoryView } from "../../infrastructure/views/InventoryView.js";
import { DashboardView } from "../../infrastructure/views/DashboardView.js";
import { ViewHelper } from "../../infrastructure/views/ViewHelper.js";

interface DashboardContext {
  logo: string;
  smallLogo: string;
  favIcon: string;
  brandPurchasers: Record<string, string[]>;
}

export class DashboardController {
  constructor(
    private getExtractionData: GetExtractionDataUseCase,
    private getInventoryData: GetInventoryDataUseCase,
  ) {}

  async getExplorerPage(context: DashboardContext) {
    const allFiles = await this.getExtractionData.execute();

    // Pre-process files to accurately identify brand and purchaser
    const processedFiles = allFiles.map((f: any) => {
      const brand = f.filename.split("_")[0] || "";
      let purchaser = "";
      const rest = f.filename.slice(brand.length + 1);
      const possiblePurchasers = context.brandPurchasers[brand] || [];
      for (const p of possiblePurchasers) {
        if (rest.startsWith(p + "_")) {
          purchaser = p;
          break;
        }
      }
      if (!purchaser) {
        purchaser = f.content?.pattern?.purchaser_key || "";
      }
      return { ...f, brand, purchaser };
    });

    const totalAll = processedFiles.length;
    const totalSuccess = processedFiles.filter(
      (f: any) => f.status === "success",
    ).length;
    const totalFailed = processedFiles.filter(
      (f: any) => f.status === "failed",
    ).length;
    const successRate =
      totalAll > 0 ? Math.round((totalSuccess / totalAll) * 100) : 0;

    const allBrands = Array.from(
      new Set(processedFiles.map((f: any) => f.brand).filter(Boolean)),
    );
    const allPurchasers = Array.from(
      new Set(processedFiles.map((f: any) => f.purchaser).filter(Boolean)),
    ).sort((a: any, b: any) => {
      const nameA = ViewHelper.formatPurchaserDisplayName(a).toLowerCase();
      const nameB = ViewHelper.formatPurchaserDisplayName(b).toLowerCase();
      if (nameA.includes("temp") && !nameB.includes("temp")) return 1;
      if (!nameA.includes("temp") && nameB.includes("temp")) return -1;
      return nameA.localeCompare(nameB);
    });

    const brandNamesMap: Record<string, string> = {};
    allBrands.forEach(
      (id: any) => (brandNamesMap[id] = ViewHelper.formatBrandDisplayName(id)),
    );

    const purchaserNamesMap: Record<string, string> = {};
    allPurchasers.forEach(
      (id: any) =>
        (purchaserNamesMap[id] = ViewHelper.formatPurchaserDisplayName(id)),
    );

    const brandPurchaserMap: Record<string, string[]> = {};
    processedFiles.forEach((f: any) => {
      if (f.brand && f.purchaser) {
        if (!brandPurchaserMap[f.brand]) brandPurchaserMap[f.brand] = [];
        if (!brandPurchaserMap[f.brand].includes(f.purchaser))
          brandPurchaserMap[f.brand].push(f.purchaser);
      }
    });

    const rowsJson = JSON.stringify(
      processedFiles.map((f: any) => ({
        filename: f.filename,
        brand: f.brand,
        purchaser: f.purchaser,
        status: f.status,
        mtime: f.mtime,
        patternKey: f.content?.pattern?.pattern_key ?? null,
        purchaserKey: f.content?.pattern?.purchaser_key ?? null,
        success: f.content?.success ?? null,
        json: f.content,
        runId: f.content?._runId || null,
        sourceRelativePath: f.content?._relativePath || null,
        sourceBrand: f.content?._brand || f.brand || null,
        sourcePurchaser: f.content?._purchaser || f.purchaser || null,
      })),
    );

    const explorerData = {
      rows: JSON.parse(rowsJson),
      config: {
        brands: allBrands,
        purchasers: allPurchasers,
        brandPurchaserMap,
        brandNames: brandNamesMap,
        purchaserNames: purchaserNamesMap,
      },
    };

    return PageLayout({
      title: "Data Explorer",
      content: DataExplorerView.render({
        totalAll,
        totalSuccess,
        totalFailed,
        successRate,
      }),
      activeTab: "explorer",
      logo: context.logo,
      smallLogo: context.smallLogo,
      favIcon: context.favIcon,
      styles: DataExplorerView.getStyles(),
      scripts: `
        <script>window.EXPLORER_DATA = ${JSON.stringify(explorerData)};</script>
        <script src="/assets/js/data-explorer.js"></script>
      `,
    });
  }

  async getInventoryPage(context: DashboardContext) {
    const data = await this.getInventoryData.execute();
    const { filesData, manifestEntries, history } = data;

    const allBrands = Array.from(
      new Set(filesData.map((f: any) => f.brand).filter(Boolean)),
    );
    const allPurchasers = Array.from(
      new Set(filesData.map((f: any) => f.purchaser).filter(Boolean)),
    ).sort((a: any, b: any) => {
      const nameA = ViewHelper.formatPurchaserDisplayName(a).toLowerCase();
      const nameB = ViewHelper.formatPurchaserDisplayName(b).toLowerCase();
      if (nameA.includes("temp") && !nameB.includes("temp")) return 1;
      if (!nameA.includes("temp") && nameB.includes("temp")) return -1;
      return nameA.localeCompare(nameB);
    });

    const brandNamesMap: Record<string, string> = {};
    allBrands.forEach(
      (id: any) => (brandNamesMap[id] = ViewHelper.formatBrandDisplayName(id)),
    );

    const purchaserNamesMap: Record<string, string> = {};
    allPurchasers.forEach(
      (id: any) =>
        (purchaserNamesMap[id] = ViewHelper.formatPurchaserDisplayName(id)),
    );

    const brandPurchaserMap: Record<string, string[]> = {};
    filesData.forEach((f: any) => {
      if (f.brand && f.purchaser) {
        if (!brandPurchaserMap[f.brand]) brandPurchaserMap[f.brand] = [];
        if (!brandPurchaserMap[f.brand].includes(f.purchaser))
          brandPurchaserMap[f.brand].push(f.purchaser);
      }
    });

    const totalSize = filesData.reduce(
      (acc: number, f: any) => acc + (f.size || 0),
      0,
    );
    const totalSizeStr = (totalSize / (1024 * 1024)).toFixed(1) + " MB";

    const inventoryData = {
      files: filesData,
      history: history,
      config: {
        brands: allBrands,
        purchasers: allPurchasers,
        brandPurchaserMap,
        brandNames: brandNamesMap,
        purchaserNames: purchaserNamesMap,
      },
    };

    return PageLayout({
      title: "Staging Inventory",
      content: InventoryView.render({
        totalFiles: filesData.length,
        totalSizeStr,
        manifestEntries,
      }),
      activeTab: "inventory",
      logo: context.logo,
      smallLogo: context.smallLogo,
      favIcon: context.favIcon,
      styles: InventoryView.getStyles(),
      scripts: `
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
        <script>window.INVENTORY_DATA = ${JSON.stringify(inventoryData)};</script>
        <script src="/assets/js/inventory.js"></script>
      `,
    });
  }

  async getHomePage(context: DashboardContext) {
    const brands = Object.keys(context.brandPurchasers).sort();
    const allPurchasers = Array.from(
      new Set(Object.values(context.brandPurchasers).flat()),
    ).sort();

    return PageLayout({
      title: "IntelliExtract Runner",
      content: DashboardView.render({
        brands: brands,
        purchasers: allPurchasers,
      }),
      activeTab: "dashboard",
      logo: context.logo,
      smallLogo: context.smallLogo,
      favIcon: context.favIcon,
      styles: DashboardView.getStyles(),
      scripts: `
        <script>
          window.BRAND_PURCHASERS = ${JSON.stringify(context.brandPurchasers)};
        </script>
        <script src="/assets/js/dashboard.js"></script>
      `,
    });
  }
}
