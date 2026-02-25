export const NotificationModal = () => `
  <div id="email-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Notification Settings</h2>
        <button type="button" id="email-modal-close-icon" class="modal-close-icon" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="subtitle-chip">Management of email recipients</div>
        <div class="schedule-field">
          <label class="schedule-label" for="recipient-email">Recipient Emails</label>
          <input type="text" id="recipient-email" class="schedule-input" placeholder="e.g. user@example.com, another@example.com">
          <div class="schedule-hint">Enter comma-separated email addresses. These recipients will receive reports after each automated run.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" id="email-modal-cancel-btn" class="btn-secondary">Cancel</button>
        <button type="button" id="email-modal-save-btn" class="download-report-btn"><span>Save Settings</span></button>
      </div>
    </div>
  </div>
`;

export const AlertModal = () => `
  <div id="app-alert-modal-overlay" class="modal-overlay alert-modal-overlay" aria-hidden="true">
    <div class="modal-content alert-content">
      <button type="button" id="app-alert-close-icon" class="modal-close-icon">&times;</button>
      <div id="app-alert-badge" class="alert-badge">INFO</div>
      <h2 id="app-alert-header-text" class="modal-title" style="margin-bottom: 0.75rem;">Notification</h2>
      <div id="app-alert-message" class="alert-message" style="margin-bottom: 2rem; color: var(--text-secondary); line-height: 1.6;"></div>
      <div class="modal-footer" style="border: none; padding: 0.5rem 0 0; justify-content: center; gap: 0.75rem;">
        <button type="button" id="app-alert-cancel-btn" class="btn-secondary" style="display: none;">Cancel</button>
        <button type="button" id="app-alert-confirm-btn" class="download-report-btn"><span id="app-alert-confirm-text">Dismiss</span></button>
      </div>
    </div>
  </div>
`;
