import { AppUtils } from "./common.js";
import { AppIcons } from "./icons.js";

/**
 * Staging Inventory Report Logic
 */
const historyData = window.INVENTORY_DATA.history;
const ALL_FILES = window.INVENTORY_DATA.files;
const CONFIG = window.INVENTORY_DATA.config;

let currentPage = 1;
const pageSize = 20;
let selectedBrands = [];
let selectedPurchasers = [];
let currentSearch = "";
let historyChartInstance = null;
let currentSortField = "mtime";
let currentSortOrder = "desc";

// --- Initializer ---
document.addEventListener("DOMContentLoaded", () => {
  initFilters();
  updateSortUI();
  renderTable();
  updateCharts();
});

// --- Home Navigation ---
function goToHome() {
  AppUtils.showLoader();
  try {
    if (window.parent && typeof window.parent.closeReportView === "function") {
      window.parent.closeReportView();
      return;
    }
  } catch (e) {}
  window.location.href = "/";
}

window.addEventListener("popstate", goToHome);

// --- Filters ---
function initFilters() {
  const brandPanel = document.getElementById("brand-dropdown-panel");
  const bTrigger = document.getElementById("brand-dropdown-trigger");
  if (bTrigger) {
    bTrigger.onclick = (e) => {
      e.stopPropagation();
      brandPanel.classList.toggle("open");
      document
        .getElementById("purchaser-dropdown-panel")
        .classList.remove("open");
    };
  }

  CONFIG.brands.forEach((b) => {
    const div = document.createElement("div");
    div.className = "filter-dropdown-option";
    const displayName = CONFIG.brandNames[b] || b;
    div.innerHTML = `<input type="checkbox" value="${AppUtils.esc(b)}"> <span>${AppUtils.esc(displayName)}</span>`;
    div.onclick = (e) => {
      e.stopPropagation();
      const cb = div.querySelector("input");
      if (e.target !== cb) cb.checked = !cb.checked;
      updateFilters();
    };
    brandPanel.appendChild(div);
  });

  const purchaserPanel = document.getElementById("purchaser-dropdown-panel");
  const pTrigger = document.getElementById("purchaser-dropdown-trigger");
  if (pTrigger) {
    pTrigger.onclick = (e) => {
      e.stopPropagation();
      purchaserPanel.classList.toggle("open");
      document.getElementById("brand-dropdown-panel").classList.remove("open");
    };
  }

  CONFIG.purchasers.forEach((p) => {
    const div = document.createElement("div");
    div.className = "filter-dropdown-option";
    const displayName = CONFIG.purchaserNames[p] || p;
    div.innerHTML = `<input type="checkbox" value="${AppUtils.esc(p)}"> <span>${AppUtils.esc(displayName)}</span>`;
    div.onclick = (e) => {
      e.stopPropagation();
      const cb = div.querySelector("input");
      if (e.target !== cb) cb.checked = !cb.checked;
      updateFilters();
    };
    purchaserPanel.appendChild(div);
  });

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentSearch = e.target.value.toLowerCase();
      currentPage = 1;
      renderTable();
    };
  }

  // Ensure dropdowns don't close when clicking labels/inputs
  [brandPanel, purchaserPanel, bTrigger, pTrigger].forEach((el) => {
    el?.addEventListener("click", (e) => e.stopPropagation());
  });

  window.addEventListener("click", () => {
    if (brandPanel) brandPanel.classList.remove("open");
    if (purchaserPanel) purchaserPanel.classList.remove("open");
  });
}

