export interface RunSummaryBodyProps {
  totalAll: number;
  totalSuccess: number;
  totalFailed: number;
}

export function RunSummaryBody(props: RunSummaryBodyProps) {
  return `
    <header class="header">
      <div class="report-header-left">
        <div class="header-title-area">
          <h1 class="header-main-title">Run Summary Report</h1>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

  <main class="main-container">
    <div class="report-card-box">
      <div class="page-body">
        <div class="tabs">
          <button class="tab-btn active" onclick="switchTab('dashboard')">Analytics Dashboard</button>
          <button class="tab-btn" onclick="switchTab('history')">Operation History</button>
        </div>

    <div id="dashboard" class="tab-content active">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Items Processed</div>
          <div class="stat-value" id="agg-total">—</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value" id="agg-rate">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Latency</div>
          <div class="stat-value" id="agg-latency">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Operations</div>
          <div class="stat-value" id="agg-ops">${props.totalAll}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="chart-card">
          <h4>Extraction Volume Trend</h4>
          <div class="chart-scroll-wrapper">
            <div class="chart-container" id="volChartContainer">
              <canvas id="volChart"></canvas>
            </div>
          </div>
        </div>
        <div class="chart-card">
          <h4>Latency Performance (P50/P95)</h4>
          <div class="chart-scroll-wrapper">
            <div class="chart-container" id="latencyChartContainer">
              <canvas id="latencyChart"></canvas>
            </div>
          </div>
        </div>
        <div class="chart-card">
          <h4>System Throughput</h4>
          <div class="chart-scroll-wrapper">
            <div class="chart-container" id="throughputChartContainer">
              <canvas id="throughputChart"></canvas>
            </div>
          </div>
        </div>
        <div class="chart-card">
          <h4>Error Distribution (Infra)</h4>
          <div class="chart-container">
            <canvas id="errorChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div id="history" class="tab-content">
      <div class="controls-bar">
        <div class="status-group">
          <button class="status-tab active" data-filter="all">All <span class="count" id="c-all">${props.totalAll}</span></button>
          <button class="status-tab" data-filter="success">Success <span class="count" id="c-succ">${props.totalSuccess}</span></button>
          <button class="status-tab" data-filter="failed">Failed <span class="count" id="c-fail">${props.totalFailed}</span></button>
        </div>
        <div class="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="search-input" id="search-input" placeholder="Search Run ID, brand, purchaser…">
        </div>
        <div class="results-info" id="results-info"></div>
      </div>
      <div id="history-items-container">
        <!-- Run items injected by JS -->
        <div class="loading-state" style="padding: 3rem; text-align: center; color: #94a3b8;">
          <p>Loading run history…</p>
        </div>
      </div>
      <div id="history-pagination" class="history-pagination"></div>
    </div>

      </div>
    </div>
  </main>
  `;
}
