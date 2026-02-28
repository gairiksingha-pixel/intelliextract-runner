export interface DataExplorerBodyProps {
  totalAll: number;
  totalSuccess: number;
  totalFailed: number;
  successRate: number;
}

export function DataExplorerBody(props: DataExplorerBodyProps) {
  return `
    <header class="header">
      <div class="report-header-left">
        <div class="header-title-area">
          <h1 class="header-main-title">Data Explorer</h1>
        </div>
        <div class="system-status-pill">
          <span id="operation-count-label">${props.totalAll} operation(s)</span>
        </div>
      </div>
      <div class="report-header-right">
        <div class="header-filter-row">
          <div class="header-field-wrap brand-field-wrap">
            <div id="brand-dropdown" class="filter-dropdown">
              <div class="filter-chip">
                <label class="header-label" for="brand-dropdown-trigger">Brand</label>
                <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">
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
                <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">
                  Select purchaser
                </button>
              </div>
              <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
            </div>
          </div>
          <div class="header-field-wrap header-filter-reset-wrap">
            <button type="button" id="filter-reset-btn" class="header-btn-reset" onclick="resetFilters()" title="Reset Filters">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

  <main class="main">
    <div class="report-card-box">
      <div class="page-body">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Operations</div>
            <div class="stat-value" id="tot-val">${props.totalAll}</div>
            <div class="stat-sub">Across visible runs</div>
          </div>
          <div class="stat-card success">
            <div class="stat-label">Succeeded</div>
            <div class="stat-value" id="succ-val">${props.totalSuccess}</div>
            <div class="stat-sub">Extraction success</div>
          </div>
          <div class="stat-card failed">
            <div class="stat-label">Failed</div>
            <div class="stat-value" id="fail-val">${props.totalFailed}</div>
            <div class="stat-sub">Require attention</div>
          </div>
          <div class="stat-card rate">
            <div class="stat-label">Success Rate</div>
            <div class="stat-value" id="rate-val">${props.successRate}%</div>
            <div class="stat-sub">Filter applied</div>
          </div>
        </div>

        <div class="controls-bar">
          <div class="tab-group">
            <button class="tab-btn active" data-filter="all">All <span class="count" id="c-all">${props.totalAll}</span></button>
            <button class="tab-btn" data-filter="success">Succeeded <span class="count" id="c-succ">${props.totalSuccess}</span></button>
            <button class="tab-btn" data-filter="failed">Failed <span class="count" id="c-fail">${props.totalFailed}</span></button>
          </div>
          <div class="search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="search-input" id="search-input" placeholder="Search filename, pattern, purchaser…">
          </div>
          <div class="results-info" id="results-info"></div>
          <div style="display: flex; gap: 8px;">
            <button class="pg-btn" id="export-source-btn" onclick="exportBatch('source')" title="Export Visible Source Files (ZIP)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Source
            </button>
            <button class="pg-btn" id="export-json-btn" onclick="exportBatch('json')" title="Export Visible Extraction JSONs (ZIP)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export JSON
            </button>
          </div>
        </div>

        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="toggle-cell"></th>
                <th class="sortable" onclick="handleSort('mtime')" id="sort-mtime">Timestamp</th>
                <th class="sortable" onclick="handleSort('filename')" id="sort-filename">Filename</th>
                <th class="sortable" onclick="handleSort('runId')" id="sort-runId">Run ID</th>
                <th class="sortable" onclick="handleSort('patternKey')" id="sort-patternKey">Pattern Key</th>
                <th class="sortable" onclick="handleSort('purchaserKey')" id="sort-purchaserKey">Purchaser (API)</th>
                <th class="sortable" onclick="handleSort('status')" id="sort-status">Status</th>
                <th class="action-cell">Action</th>
              </tr>
            </thead>
            <tbody id="table-body">
            </tbody>
          </table>
          <div class="pagination-bar" id="pagination-bar"></div>
        </div>
      </div>
    </div>
  </main>
  `;
}
