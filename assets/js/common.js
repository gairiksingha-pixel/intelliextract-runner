import { AppIcons } from "./icons.js";

/**
 * Common Utilities and Shared Logic for IntelliExtract
 */

// --- Global Alert System ---
let currentConfirmCallback = null;
let _alertIsOpen = false;

export function showAppAlert(title, message, options) {
  const overlay = document.getElementById("app-alert-modal-overlay");
  if (!overlay) return;

  const headerText = document.getElementById("app-alert-header-text");
  const msgEl = document.getElementById("app-alert-message");
  const badge = document.getElementById("app-alert-badge");
  const cancelBtn = document.getElementById("app-alert-cancel-btn");
  const confirmBtn = document.getElementById("app-alert-confirm-btn");
  const confirmText = document.getElementById("app-alert-confirm-text");

  if (typeof options === "boolean") options = { isError: options };
  options = options || {};

  if (headerText) headerText.textContent = title || "Notification";
  if (msgEl) msgEl.textContent = message || "";

  if (badge) {
    badge.textContent = options.isError
      ? "ERROR"
      : options.isConfirm
        ? "CONFIRM"
        : "INFO";
    badge.style.background = options.isError
      ? "#c62828"
      : options.isConfirm
        ? "#ff9800"
        : "var(--primary)";
  }

  if (options.isConfirm) {
    if (cancelBtn) cancelBtn.style.display = "block";
    if (confirmText) confirmText.textContent = options.confirmText || "Confirm";
    currentConfirmCallback = options.onConfirm || null;
  } else {
    if (cancelBtn) cancelBtn.style.display = "none";
    if (confirmText) confirmText.textContent = "Dismiss";
    currentConfirmCallback = null;
  }

  confirmBtn.onclick = () => {
    if (currentConfirmCallback) currentConfirmCallback();
    closeAppAlert();
  };

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (options.onCancel) options.onCancel();
      closeAppAlert();
    };
  }

  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  _alertIsOpen = true;
}

export function closeAppAlert() {
  const overlay = document.getElementById("app-alert-modal-overlay");
  if (!overlay) return;
  _alertIsOpen = false;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

window.addEventListener("keydown", (e) => {
  if (!_alertIsOpen) return;
  if (e.key === "Escape") closeAppAlert();
  if (e.key === "Enter") {
    const btn = document.getElementById("app-alert-confirm-btn");
    if (btn) btn.click();
  }
});

/**
 * Shared Application Utilities
 */
export const AppUtils = {
  /**
   * Show a unified application alert
   */
  showAlert: showAppAlert,

  /**
   * Escape HTML special characters
   */
  esc: function (str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Format Brand ID to Display Name
   */
  formatBrandName: function (brandId) {
    if (!brandId) return "";
    var b = brandId.toLowerCase();
    if (b.includes("no-cow")) return "No Cow";
    if (b.includes("sundia")) return "Sundia";
    if (b.includes("tractor-beverage")) return "Tractor";
    if (b === "p3" || b === "pipe") return "PIPE";
    return brandId;
  },

  /**
   * Format Purchaser ID to Display Name
   */
  formatPurchaserName: function (purchaserId) {
    if (!purchaserId) return "";
    var p = purchaserId.toLowerCase();
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
  },

  /**
   * Format Timestamp to IST Locale String
   */
  formatTimeIST: function (ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  },

  /**
   * Get numeric ordinal suffix (1st, 2nd, etc)
   */
  getOrdinalSuffix: function (day) {
    if (day > 3 && day < 21) return "th";
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  },

  /**
   * Format Date with Suffix (e.g. Feb 27th, 2026)
   */
  formatDateWithSuffix: function (dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr);
    var months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    var day = d.getDate();
    return (
      months[d.getMonth()] +
      " " +
      day +
      this.getOrdinalSuffix(day) +
      ", " +
      d.getFullYear()
    );
  },

  /**
   * Attach 'Select All' functionality to a dropdown panel
   */
  attachSelectAll: function (panelId, onToggle) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var allCb = panel.querySelector('input[value="ALL"]');
    if (!allCb) return;
    var otherCbs = Array.from(
      panel.querySelectorAll('input[type=checkbox]:not([value="ALL"])'),
    );
    allCb.onchange = function () {
      var checked = allCb.checked;
      otherCbs.forEach(function (cb) {
        cb.checked = checked;
      });
      if (onToggle) onToggle();
    };
    otherCbs.forEach(function (cb) {
      cb.onchange = function () {
        allCb.checked =
          otherCbs.length > 0 &&
          otherCbs.every(function (c) {
            return c.checked;
          });
        if (onToggle) onToggle();
      };
    });
    if (otherCbs.length > 0) {
      allCb.checked = otherCbs.every(function (c) {
        return c.checked;
      });
    }
  },

  /**
   * Loader Management
   */
  showLoader: function (loaderText) {
    var l = document.getElementById("page-loader");
    if (!l) return;
    var textEl = l.querySelector(".loader-text");
    if (textEl && loaderText) textEl.textContent = loaderText;
    else if (textEl) textEl.textContent = "Loading...";
    l.classList.remove("loader-hidden");
  },

  hideLoader: function () {
    var l = document.getElementById("page-loader");
    if (!l) return;
    l.classList.add("loader-hidden");
  },

  /**
   * Modal UI Helpers
   */
  updateModalTitle: function (text) {
    var el = document.getElementById("modal-title-text");
    if (el) el.textContent = text;
  },

  renderWithTransition: function (body, html, direction) {
    if (!body) return;
    var dirClass = direction === "left" ? "slide-left" : "slide-right";
    body.innerHTML =
      '<div class="modal-screen-animate ' + dirClass + '">' + html + "</div>";
  },

  renderPagination: function (container, total, page, limit, onPageClick) {
    if (!container) return;
    var totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }
    var html = "";
    html +=
      '<button class="pagination-btn" ' +
      (page === 1 ? "disabled" : "") +
      ' data-page="' +
      (page - 1) +
      '">' +
      AppIcons.CHEVRON_LEFT +
      " Previous</button>";

    var start = Math.max(1, page - 2);
    var end = Math.min(totalPages, page + 2);

    if (start > 1)
      html +=
        '<button class="pagination-btn" data-page="1">1</button><span>...</span>';
    for (var i = start; i <= end; i++) {
      html +=
        '<button class="pagination-btn ' +
        (i === page ? "active" : "") +
        '" data-page="' +
        i +
        '">' +
        i +
        "</button>";
    }
    if (end < totalPages)
      html +=
        '<span>...</span><button class="pagination-btn" data-page="' +
        totalPages +
        '">' +
        totalPages +
        "</button>";

    html +=
      '<button class="pagination-btn" ' +
      (page === totalPages ? "disabled" : "") +
      ' data-page="' +
      (page + 1) +
      '">Next ' +
      AppIcons.CHEVRON_RIGHT +
      "</button>";

    container.innerHTML = html;
    container.querySelectorAll(".pagination-btn").forEach(function (btn) {
      btn.onclick = function () {
        var p = parseInt(this.getAttribute("data-page"));
        if (p >= 1 && p <= totalPages && onPageClick) onPageClick(p);
      };
    });
  },
};

