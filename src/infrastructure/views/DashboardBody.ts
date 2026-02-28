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
      <div id="header-actions" class="header-actions-wrap"></div>
      <div class="header-filter-row">
        <div class="header-field-wrap brand-field-wrap">
          <div id="brand-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="brand-dropdown-trigger">Brand</label>
              <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">
                Select brand
              </button>
            </div>
            <div id="brand-dropdown-panel" class="filter-dropdown-panel" role="listbox">
              <!-- brand options populated dynamically from /api/config -->
            </div>
          </div>
          <div id="brand-error" class="header-field-error" role="alert"></div>
        </div>
        <div class="header-field-wrap purchaser-field-wrap">
          <div id="purchaser-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="purchaser-dropdown-trigger">Purchaser</label>
              <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">
                Select purchaser
              </button>
            </div>
            <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox">
              <!-- options filled by JS based on selected brands -->
            </div>
          </div>
          <div id="purchaser-error" class="header-field-error" role="alert"></div>
        </div>
        <div class="header-field-wrap header-filter-reset-wrap">
          <button type="button" id="filter-reset-btn" class="header-btn-reset" title="Clear brand and purchaser filter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <polyline points="3 3 3 8 8 8"></polyline>
            </svg>
          </button>
          <div class="header-field-error"></div>
        </div>
      </div>
    </div>
  </header>
  <main class="main">
    <div class="table-section">
      <table>
        <thead>
          <tr>
            <th class="op-name">Operations</th>
            <th class="limits-col">Operation limits</th>
            <th class="run-cell">Operation controls</th>
            <th class="result-header">Operation output</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </main>
`;
