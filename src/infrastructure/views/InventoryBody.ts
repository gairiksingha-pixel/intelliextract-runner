export interface InventoryBodyProps {
  totalFiles: number;
  totalSizeStr: string;
  manifestEntries: number;
}

export function InventoryBody(props: InventoryBodyProps) {
  return `
    <header class="header">
      <div class="report-header-left">
        <div class="header-title-area">
          <h1 class="header-main-title">Staging Inventory</h1>
        </div>
        <div class="system-status-pill">
          <span id="operation-count-label">Registry Status: Active</span>
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
            <div class="stat-label">Total Staging Files</div>
            <div class="stat-value" id="tot-files">${props.totalFiles}</div>
            <div class="stat-sub">Across all brands</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Data Volume</div>
            <div class="stat-value" id="tot-size">${props.totalSizeStr}</div>
            <div class="stat-sub">Staged CSV/XML results</div>
          </div>
          <div class="stat-card success">
            <div class="stat-label">Manifest Entries</div>
            <div class="stat-value" id="manifest-val">${props.manifestEntries}</div>
            <div class="stat-sub">Tracked in registry</div>
          </div>
          <div class="stat-card rate">
            <div class="stat-label">Active Filters</div>
            <div class="stat-value" id="filter-val">All</div>
            <div class="stat-sub">By Brand/Purchaser</div>
          </div>
        </div>

        <div class="chart-card" style="margin-bottom: 2rem;">
          <h4>Download History (Last 30 Runs)</h4>
          <div class="chart-container">
            <canvas id="historyChart"></canvas>
          </div>
        </div>

        <h3 id="files-title">Current Staging Files</h3>
        
        <div class="controls-bar">
          <div class="search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="search-input" id="search-input" placeholder="Search filename or path…">
          </div>
          <div class="results-info" id="results-info"></div>
          <button class="pg-btn" id="export-zip-btn" onclick="exportBatch()" title="Export Visible Files (ZIP)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Files
          </button>
        </div>

        <table id="files-table">
          <thead><tr>
            <th class="sortable" onclick="handleSort('path')" id="sort-path">Path (staging)</th>
            <th class="sortable" onclick="handleSort('runId')" id="sort-runId">Run ID</th>
            <th class="sortable" onclick="handleSort('size')" id="sort-size">Size (bytes)</th>
            <th class="sortable" onclick="handleSort('mtime')" id="sort-mtime">Modified</th>
            <th class="action-cell" style="width: 100px;">Action</th>
          </tr></thead>
          <tbody id="files-body"></tbody>
        </table>
        <div id="pagination" class="pagination"></div>
      </div>
    </div>
  </main>
  `;
}
