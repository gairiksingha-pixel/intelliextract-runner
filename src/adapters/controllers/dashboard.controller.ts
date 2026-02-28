import { GetExtractionDataUseCase } from "../../core/use-cases/get-extraction-data.use-case.js";
import { GetInventoryDataUseCase } from "../../core/use-cases/get-inventory-data.use-case.js";
import { PageLayout } from "../../infrastructure/views/page-layout.js";
import { DataExplorerView } from "../../infrastructure/views/data-explorer.view.js";
import { InventoryView } from "../../infrastructure/views/inventory.view.js";
import { DashboardView } from "../../infrastructure/views/dashboard.view.js";
import { ViewHelper } from "../../infrastructure/views/view.helper.js";
import { ExplorerDataDTO, InventoryDataDTO } from "../../core/domain/types.js";

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
    const rows = await this.getExtractionData.execute(context.brandPurchasers);

    const totalAll = rows.length;
    const totalSuccess = rows.filter((f) => f.status === "success").length;
    const totalFailed = rows.filter((f) => f.status === "failed").length;
    const successRate =
      totalAll > 0 ? Math.round((totalSuccess / totalAll) * 100) : 0;

    const allBrands = Array.from(
      new Set(rows.map((f) => f.brand).filter(Boolean)),
    );
    const allPurchasers = Array.from(
      new Set(rows.map((f) => f.purchaser).filter(Boolean)),
    ).sort((a: string, b: string) => {
      const nameA = ViewHelper.formatPurchaserDisplayName(a).toLowerCase();
      const nameB = ViewHelper.formatPurchaserDisplayName(b).toLowerCase();
      if (nameA.includes("temp") && !nameB.includes("temp")) return 1;
      if (!nameA.includes("temp") && nameB.includes("temp")) return -1;
      return nameA.localeCompare(nameB);
    });

    const brandNamesMap: Record<string, string> = {};
    allBrands.forEach(
      (id) => (brandNamesMap[id] = ViewHelper.formatBrandDisplayName(id)),
    );

    const purchaserNamesMap: Record<string, string> = {};
    allPurchasers.forEach(
      (id) =>
        (purchaserNamesMap[id] = ViewHelper.formatPurchaserDisplayName(id)),
    );

    const brandPurchaserMap: Record<string, string[]> = {};
    rows.forEach((f) => {
      if (f.brand && f.purchaser) {
        if (!brandPurchaserMap[f.brand]) brandPurchaserMap[f.brand] = [];
        if (!brandPurchaserMap[f.brand].includes(f.purchaser))
          brandPurchaserMap[f.brand].push(f.purchaser);
      }
    });

    const explorerData: ExplorerDataDTO = {
      rows,
      config: {
        brands: allBrands,
        purchasers: allPurchasers,
        brandPurchaserMap,
        brandNames: brandNamesMap,
        purchaserNames: purchaserNamesMap,
      },
      stats: {
        totalAll,
        totalSuccess,
        totalFailed,
        successRate,
      },
    };

    return PageLayout({
      title: "Data Explorer",
      content: DataExplorerView.render(explorerData.stats),
      activeTab: "explorer",
      logo: context.logo,
      smallLogo: context.smallLogo,
      favIcon: context.favIcon,
      styles: DataExplorerView.getStyles(),
      scripts: `
        <script>window.EXPLORER_DATA = ${JSON.stringify(explorerData)};</script>
        <script type="module" src="/assets/js/data-explorer.js"></script>
      `,
    });
  }

  async getInventoryPage(context: DashboardContext) {
    const inventoryData = await this.getInventoryData.execute();

    // Enrich config with display names
    inventoryData.config.brands.forEach((id) => {
      inventoryData.config.brandNames[id] =
        ViewHelper.formatBrandDisplayName(id);
    });
    inventoryData.config.purchasers.forEach((id) => {
      inventoryData.config.purchaserNames[id] =
        ViewHelper.formatPurchaserDisplayName(id);
    });

    // Sort purchasers by display name rules
    inventoryData.config.purchasers.sort((a, b) => {
      const nameA = inventoryData.config.purchaserNames[a].toLowerCase();
      const nameB = inventoryData.config.purchaserNames[b].toLowerCase();
      if (nameA.includes("temp") && !nameB.includes("temp")) return 1;
      if (!nameA.includes("temp") && nameB.includes("temp")) return -1;
      return nameA.localeCompare(nameB);
    });

    return PageLayout({
      title: "Staging Inventory",
      content: InventoryView.render({
        totalFiles: inventoryData.stats.totalFiles,
        totalSizeStr: inventoryData.stats.totalSizeStr,
        manifestEntries: Object.keys(inventoryData.manifestEntries).length,
      }),
      activeTab: "inventory",
      logo: context.logo,
      smallLogo: context.smallLogo,
      favIcon: context.favIcon,
      styles: InventoryView.getStyles(),
      scripts: `
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
        <script>window.INVENTORY_DATA = ${JSON.stringify(inventoryData)};</script>
        <script type="module" src="/assets/js/inventory.js"></script>
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
        <script type="module" src="/assets/js/components/notification-modal.js"></script>
        <script type="module" src="/assets/js/components/schedule-modal.js"></script>
        <script type="module" src="/assets/js/dashboard.js"></script>
      `,
    });
  }
}
