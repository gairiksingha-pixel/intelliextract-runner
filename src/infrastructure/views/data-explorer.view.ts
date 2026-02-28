import { DataExplorerBody, DataExplorerBodyProps } from "./data-explorer-body.body.js";

export class DataExplorerView {
  static getStyles(): string {
    return `
    .page-body { padding: 1.5rem; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .stat-card .stat-label {
      font-size: 0.65rem;
      font-weight: 800;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--header-bg);
      line-height: 1;
    }
    .stat-card .stat-sub { font-size: 0.7rem; color: var(--muted); }
    .stat-card.success .stat-value { color: var(--pass); }
    .stat-card.failed .stat-value { color: var(--fail); }
    .stat-card.rate .stat-value { color: var(--primary); }

    .controls-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      margin-bottom: 1rem;
      background: var(--surface);
      border-radius: var(--radius-sm);
      border: 1px solid rgba(176, 191, 201, 0.4);
      padding: 0.75rem 1.25rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .tab-group { display: flex; gap: 0.25rem; }
    .tab-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.45rem 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--muted);
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn:hover { background: var(--bg); color: var(--text); }
    .tab-btn.active { background: var(--header-bg); color: white; border-color: var(--header-bg); }
    .tab-btn .count {
      display: inline-block;
      background: rgba(255,255,255,0.25);
      border-radius: 100px;
      padding: 0 0.4rem;
      font-size: 0.7rem;
      margin-left: 0.35rem;
    }
    .tab-btn:not(.active) .count { background: var(--bg); color: var(--muted); }

    .search-wrap { position: relative; flex: 1; max-width: 400px; }
    .search-wrap svg { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 1rem 0 2.5rem;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 0.85rem;
      background: #f1f5f9;
      color: var(--text);
      outline: none;
      transition: all 0.2s;
    }
    .search-input:focus { border-color: var(--primary); background: white; box-shadow: 0 0 0 3px var(--accent-light); }

    .results-info { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }

    .data-table-wrap {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      overflow: visible;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .data-table thead th {
      background: #f8fafc;
      color: var(--muted);
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-light);
      text-align: left;
    }
    .data-table tbody tr {
      border-bottom: 1px solid rgba(203,213,225,0.4);
      transition: background 0.1s;
      cursor: pointer;
    }
    .data-table tbody tr:hover { background: #f8fafc; }
    .data-table tbody tr:last-child { border-bottom: none; }
    .data-table td {
      padding: 0.75rem 1rem;
      vertical-align: middle;
    }
    .data-table tr.expanded { background: #f0f9ff; }
    .data-table tr.expanded:hover { background: #e0f2fe; }

    .expand-row td {
      padding: 0;
      background: #0f172a;
      cursor: default;
    }
    .expand-row:hover td { background: #0f172a; }
    .json-viewer {
      padding: 1.25rem 1.5rem;
      overflow-x: auto;
      max-height: 2000px;
      overflow-y: visible;
      transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease;
      text-align: left;
    }
    .expand-row-content { overflow: hidden; height: 0; opacity: 0; transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    .expand-row-content.open { height: auto; opacity: 1; }
    
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideUp {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(-10px); }
    }
    .json-viewer pre {
      margin: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      line-height: 1.6;
      color: #e2e8f0;
      white-space: pre-wrap;
      word-break: break-all;
      text-align: left;
    }
    .json-key { color: #93c5fd; }
    .json-string { color: #86efac; }
    .json-number { color: #fbbf24; }
    .json-bool-true { color: #34d399; }
    .json-bool-false { color: #f87171; }
    .json-null { color: #94a3b8; }

    /* Expand loader spinner */
    .json-loader {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.5rem 1.75rem;
      color: #94a3b8;
      font-size: 0.78rem;
      animation: slideDown 0.18s cubic-bezier(0.25, 1, 0.5, 1);
    }
    .json-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(148,163,184,0.25);
      border-top-color: #93c5fd;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .badge {
      display: inline-block;
      font-size: 0.6rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-success { background: var(--pass-bg); color: var(--pass); }
    .badge-failed { background: var(--fail-bg); color: var(--fail); }

    .expand-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: var(--bg);
      border: 1px solid var(--border-light);
      color: var(--muted);
      transition: all 0.2s;
      flex-shrink: 0;
    }
    tr.expanded .expand-icon { background: var(--header-bg); color: white; border-color: var(--header-bg); transform: rotate(90deg); }

    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 1.25rem;
      border-top: 1px solid var(--border-light);
    }
    .pg-btn {
      min-width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      transition: all 0.15s;
      padding: 0 0.5rem;
    }
    .pg-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); background: var(--pass-bg); }
    .pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pg-btn.active { background: var(--primary); color: white; border-color: var(--primary); }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--muted);
    }
    .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.4; }
    .empty-state p { margin: 0; font-size: 0.85rem; }

    .filename-cell { font-size: 0.72rem; word-break: break-all; color: var(--text); max-width: 280px; }
    .pattern-cell code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      color: var(--header-bg);
    }
    .time-cell { font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap; }
    .toggle-cell { width: 40px; text-align: center; vertical-align: middle; }
    .action-cell { width: 160px; text-align: center; vertical-align: middle; }
    .btn-download-row {
      background: var(--bg);
      border: 1px solid var(--border-light);
      border-radius: 4px;
      padding: 0.3rem 0.6rem;
      cursor: pointer;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.7rem;
      font-weight: 700;
      transition: all 0.15s;
    }
    .btn-download-row:hover {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }
    @media (max-width: 1080px) {
      .report-header { padding: 0.75rem 1rem; min-height: 64px; }
      .report-header-title { font-size: 0.75rem; padding: 0 0.75rem; }
      .header-filter-row { gap: 0.5rem; }
      .brand-field-wrap .filter-dropdown-trigger { min-width: 140px; max-width: 140px; }
      .purchaser-field-wrap .filter-dropdown-trigger { min-width: 160px; max-width: 160px; }
      .header-btn-reset { width: 34px; padding: 0; }
    }
    .data-table thead th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background 0.2s;
      position: relative;
      padding-right: 2rem;
    }
    .data-table thead th.sortable:hover {
      background: #f1f5f9;
      color: var(--primary);
    }
    .data-table thead th.sortable::after {
      content: '↕';
      position: absolute;
      right: 0.75rem;
      opacity: 0.3;
      font-size: 0.8rem;
    }
    .data-table thead th.sortable.sort-asc::after {
      content: '↑';
      opacity: 1;
      color: var(--primary);
    }
    .data-table thead th.sortable.sort-desc::after {
      content: '↓';
      opacity: 1;
      color: var(--primary);
    }
    `;
  }

  static render(props: DataExplorerBodyProps): string {
    return DataExplorerBody(props);
  }
}