function updateFilters() {
  selectedBrands = Array.from(
    document.querySelectorAll("#brand-dropdown-panel input:checked"),
  ).map((i) => i.value);
  selectedPurchasers = Array.from(
    document.querySelectorAll("#purchaser-dropdown-panel input:checked"),
  ).map((i) => i.value);

  const pOptions = document.querySelectorAll(
    "#purchaser-dropdown-panel .filter-dropdown-option",
  );
  pOptions.forEach((opt) => {
    const val = opt.querySelector("input").value;
    let visible = selectedBrands.length === 0;
    if (!visible) {
      for (const b of selectedBrands) {
        if (
          CONFIG.brandPurchaserMap[b] &&
          CONFIG.brandPurchaserMap[b].includes(val)
        ) {
          visible = true;
          break;
        }
      }
    }
    opt.style.display = visible ? "flex" : "none";
    if (!visible) opt.querySelector("input").checked = false;
  });

  const bTrigger = document.getElementById("brand-dropdown-trigger");
  if (bTrigger) {
    bTrigger.innerText =
      selectedBrands.length === 0
        ? "Select Brand"
        : selectedBrands.length === 1
          ? CONFIG.brandNames[selectedBrands[0]] || selectedBrands[0]
          : selectedBrands.length + " Brands";
  }

  const pTrigger = document.getElementById("purchaser-dropdown-trigger");
  if (pTrigger) {
    pTrigger.innerText =
      selectedPurchasers.length === 0
        ? "Select Purchaser"
        : selectedPurchasers.length === 1
          ? CONFIG.purchaserNames[selectedPurchasers[0]] ||
            selectedPurchasers[0]
          : selectedPurchasers.length + " Purchasers";
  }

  currentPage = 1;
  renderTable();
  updateCharts();
}

// --- Data & Table ---
function getFilteredFiles() {
  const filtered = ALL_FILES.filter((f) => {
    if (selectedBrands.length > 0 && !selectedBrands.includes(f.brand))
      return false;
    if (
      selectedPurchasers.length > 0 &&
      !selectedPurchasers.includes(f.purchaser)
    )
      return false;
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      const haystack = (f.path + " " + (f.runId || "")).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (currentSortField) {
    filtered.sort((a, b) => {
      let valA = a[currentSortField];
      let valB = b[currentSortField];
      if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = (valB || "").toLowerCase();
      }
      if (valA < valB) return currentSortOrder === "asc" ? -1 : 1;
      if (valA > valB) return currentSortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }
  return filtered;
}

function renderTable() {
  const tbody = document.getElementById("files-body");
  if (!tbody) return;

  const filtered = getFilteredFiles();

  ["tot-files", "tot-size", "filter-val", "operation-count-label"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === "tot-files") el.innerText = filtered.length;
      if (id === "tot-size") {
        const bytes = filtered.reduce((acc, f) => acc + (f.size || 0), 0);
        el.innerText = (bytes / (1024 * 1024)).toFixed(1) + " MB";
      }
      if (id === "filter-val")
        el.innerText =
          selectedBrands.length || selectedPurchasers.length || currentSearch
            ? "Active"
            : "All";
      if (id === "operation-count-label")
        el.innerText = "Staging: " + filtered.length + " file(s)";
    },
  );

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align: center; padding: 2rem;">No files found for selected filters.</td></tr>';
    const pContainer = document.getElementById("pagination");
    if (pContainer) pContainer.innerHTML = "";
    return;
  }

  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, filtered.length);
  const page = filtered.slice(start, end);

  tbody.innerHTML = page
    .map(
      (f) => `
    <tr>
      <td>${AppUtils.esc(f.path)}</td>
      <td style="font-weight:700; color:var(--primary); font-size:0.85rem">${AppUtils.esc(f.runId || "—")}</td>
      <td>${f.size.toLocaleString()}</td>
      <td>${AppUtils.formatTimeIST(f.mtime)}</td>
      <td class="action-cell">
        <a href="/api/download-file?file=${encodeURIComponent("output/staging/" + f.path)}" class="action-btn" title="Download File">
          ${AppIcons.DOWNLOAD}
        </a>
      </td>
    </tr>
  `,
    )
    .join("");

  const info = document.getElementById("results-info");
  if (info) {
    info.innerText = `Showing ${filtered.length ? start + 1 : 0}-${end} of ${filtered.length} file(s)`;
  }

  const container = document.getElementById("pagination");
  AppUtils.renderPagination(
    container,
    filtered.length,
    currentPage,
    pageSize,
    (p) => {
      currentPage = p;
      renderTable();
      const title = document.getElementById("files-title");
      if (title) title.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  );
}

