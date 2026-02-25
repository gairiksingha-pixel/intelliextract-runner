export const DashboardBody = () => `
  <header class="header">
    <div class="report-header-left">
      <div class="header-title-area">
        <h1 class="header-main-title">Operation Dashboard</h1>
      </div>
      <div class="system-status-pill">
        <div class="pulse-dot"></div>
        <span id="system-status-text">Runner is active</span>
      </div>
    </div>
    <div class="report-header-right">
      <div class="header-filter-row">
        <div class="header-field-wrap brand-field-wrap">
          <div id="brand-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="brand-dropdown-trigger">Brand</label>
              <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="true" title="Select one or more brands">
                Select brand
              </button>
            </div>
            <div id="brand-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
          </div>
        </div>
        <div class="header-field-wrap purchaser-field-wrap">
          <div id="purchaser-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="purchaser-dropdown-trigger">Purchaser</label>
              <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="true" title="Select one or more purchasers">
                Select purchaser
              </button>
            </div>
            <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
          </div>
        </div>
        <div class="header-field-wrap">
          <button type="button" id="filter-reset-btn" class="header-btn-reset" title="Reset Filters"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg></button>
        </div>
      </div>
    </div>
  </header>
  <main class="main">
    <div class="table-section">
      <table id="operation-table">
        <thead>
          <tr>
            <th class="op-header">Operation</th>
            <th class="limits-header">Limits</th>
            <th class="params-header">Run Parameters</th>
            <th class="actions-header">Actions</th>
            <th class="result-header">Progress & Result</th>
          </tr>
        </thead>
        <tbody id="rows">
          <!-- Rows will be populated by JS -->
        </tbody>
      </table>
    </div>

    <!-- Job Scheduling Modal (Custom to Dashboard) -->
    <div id="schedule-modal-overlay" class="modal-overlay" aria-hidden="true">
      <div class="modal-content wide">
        <div class="modal-header">
           <h2 class="modal-title">Job Scheduling</h2>
           <button type="button" class="modal-close-icon" onclick="window.closeScheduleModal()">&times;</button>
        </div>
        <div id="schedule-modal-body" class="modal-body no-pad">
          <!-- Populated by JS -->
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Close</button>
        </div>
      </div>
    </div>
  </main>
`;