// --- Initializers & Global Listeners ---
document.addEventListener("DOMContentLoaded", function () {
  AppUtils.hideLoader();
});

window.addEventListener("load", function () {
  AppUtils.hideLoader();
});

// Safety timeout for loader
setTimeout(function () {
  AppUtils.hideLoader();
}, 5000);

// Global link click interceptor for smooth page transitions
// We intercept the click, show the loader, then navigate after a short delay
// so the spinner is actually visible before the browser unloads the page.
document.addEventListener("click", function (e) {
  var t = e.target.closest("a");
  if (
    !t ||
    !t.href ||
    t.href.startsWith("javascript:") ||
    t.href.startsWith("#") ||
    t.hasAttribute("download") ||
    t.target === "_blank" ||
    e.ctrlKey ||
    e.metaKey ||
    e.shiftKey
  ) {
    return;
  }

  var currentUrl = window.location.href.split("#")[0].split("?")[0];
  var targetUrl = t.href.split("#")[0].split("?")[0];
  var isSamePage =
    targetUrl === currentUrl ||
    targetUrl === currentUrl + "/" ||
    currentUrl === targetUrl + "/";

  if (!isSamePage) {
    e.preventDefault();
    var href = t.href;
    AppUtils.showLoader();
    // Give the browser one animation frame to paint the loader before navigating
    requestAnimationFrame(function () {
      setTimeout(function () {
        window.location.href = href;
      }, 80);
    });
  }
});

// Show loader on programmatic back/forward navigation
window.addEventListener("pageshow", function (e) {
  // If page restored from bfcache, force a reload so loader works correctly
  if (e.persisted) {
    AppUtils.hideLoader();
  }
});

// Backwards compatibility for legacy function names (Keep for now to avoid breaking existing code during transition)
window.AppUtils = AppUtils;
window.showAppAlert = showAppAlert;
window.closeAppAlert = closeAppAlert;
window.escapeHtml = AppUtils.esc;
window.formatBrandName = AppUtils.formatBrandName;
window.formatPurchaserName = AppUtils.formatPurchaserName;