// --- Sort & Export ---
window.handleSort = function (field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortField = field;
    currentSortOrder = "asc";
  }
  updateSortUI();
  currentPage = 1;
  renderTable();
};

function updateSortUI() {
  document.querySelectorAll("#files-table thead th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
  });
  const currentTh = document.getElementById("sort-" + currentSortField);
  if (currentTh) {
    currentTh.classList.add(
      currentSortOrder === "asc" ? "sort-asc" : "sort-desc",
    );
  }
}

window.exportBatch = async function () {
  const filtered = getFilteredFiles();
  if (filtered.length === 0) return;

  const files = filtered.map((f) => "output/staging/" + f.path);
  const btn = document.getElementById("export-zip-btn");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = "Exporting...";
  btn.disabled = true;

  try {
    const response = await fetch("/api/export-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files,
        zipName:
          "intelliextract_inventory_" + new Date().toISOString().split("T")[0],
      }),
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory_export_" + new Date().getTime() + ".zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    alert("Export failed: " + e.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
};

window.resetFilters = function () {
  document
    .querySelectorAll(".filter-dropdown-panel input")
    .forEach((i) => (i.checked = false));
  selectedBrands = [];
  selectedPurchasers = [];
  updateFilters();
};

// --- Charts ---
function updateCharts() {
  const canvas = document.getElementById("historyChart");
  if (!canvas || !window.Chart || historyData.length === 0) return;

  const filteredHistory = historyData.filter((h) => {
    if (selectedBrands.length === 0 && selectedPurchasers.length === 0)
      return true;
    const brands = Array.isArray(h.brands) ? h.brands : [];
    const purchasers = Array.isArray(h.purchasers)
      ? h.purchasers
      : brands.map(() => "");
    for (let i = 0; i < brands.length; i++) {
      const b = brands[i] || "";
      const p = purchasers[i] || "";
      const brandMatch =
        selectedBrands.length === 0 || selectedBrands.includes(b);
      const purchaserMatch =
        selectedPurchasers.length === 0 || selectedPurchasers.includes(p);
      if (brandMatch && purchaserMatch) return true;
    }
    return false;
  });

  const labels = filteredHistory.map((d) => {
    const date = new Date(d.timestamp);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  });

  if (historyChartInstance) {
    historyChartInstance.destroy();
    historyChartInstance = null;
  }

  const card = canvas.closest(".chart-card");
  if (filteredHistory.length === 0) {
    if (card && !card.querySelector(".chart-empty-msg")) {
      const msg = document.createElement("p");
      msg.className = "chart-empty-msg";
      msg.style.cssText =
        "text-align:center;color:#94a3b8;font-size:0.85rem;padding:1rem 0;margin:0";
      msg.textContent = "No download history for the selected filter.";
      card.appendChild(msg);
    }
    return;
  }

  if (card) {
    const msg = card.querySelector(".chart-empty-msg");
    if (msg) msg.remove();
  }

  const ctx = canvas.getContext("2d");
  const createGrad = (c1, c2) => {
    const g = ctx.createLinearGradient(0, 0, 0, 400);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    return g;
  };

  historyChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Downloaded",
          data: filteredHistory.map((d) => d.synced),
          backgroundColor: createGrad("#2d9d5f", "#1e6b41"),
          borderRadius: 4,
        },
        {
          label: "Skipped",
          data: filteredHistory.map((d) => d.skipped),
          backgroundColor: createGrad("#94a3b8", "#64748b"),
          borderRadius: 4,
        },
        {
          label: "Errors",
          data: filteredHistory.map((d) => d.errors),
          backgroundColor: createGrad("#ef4444", "#991b1b"),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { weight: "600" },
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
    },
  });
}
