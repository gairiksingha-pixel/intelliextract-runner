export const DATA_EXPLORER_SCRIPTS = `
    const ROWS_DATA = {{ROWS_JSON}};
    const BRAND_NAMES = {{BRAND_NAMES_JSON}};
    const PURCHASER_NAMES = {{PURCHASER_NAMES_JSON}};
    const BRAND_PURCHASER_MAP = {{BRAND_PURCHASER_MAP_JSON}};
    
    // Original JS logic for filtering, sorting, and expanding rows...
    // (This would be the ~1000 lines of script currently in app-server.mjs)
`;

export const DATA_EXPLORER_CONTENT = `
    <header class="header">
      <div class="report-header-left">
        <div class="header-title-area">
          <h1 class="header-main-title">Data Explorer</h1>
        </div>
        <div class="system-status-pill">
          <span id="operation-count-label">{{TOTAL_OPERATIONS}} operation(s)</span>
        </div>
      </div>
      <!-- Rest of the HTML -->
    </header>
`;
