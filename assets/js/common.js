(function () {
  // Global Alert System
  let currentConfirmCallback = null;
  window._alertIsOpen = false;

  window.showAppAlert = function (title, message, options) {
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
        ? "var(--fail)"
        : "var(--primary)";
    }

    if (options.isConfirm) {
      if (cancelBtn) cancelBtn.style.display = "block";
      if (confirmText)
        confirmText.textContent = options.confirmText || "Confirm";
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
    window._alertIsOpen = true;
  };

  window.closeAppAlert = function () {
    const overlay = document.getElementById("app-alert-modal-overlay");
    if (!overlay) return;
    window._alertIsOpen = false;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  };

  // Keyboard accessibility
  window.addEventListener("keydown", (e) => {
    if (!window._alertIsOpen) return;
    if (e.key === "Escape") closeAppAlert();
    if (e.key === "Enter") {
      const btn = document.getElementById("app-alert-confirm-btn");
      if (btn) btn.click();
    }
  });

  // Export common utilities
  window.utils = {
    escapeHtml: (str) => {
      if (!str) return "";
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    },
  };
})();
