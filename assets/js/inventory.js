(function () {
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
  let currentSortOrder = "desc"; // 'asc' or 'desc'

  function goToHome() {
    if (typeof showLoader === "function") showLoader();
    try {
      if (
        window.parent &&
        typeof window.parent.closeReportView === "function"
      ) {
        window.parent.closeReportView();
        return;
      }
    } catch (e) {}
    window.location.href = "/";
  }

  if (window.history && window.history.pushState) {
    history.pushState({ page: "report" }, document.title, window.location.href);
  }
  window.addEventListener("popstate", function () {
    goToHome();
  });

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

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
      div.innerHTML =
        '<input type="checkbox" value="' +
        b +
        '"> <span>' +
        displayName +
        "</span>";
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
        document
          .getElementById("brand-dropdown-panel")
          .classList.remove("open");
      };
    }

    CONFIG.purchasers.forEach((p) => {
      const div = document.createElement("div");
      div.className = "filter-dropdown-option";
      const displayName = CONFIG.purchaserNames[p] || p;
      div.innerHTML =
        '<input type="checkbox" value="' +
        p +
        '"> <span>' +
        displayName +
        "</span>";
      div.onclick = (e) => {
        e.stopPropagation();
        const cb = div.querySelector("input");
        if (e.target !== cb) cb.checked = !cb.checked;
        updateFilters();
      };
      purchaserPanel.appendChild(div);
    });

    document.getElementById("search-input").oninput = (e) => {
      currentSearch = e.target.value.toLowerCase();
      currentPage = 1;
      renderTable();
    };

    window.onclick = () => {
      if (brandPanel) brandPanel.classList.remove("open");
      if (purchaserPanel) purchaserPanel.classList.remove("open");
    };
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
    selectedPurchasers = Array.from(
      document.querySelectorAll("#purchaser-dropdown-panel input:checked"),
    ).map((i) => i.value);

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
            "intelliextract_inventory_" +
            new Date().toISOString().split("T")[0],
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
        var q = currentSearch.toLowerCase();
        var haystack = (f.path + " " + (f.runId || "")).toLowerCase();
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
    document
      .querySelectorAll("#files-table thead th.sortable")
      .forEach((th) => {
        th.classList.remove("sort-asc", "sort-desc");
      });
    const currentTh = document.getElementById("sort-" + currentSortField);
    if (currentTh) {
      currentTh.classList.add(
        currentSortOrder === "asc" ? "sort-asc" : "sort-desc",
      );
    }
  }

  function renderTable() {
    const tbody = document.getElementById("files-body");
    if (!tbody) return;

    const filtered = getFilteredFiles();

    const totFilesEl = document.getElementById("tot-files");
    if (totFilesEl) totFilesEl.innerText = filtered.length;

    const totSizeEl = document.getElementById("tot-size");
    if (totSizeEl) {
      const bytes = filtered.reduce((acc, f) => acc + (f.size || 0), 0);
      totSizeEl.innerText = (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    const filterValEl = document.getElementById("filter-val");
    if (filterValEl) {
      if (
        selectedBrands.length === 0 &&
        selectedPurchasers.length === 0 &&
        currentSearch === ""
      ) {
        filterValEl.innerText = "All";
      } else {
        filterValEl.innerText = "Active";
      }
    }

    const label = document.getElementById("operation-count-label");
    if (label) {
      label.innerText = "Staging: " + filtered.length + " file(s)";
    }

    const pContainer = document.getElementById("pagination");
    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align: center; padding: 2rem;">No files found for selected filters.</td></tr>';
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
          <td>${esc(f.path)}</td>
          <td style="font-weight:700; color:var(--primary); font-size:0.85rem">${esc(f.runId || "—")}</td>
          <td>${f.size.toLocaleString()}</td>
          <td>${new Date(f.mtime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
          <td class="action-cell">
            <a href="/api/download-file?file=${encodeURIComponent("output/staging/" + f.path)}" class="action-btn" title="Download File">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </a>
          </td>
        </tr>
      `,
      )
      .join("");

    const info = document.getElementById("results-info");
    if (info) {
      info.innerText =
        "Showing " +
        (filtered.length ? start + 1 : 0) +
        "-" +
        end +
        " of " +
        filtered.length +
        " file(s)";
    }

    renderPagination(filtered.length);
  }

  function renderPagination(totalCount) {
    const container = document.getElementById("pagination");
    if (!container) return;
    const totalPages = Math.ceil(totalCount / pageSize);
    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    let html = "";
    html +=
      '<button class="pg-btn" ' +
      (currentPage === 1 ? "disabled" : "") +
      ' onclick="goPage(' +
      (currentPage - 1) +
      ')">Prev</button>';

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - 2 && i <= currentPage + 2)
      ) {
        html +=
          '<button class="pg-btn ' +
          (i === currentPage ? "active" : "") +
          '" onclick="goPage(' +
          i +
          ')">' +
          i +
          "</button>";
      } else if (i === currentPage - 3 || i === currentPage + 3) {
        html +=
          '<span style="padding:0.5rem; color:var(--text-secondary)">...</span>';
      }
    }

    html +=
      '<button class="pg-btn" ' +
      (currentPage === totalPages ? "disabled" : "") +
      ' onclick="goPage(' +
      (currentPage + 1) +
      ')">Next</button>';
    container.innerHTML = html;
  }

  window.goPage = function (p) {
    currentPage = p;
    renderTable();
    const table = document.getElementById("files-title");
    if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function updateCharts() {
    const canvas = document.getElementById("historyChart");
    if (!canvas || historyData.length === 0) return;

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

    if (filteredHistory.length === 0) {
      const card = canvas.closest(".chart-card");
      if (card) {
        let msg = card.querySelector(".chart-empty-msg");
        if (!msg) {
          msg = document.createElement("p");
          msg.className = "chart-empty-msg";
          msg.style.cssText =
            "text-align:center;color:#94a3b8;font-size:0.85rem;padding:1rem 0;margin:0";
          card.appendChild(msg);
        }
        msg.textContent = "No download history for the selected filter.";
      }
      return;
    }

    const card = canvas.closest(".chart-card");
    if (card) {
      const msg = card.querySelector(".chart-empty-msg");
      if (msg) msg.remove();
    }

    const ctx = canvas.getContext("2d");
    const gradSynced = ctx.createLinearGradient(0, 0, 0, 400);
    gradSynced.addColorStop(0, "#2d9d5f");
    gradSynced.addColorStop(1, "#1e6b41");
    const gradSkipped = ctx.createLinearGradient(0, 0, 0, 400);
    gradSkipped.addColorStop(0, "#94a3b8");
    gradSkipped.addColorStop(1, "#64748b");
    const gradErrors = ctx.createLinearGradient(0, 0, 0, 400);
    gradErrors.addColorStop(0, "#ef4444");
    gradErrors.addColorStop(1, "#991b1b");

    historyChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Downloaded",
            data: filteredHistory.map((d) => d.synced),
            backgroundColor: gradSynced,
            borderRadius: 4,
          },
          {
            label: "Skipped",
            data: filteredHistory.map((d) => d.skipped),
            backgroundColor: gradSkipped,
            borderRadius: 4,
          },
          {
            label: "Errors",
            data: filteredHistory.map((d) => d.errors),
            backgroundColor: gradErrors,
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

  initFilters();
  updateSortUI();
  renderTable();
  updateCharts();
})();

(function () {
  function showLoader() {
    var l = document.getElementById("page-loader");
    if (l) l.style.display = "flex";
  }
  function hideLoader() {
    var l = document.getElementById("page-loader");
    if (l) {
      l.style.opacity = "0";
      setTimeout(function () {
        l.style.display = "none";
      }, 300);
    }
  }
  if (document.readyState === "complete") hideLoader();
  window.addEventListener("load", hideLoader);
  window.addEventListener("pageshow", hideLoader);
  setTimeout(hideLoader, 5000);
  document.addEventListener("click", function (e) {
    var t = e.target.closest("a");
    if (
      t &&
      t.href &&
      !t.href.startsWith("javascript:") &&
      !t.href.startsWith("#") &&
      t.target !== "_blank" &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      var currentUrl = window.location.href.split("#")[0].split("?")[0];
      var targetUrl = t.href.split("#")[0].split("?")[0];
      if (
        targetUrl !== currentUrl &&
        targetUrl !== currentUrl + "/" &&
        currentUrl !== targetUrl + "/"
      ) {
        showLoader();
      }
    }
  });
  document.addEventListener("submit", function () {
    showLoader();
  });
})();
