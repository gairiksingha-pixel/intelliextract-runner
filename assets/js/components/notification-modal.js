import { AppUtils } from "../common.js";

/**
 * Notification Settings Modal Component
 */
export function initNotificationModal() {
  const overlay = document.getElementById("notification-modal-overlay");
  const closeIcon = document.getElementById("notification-modal-close-icon");
  const cancelBtn = document.getElementById("notification-modal-cancel");
  const saveBtn = document.getElementById("notification-save-btn");
  const emailInput = document.getElementById("recipient-email-input");

  if (!overlay) return;

  const close = () => {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  };

  const openLogic = () => {
    fetch("/api/email-config")
      .then((r) => r.json())
      .then((data) => {
        if (emailInput && data.recipientEmail)
          emailInput.value = data.recipientEmail;
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
      })
      .catch((e) => {
        console.warn("Failed to load config, opening anyway:", e);
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
      });
  };

  window.openNotificationSettings = openLogic;

  if (closeIcon) closeIcon.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  if (saveBtn) {
    saveBtn.onclick = () => {
      const rawValue = emailInput ? emailInput.value.trim() : "";
      if (rawValue) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emails = rawValue
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
        for (const email of emails) {
          if (!emailRegex.test(email)) {
            AppUtils.showAlert(
              "Validation Error",
              `Invalid email address: ${email}`,
              true,
            );
            return;
          }
        }
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = "<span>Saving...</span>";

      fetch("/api/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: rawValue }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            AppUtils.showAlert(
              "Settings Saved",
              "Notification settings saved successfully!",
              false,
            );
            close();
          } else {
            AppUtils.showAlert("Save Failed", "Failed to save settings.", true);
          }
        })
        .catch((e) => AppUtils.showAlert("Error", e.message, true))
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.innerHTML = "<span>Save</span>";
        });
    };
  }
}

// Export to global scope
window.initNotificationModal = initNotificationModal;
