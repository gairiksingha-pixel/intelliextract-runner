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
        <input type="text" id="recipient-email-input" style="width: 100%; height: 42px; padding: 0 1rem; border: 1px solid var(--border-light); border-radius: 8px; font-family: inherit; font-size: 0.95rem; margin-bottom: 0.4rem; box-sizing: border-box;" placeholder="e.g. alerts@company.com, admin@site.com" />
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Separate multiple emails with commas.</div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="notification-modal-cancel">Cancel</button>
        <button type="button" class="download-report-btn download-report-schedule-btn" id="notification-save-btn">
          <span>Apply Changes</span>
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
        <button type="button" id="app-alert-close-icon" class="modal-close-icon" onclick="window.closeAppAlert()" aria-label="Close dialog">&#10005;</button>
      </div>
      <div class="modal-body" style="padding: 2rem 1.5rem; text-align: center">
        <div id="app-alert-message" style="margin-bottom: 1.5rem; font-size: 1rem; line-height: 1.6; color: var(--text-secondary); font-weight: 500;"></div>
        <div style="display: flex; justify-content: center; gap: 1rem">
          <button type="button" class="btn-secondary" id="app-alert-cancel-btn" style="min-width: 110px; height: 42px; display: none" onclick="window.closeAppAlert()">Cancel</button>
          <button type="button" class="download-report-btn download-report-schedule-btn" id="app-alert-confirm-btn" style="min-width: 120px; height: 42px; border-radius: 10px" onclick="window.closeAppAlert()">
            <span id="app-alert-confirm-text">Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  </div>
`;

export const ScheduleModal = () => `
  <div id="schedule-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
      <div class="modal-header">
        <div class="modal-title" id="schedule-modal-title">
          <span class="title-badge">SCHEDULE</span>
          <span id="modal-title-text">Dashboard</span>
        </div>
        <button type="button" id="schedule-modal-close-icon" class="modal-close-icon" aria-label="Close schedule dialog">&#10005;</button>
      </div>
      <div class="modal-body" id="schedule-modal-body"></div>
    </div>
  </div>
`;

export const ExtractionDataModal = () => `
  <div id="extraction-data-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal" style="width: 1000px; height: 85vh; max-height: 95vh; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="extraction-data-modal-title">
      <div class="report-header">
        <div class="report-header-left">
          <img src="/assets/logo.png" alt="logo" class="logo" />
          <h1 class="report-header-title" id="extraction-data-modal-title">Data Explorer</h1>
        </div>
        <button type="button" id="extraction-data-modal-close-icon" class="modal-close-icon" style="margin-left: 1rem" aria-label="Close dialog">&#10005;</button>
      </div>
      <div class="modal-body" id="extraction-data-modal-body" style="padding: 1.5rem; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <div class="dashboard-stats" id="extraction-stats"></div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 2rem; border-bottom: 1px solid rgba(203, 213, 225, 0.4); margin-bottom: 1rem;">
          <div class="modal-tabs" style="margin-bottom: 0; border: none">
            <button class="modal-tab-btn active" data-tab="all">All Results</button>
            <button class="modal-tab-btn" data-tab="success">Succeeded</button>
            <button class="modal-tab-btn" data-tab="failed">Failed</button>
          </div>
          <div class="search-container" style="max-width: 320px; margin-bottom: 0">
            <span class="search-icon"><svg style="width: 16px; height: 16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
            <input type="text" id="extraction-search" class="search-input" placeholder="Search filenames or patterns..." />
          </div>
        </div>
        <div id="extraction-table-container" style="flex: 1; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
          <div class="schedule-empty">Loading operation data...</div>
        </div>
        <div id="extraction-pagination" class="pagination-wrap"></div>
      </div>
    </div>
  </div>
`;

export const ReportViewOverlay = () => `
  <div id="report-view-overlay" class="report-view-overlay" aria-hidden="true" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg); z-index: 5000; flex-direction: column;">
    <div class="report-overlay-body" style="flex: 1; width: 100%; height: 100%; position: relative; background: var(--bg);">
      <iframe id="report-view-frame" title="Report Content" style="width: 100%; height: 100%; border: none; display: block;"></iframe>
      <div id="report-view-loader" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(248, 250, 252, 0.85); display: flex; align-items: center; justify-content: center; z-index: 10; font-size: 1.1rem; font-weight: 700; color: var(--primary);">
        <div class="loading-dots"></div>
      </div>
    </div>
  </div>
`;
