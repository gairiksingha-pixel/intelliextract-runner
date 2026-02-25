(function () {
  var ALL_ROWS = window.EXPLORER_DATA.rows;
  var CONFIG = window.EXPLORER_DATA.config;

  var PAGE_SIZE = 20;
  var currentPage = 1;
  var currentFilter = "all";
  var currentSearch = "";
  var expandedRows = new Set();
  var selectedBrands = [];
  var selectedPurchasers = [];
  var currentSortField = "mtime";
  var currentSortOrder = "desc"; // 'asc' or 'desc'

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

  // Push a history entry
  if (window.history && window.history.pushState) {
    history.pushState({ page: "report" }, document.title, window.location.href);
  }
  window.addEventListener("popstate", function () {
    goToHome();
  });

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  }

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
    pTrigger.onclick = (e) => {
      e.stopPropagation();
      purchaserPanel.classList.toggle("open");
      document.getElementById("brand-dropdown-panel").classList.remove("open");
    };

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

    window.onclick = () => {
      brandPanel.classList.remove("open");
      purchaserPanel.classList.remove("open");
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
    bTrigger.innerText =
      selectedBrands.length === 0
        ? "Select Brand"
        : selectedBrands.length === 1
          ? CONFIG.brandNames[selectedBrands[0]] || selectedBrands[0]
          : selectedBrands.length + " Brands";

    const pTrigger = document.getElementById("purchaser-dropdown-trigger");
    pTrigger.innerText =
      selectedPurchasers.length === 0
        ? "Select Purchaser"
        : selectedPurchasers.length === 1
          ? CONFIG.purchaserNames[selectedPurchasers[0]] ||
            selectedPurchasers[0]
          : selectedPurchasers.length + " Purchasers";

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

  function syntaxHighlight(json) {
    var str = JSON.stringify(json, null, 2);
    if (str.length > 80000) return escHtml(str);
    return str.replace(
      /("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,
      function (match) {
        var cls = "json-number";
        if (/^"/.test(match)) {
          if (/:$/.test(match)) cls = "json-key";
          else cls = "json-string";
        } else if (/true/.test(match)) cls = "json-bool-true";
        else if (/false/.test(match)) cls = "json-bool-false";
        else if (/null/.test(match)) cls = "json-null";
        return '<span class="' + cls + '">' + escHtml(match) + "</span>";
      },
    );
  }

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
      a.download =
        "intelliextract_" + type + "_" + new Date().getTime() + ".zip";
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

    document.getElementById("c-all").innerText = allCount;
    document.getElementById("c-succ").innerText = succCount;
    document.getElementById("c-fail").innerText = failCount;
    document.getElementById("tot-val").innerText = allCount;
    document.getElementById("succ-val").innerText = succCount;
    document.getElementById("fail-val").innerText = failCount;
    document.getElementById("rate-val").innerText = rate + "%";
    document.getElementById("operation-count-label").innerText =
      allCount + " operation(s)";

    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * PAGE_SIZE;
    var page = filtered.slice(start, start + PAGE_SIZE);

    document.getElementById("results-info").textContent =
      "Showing " +
      (total === 0 ? 0 : start + 1) +
      "–" +
      Math.min(start + PAGE_SIZE, total) +
      " of " +
      total +
      " results";

    var tbody = document.getElementById("table-body");
    if (page.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8"><div class="empty-state"><div class="icon">📂</div><p>No extraction results match your filter.</p></div></td></tr>';
      document.getElementById("pagination-bar").innerHTML = "";
      return;
    }

    var html = "";
    page.forEach(function (r, idx) {
      var globalIdx = ALL_ROWS.indexOf(r);
      var badge =
        r.status === "success"
          ? '<span class="badge badge-success">Success</span>'
          : '<span class="badge badge-failed">Failed</span>';
      var expandIcon =
        '<span class="expand-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>';
      html += '<tr data-idx="' + globalIdx + '">';
      html += '<td class="toggle-cell">' + expandIcon + "</td>";
      html += '<td class="time-cell">' + escHtml(formatTime(r.mtime)) + "</td>";
      html += '<td class="filename-cell">' + escHtml(r.filename) + "</td>";
      html +=
        '<td style="font-size:0.75rem; font-weight:700; color:var(--primary);">' +
        escHtml(r.runId || "—") +
        "</td>";
      html +=
        '<td class="pattern-cell"><code>' +
        escHtml(r.patternKey || "—") +
        "</code></td>";
      html +=
        '<td style="font-size:0.72rem; color:var(--text-secondary);">' +
        escHtml(
          CONFIG.purchaserNames[r.purchaserKey] || r.purchaserKey || "—",
        ) +
        "</td>";
      html += "<td>" + badge + "</td>";
      var sourceBtn = "";
      if (r.sourceRelativePath) {
        sourceBtn =
          '<button class="btn-download-row" style="background: var(--accent-light); border-color: var(--primary); color: var(--primary); padding: 0.3rem 0.5rem;" onclick="event.stopPropagation(); downloadSource(' +
          globalIdx +
          ')" title="Download Source File">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> SOURCE</button>';
      }

      html +=
        '<td class="action-cell">' +
        '<div style="display: flex; gap: 6px; justify-content: center; align-items: center;">' +
        '<button class="btn-download-row" style="padding: 0.3rem 0.5rem;" onclick="event.stopPropagation(); downloadRow(' +
        globalIdx +
        ')" title="Download Extraction JSON">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> JSON</button>' +
        sourceBtn +
        "</div></td>";
      html += "</tr>";
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll("tr[data-idx]").forEach(function (tr) {
      tr.onclick = function () {
        var idx = parseInt(this.getAttribute("data-idx"), 10);
        var existingExpand = tbody.querySelector(
          'tr.expand-row[data-for="' + idx + '"]',
        );
        if (existingExpand) {
          var container = existingExpand.querySelector(".expand-row-content");
          if (container) {
            container.style.height = container.scrollHeight + "px";
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
          this.classList.add("expanded");
          expandedRows.add(idx);

          container.style.height = "60px";
          container.style.opacity = "1";

          setTimeout(() => {
            const highlighted = syntaxHighlight(r.json);
            container.innerHTML =
              '<div class="json-viewer" style="animation: slideDown 0.3s ease-out;"><pre>' +
              highlighted +
              "</pre></div>";

            const newHeight = Math.min(600, container.scrollHeight);
            container.style.height = newHeight + "px";

            setTimeout(() => {
              if (container.scrollHeight > 600) {
                container.style.height = "600px";
              } else {
                container.style.height = "auto";
              }
            }, 350);
          }, 60);
        }
      };
    });
    renderPagination(total, totalPages);
  }

  function renderPagination(total, totalPages) {
    var bar = document.getElementById("pagination-bar");
    if (totalPages <= 1) {
      bar.innerHTML = "";
      return;
    }
    var html =
      '<button class="pg-btn" ' +
      (currentPage === 1 ? "disabled" : "") +
      ' onclick="goPage(' +
      (currentPage - 1) +
      ')">&#8592; Prev</button>';
    var s = Math.max(1, currentPage - 2),
      e = Math.min(totalPages, currentPage + 2);
    if (s > 1)
      html +=
        '<button class="pg-btn" onclick="goPage(1)">1</button><span style="padding:0 5px">…</span>';
    for (var i = s; i <= e; i++)
      html +=
        '<button class="pg-btn ' +
        (i === currentPage ? "active" : "") +
        '" onclick="goPage(' +
        i +
        ')">' +
        i +
        "</button>";
    if (e < totalPages)
      html +=
        '<span style="padding:0 5px">…</span><button class="pg-btn" onclick="goPage(' +
        totalPages +
        ')">' +
        totalPages +
        "</button>";
    html +=
      '<button class="pg-btn" ' +
      (currentPage === totalPages ? "disabled" : "") +
      ' onclick="goPage(' +
      (currentPage + 1) +
      ')">Next &#8594;</button>';
    bar.innerHTML = html;
  }

  window.goPage = function (p) {
    currentPage = p;
    expandedRows.clear();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  initFilters();
  updateSortUI();
  render();
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
