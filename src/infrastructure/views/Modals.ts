export const NotificationModal = () => `
  <div id="notification-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal" style="width: 450px; height: auto; max-height: 90vh" role="dialog" aria-modal="true" aria-labelledby="notification-modal-title">
      <div class="modal-header">
        <div class="modal-title" id="notification-modal-title">
          <span class="title-badge" style="background: #c62828">NOTIFY</span>
          <span>Automated Alert Setup</span>
        </div>
        <button type="button" id="notification-modal-close-icon" class="modal-close-icon" aria-label="Close dialog">&#10005;</button>
      </div>
      <div class="modal-body">
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem;">
          Configure who should be notified when an extractions operation encounters issues. Recipients will receive automated emails detailing any failures or files requiring manual review.
        </p>
        <div class="header-label" style="margin-bottom: 0.5rem; display: block">Recipient Email IDs</div>
        <input type="text" id="recipient-email-input" style="width: 100%; height: 42px; padding: 0 1rem; border: 1px solid var(--border-light); border-radius: 8px; font-family: inherit; font-size: 0.95rem; margin-bottom: 0.4rem; box-sizing: border-box;" placeholder="e.g. alerts@company.com, admin@site.com">
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Separate multiple emails with commas.</div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="notification-modal-cancel">Cancel</button>
        <button type="button" class="download-report-btn download-report-schedule-btn" id="notification-save-btn">
          <span>Save</span>
        </button>
      </div>
    </div>
  </div>
`;

export const AlertModal = () => `
  <div id="app-alert-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal" style="width: 420px; height: auto; max-height: 90vh; min-height: unset;" role="dialog" aria-modal="true" aria-labelledby="app-alert-title">
      <div class="modal-header" style="padding: 1rem 1.5rem">
        <div class="modal-title" id="app-alert-title">
          <span class="title-badge" id="app-alert-badge" style="background: var(--primary)">INFO</span>
          <span id="app-alert-header-text" style="font-weight: 700">Notification</span>
        </div>
        <button type="button" id="app-alert-close-icon" class="modal-close-icon" onclick="closeAppAlert()" aria-label="Close dialog">&#10005;</button>
      </div>
      <div class="modal-body" style="padding: 2rem 1.5rem; text-align: center">
        <div id="app-alert-message" style="margin-bottom: 1.5rem; font-size: 1rem; line-height: 1.6; color: var(--text-secondary); font-weight: 500;"></div>
        <div style="display: flex; justify-content: center; gap: 1rem">
          <button type="button" class="btn-secondary" id="app-alert-cancel-btn" style="min-width: 110px; height: 42px; display: none" onclick="closeAppAlert()">Cancel</button>
          <button type="button" class="download-report-btn download-report-schedule-btn" id="app-alert-confirm-btn" style="min-width: 120px; height: 42px; border-radius: 10px" onclick="closeAppAlert()">
            <span id="app-alert-confirm-text">Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  </div>
`;
