import { AppUtils } from "./common.js";
import { AppIcons } from "./icons.js";

/**
 * Operation Data Explorer Logic
 */
const EXPLORER_DATA = window.EXPLORER_DATA || { rows: [], config: {} };
var ALL_ROWS = EXPLORER_DATA.rows;
var CONFIG = EXPLORER_DATA.config;

var PAGE_SIZE = 20;
var currentPage = 1;
var currentFilter = "all";
var currentSearch = "";
var expandedRows = new Set();
var selectedBrands = [];
var selectedPurchasers = [];
var currentSortField = "mtime";
var currentSortOrder = "desc";

// --- Initializer ---
document.addEventListener("DOMContentLoaded", () => {
  initFilters();
  updateSortUI();
  render();
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
  if (!bTrigger) return;

  bTrigger.onclick = (e) => {
    e.stopPropagation();
    brandPanel.classList.toggle("open");
    document
      .getElementById("purchaser-dropdown-panel")
      .classList.remove("open");
  };

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
  render();
}

window.resetFilters = function () {
  document
    .querySelectorAll(".filter-dropdown-panel input")
    .forEach((i) => (i.checked = false));
  selectedBrands = [];
  selectedPurchasers = [];
  updateFilters();
};

// --- Syntax Highlighting ---
function syntaxHighlight(json) {
  const str = JSON.stringify(json, null, 2);
  if (str.length > 80000) return AppUtils.esc(str);
  return str.replace(
    /("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,
    function (match) {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = "json-key";
        else cls = "json-string";
      } else if (/true/.test(match)) cls = "json-bool-true";
      else if (/false/.test(match)) cls = "json-bool-false";
      else if (/null/.test(match)) cls = "json-null";
      return '<span class="' + cls + '">' + AppUtils.esc(match) + "</span>";
    },
  );
}

// --- Data & Rendering ---
function getFilteredRows() {
  var filtered = ALL_ROWS.filter(function (r) {
    if (currentFilter !== "all" && r.status !== currentFilter) return false;
    if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand))
      return false;
    if (
      selectedPurchasers.length > 0 &&
      !selectedPurchasers.includes(r.purchaser)
    )
      return false;
    if (currentSearch) {
      var q = currentSearch.toLowerCase();
      var haystack = (
        r.filename +
        " " +
        (r.runId || "") +
        " " +
        (r.patternKey || "") +
        " " +
        (r.purchaserKey || "")
      ).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (currentSortField) {
    filtered.sort(function (a, b) {
      var valA = a[currentSortField];
      var valB = b[currentSortField];
      if (currentSortField === "purchaserKey") {
        valA = (
          CONFIG.purchaserNames[a.purchaserKey] ||
          a.purchaserKey ||
          ""
        ).toLowerCase();
        valB = (
          CONFIG.purchaserNames[b.purchaserKey] ||
          b.purchaserKey ||
          ""
        ).toLowerCase();
      } else if (typeof valA === "string") {
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

function render() {
  var filtered = getFilteredRows();
  var total = filtered.length;

  const baseFilter = ALL_ROWS.filter((r) => {
    if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand))
      return false;
    if (
      selectedPurchasers.length > 0 &&
      !selectedPurchasers.includes(r.purchaser)
    )
      return false;
    if (currentSearch) {
      var q = currentSearch.toLowerCase();
      var haystack = (
        r.filename +
        " " +
        (r.runId || "") +
        " " +
        (r.patternKey || "") +
        " " +
        (r.purchaserKey || "")
      ).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const succCount = baseFilter.filter((r) => r.status === "success").length;
  const failCount = baseFilter.filter((r) => r.status === "failed").length;
  const allCount = baseFilter.length;
  const rate = allCount > 0 ? Math.round((succCount / allCount) * 100) : 0;

  [
    "c-all",
    "c-succ",
    "c-fail",
    "tot-val",
    "succ-val",
    "fail-val",
    "rate-val",
    "operation-count-label",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "c-all") el.innerText = allCount;
    if (id === "c-succ") el.innerText = succCount;
    if (id === "c-fail") el.innerText = failCount;
    if (id === "tot-val") el.innerText = allCount;
    if (id === "succ-val") el.innerText = succCount;
    if (id === "fail-val") el.innerText = failCount;
    if (id === "rate-val") el.innerText = rate + "%";
    if (id === "operation-count-label")
      el.innerText = allCount + " operation(s)";
  });

  var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * PAGE_SIZE;
  var page = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById("results-info").textContent =
    `Showing ${total === 0 ? 0 : start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} results`;

  var tbody = document.getElementById("table-body");
  if (page.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state"><div class="icon">📂</div><p>No extraction results match your filter.</p></div></td></tr>';
    document.getElementById("pagination-bar").innerHTML = "";
    return;
  }

  tbody.innerHTML = page
    .map((r) => {
      const globalIdx = ALL_ROWS.indexOf(r);
      const badge =
        r.status === "success"
          ? '<span class="badge badge-success">Success</span>'
          : '<span class="badge badge-failed">Failed</span>';
      const expandIcon =
        '<span class="expand-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>';
      let sourceBtn = "";
      if (r.sourceRelativePath) {
        sourceBtn = `<button class="btn-download-row source-btn" onclick="event.stopPropagation(); downloadSource(${globalIdx})">${AppIcons.DOWNLOAD} SOURCE</button>`;
      }

      return `
        <tr data-idx="${globalIdx}">
          <td class="toggle-cell">${expandIcon}</td>
          <td class="time-cell">${AppUtils.esc(AppUtils.formatTimeIST(r.mtime))}</td>
          <td class="filename-cell">${AppUtils.esc(r.filename)}</td>
          <td style="font-size:0.75rem; font-weight:700; color:var(--primary);">${AppUtils.esc(r.runId || "—")}</td>
          <td class="pattern-cell"><code>${AppUtils.esc(r.patternKey || "—")}</code></td>
          <td style="font-size:0.72rem; color:var(--text-secondary);">${AppUtils.esc(CONFIG.purchaserNames[r.purchaserKey] || r.purchaserKey || "—")}</td>
          <td>${badge}</td>
          <td class="action-cell">
            <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
              <button class="btn-download-row" onclick="event.stopPropagation(); downloadRow(${globalIdx})">${AppIcons.DOWNLOAD} JSON</button>
              ${sourceBtn}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-idx]").forEach(function (tr) {
    tr.onclick = function () {
      var idx = parseInt(this.getAttribute("data-idx"), 10);
      var existingExpand = tbody.querySelector(
        'tr.expand-row[data-for="' + idx + '"]',
      );
      if (existingExpand) {
        var container = existingExpand.querySelector(".expand-row-content");
        if (container) {
          // Smooth collapse
          const currentH = container.scrollHeight;
          container.style.height = currentH + "px";
          container.offsetHeight; // reflow
          container.style.height = "0";
          container.style.opacity = "0";

          setTimeout(() => {
            existingExpand.remove();
          }, 350);
        } else {
          existingExpand.remove();
        }
        this.classList.remove("expanded");
        expandedRows.delete(idx);
      } else {
        var r = ALL_ROWS[idx];
        var expandTr = document.createElement("tr");
        expandTr.className = "expand-row";
        expandTr.setAttribute("data-for", idx);
        expandTr.innerHTML =
          '<td colspan="8"><div class="expand-row-content"><div class="json-loader"><div class="json-spinner"></div><span>Loading...</span></div></div></td>';
        this.parentNode.insertBefore(expandTr, this.nextSibling);

        var container = expandTr.querySelector(".expand-row-content");
        // Smooth expand
        const highlighted = syntaxHighlight(r.json);
        const viewerHtml = `<div class="json-viewer"><pre>${highlighted}</pre></div>`;

        // Temporarily inject to measure height
        const temp = document.createElement("div");
        temp.style.position = "absolute";
        temp.style.visibility = "hidden";
        temp.style.width = container.offsetWidth + "px";
        temp.innerHTML = viewerHtml;
        document.body.appendChild(temp);
        const targetH = temp.scrollHeight;
        document.body.removeChild(temp);

        this.classList.add("expanded");
        expandedRows.add(idx);

        requestAnimationFrame(() => {
          container.innerHTML = viewerHtml;
          container.style.height = targetH + "px";
          container.style.opacity = "1";
        });
      }
    };
  });

  const bar = document.getElementById("pagination-bar");
  AppUtils.renderPagination(bar, total, currentPage, PAGE_SIZE, (p) => {
    currentPage = p;
    expandedRows.clear();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// --- Actions ---
window.handleSort = function (field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortField = field;
    currentSortOrder = "asc";
  }
  updateSortUI();
  currentPage = 1;
  render();
};

function updateSortUI() {
  document.querySelectorAll(".data-table thead th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
  });
  const currentTh = document.getElementById("sort-" + currentSortField);
  if (currentTh) {
    currentTh.classList.add(
      currentSortOrder === "asc" ? "sort-asc" : "sort-desc",
    );
  }
}

window.downloadRow = function (idx) {
  const r = ALL_ROWS[idx];
  if (!r) return;
  const blob = new Blob([JSON.stringify(r.json, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.downloadSource = function (idx) {
  const r = ALL_ROWS[idx];
  if (!r || !r.sourceRelativePath) return;
  const fullPath =
    "output/staging/" + r.sourceBrand + "/" + r.sourceRelativePath;
  window.location.href =
    "/api/download-file?file=" + encodeURIComponent(fullPath);
};

window.exportBatch = async function (type) {
  const filtered = getFilteredRows();
  if (filtered.length === 0) return;

  const files = filtered
    .map((r) => {
      if (type === "source") {
        return r.sourceRelativePath
          ? "output/staging/" + r.sourceBrand + "/" + r.sourceRelativePath
          : null;
      } else {
        const statusDir = r.status === "success" ? "succeeded" : "failed";
        return "output/extractions/" + statusDir + "/" + r.filename;
      }
    })
    .filter(Boolean);

  if (files.length === 0) {
    alert("No " + type + " files available for export in this view.");
    return;
  }

  const btn = document.getElementById("export-" + type + "-btn");
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
          "intelliextract_" +
          type +
          "_" +
          new Date().toISOString().split("T")[0],
      }),
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "intelliextract_" + type + "_" + new Date().getTime() + ".zip";
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

document.querySelectorAll(".tab-btn").forEach(function (btn) {
  btn.onclick = function () {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
    currentFilter = this.getAttribute("data-filter");
    currentPage = 1;
    expandedRows.clear();
    render();
  };
});

var searchTimer;
const searchInput = document.getElementById("search-input");
if (searchInput) {
  searchInput.oninput = function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = this.value;
      currentPage = 1;
      expandedRows.clear();
      render();
    }, 250);
  };
}

// Export to global scope if needed by HTML attributes
window.resetFilters = resetFilters;
window.handleSort = handleSort;
window.downloadRow = downloadRow;
window.downloadSource = downloadSource;
window.exportBatch = exportBatch;
