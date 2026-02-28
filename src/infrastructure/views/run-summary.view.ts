import { RunSummaryBody, RunSummaryBodyProps } from "./run-summary-body.body.js";

export class RunSummaryView {
  static getStyles(): string {
    return `
    .page-body { padding: 1.25rem; }

    .header {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      padding: 0.6rem 1.25rem;
      border-radius: var(--radius);
      margin: 0.75rem auto 0.5rem auto;
      max-width: 1820px;
      width: calc(100% - 2.5rem);
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid rgba(176, 191, 201, 0.3);
      position: sticky;
      top: 0;
      z-index: 1000;
      min-height: 72px;
    }
    .system-status-pill {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: white;
      padding: 0.4rem 0.85rem;
      border-radius: 100px;
      border: 1px solid rgba(203, 213, 225, 0.5);
      margin-left: 1.25rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-secondary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
    .header .logo { height: 32px; width: auto; object-fit: contain; cursor: pointer; }
    .header-title-area { display: flex; flex-direction: column; gap: 2px; }
    .header-main-title {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.01em;
      line-height: 1.2;
    }

    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-filter-row { display: flex; align-items: center; gap: 0.75rem; }
    .header-field-wrap { display: flex; flex-direction: column; align-items: center; }
    .filter-dropdown { position: relative; }
    .filter-chip {
      display: flex; align-items: center; height: 34px; background: #fff;
      border: 1px solid rgba(176,191,201,0.6); border-radius: 8px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .filter-chip .header-label {
      font-size: 0.7rem; color: var(--primary); font-weight: 800; background: var(--accent-light);
      padding: 0 0.75rem; height: 100%; display: flex; align-items: center;
      border-right: 1px solid rgba(45,157,95,0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .filter-dropdown-trigger {
      border: none; background: transparent; height: 100%; padding: 0 1.5rem 0 0.75rem;
      font-size: 0.85rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .brand-field-wrap .filter-dropdown-trigger { min-width: 162px; max-width: 162px; }
    .purchaser-field-wrap .filter-dropdown-trigger { min-width: 187px; max-width: 187px; }
    .filter-dropdown-panel {
      display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
      min-width: 220px; max-height: 400px; overflow-y: auto; background: white;
      border: 1px solid var(--border-light); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      z-index: 1100; padding: 0.5rem 0;
    }
    .filter-dropdown-panel.open { display: block; animation: slideDown 0.2s ease-out; }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    .filter-dropdown-option {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      font-size: 0.85rem; cursor: pointer; transition: background 0.1s;
    }
    .filter-dropdown-option:hover { background: #f8fafc; }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }

    .header-btn-reset {
      height: 34px; width: 34px; padding: 0;
      background: var(--header-bg); color: #fff;
      border: none; border-radius: 6px; cursor: pointer;
      box-shadow: 0 2px 5px rgba(33,108,109,0.2); transition: all 0.2s;
      display: inline-flex; align-items: center; justify-content: center;
      line-height: 1; font-family: inherit;
    }
    .header-btn-reset:hover { filter: brightness(1.1); transform: translateY(-1px); }

    .main-container {
      padding: 0 0 1.25rem 0;
      max-width: 1820px;
      width: calc(100% - 2.5rem);
      margin: 0 auto;
      box-sizing: border-box;
    }
    .report-card-box {
      background: var(--surface);
      border: 1px solid rgba(176, 191, 201, 0.55);
      border-radius: var(--radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .tabs { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; background: rgba(176, 191, 201, 0.15); padding: 5px; border-radius: var(--radius); border: 1px solid var(--border-light); }
    .tab-btn { flex: 1; background: none; border: none; padding: 0.65rem 1.5rem; font-family: inherit; font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; color: var(--text-secondary); border-radius: calc(var(--radius) - 4px); transition: all 0.25s ease; }
    .tab-btn.active { background: var(--header-bg); color: white; box-shadow: 0 4px 12px rgba(33, 108, 109, 0.25); }
    @keyframes tabFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: tabFadeIn 0.3s cubic-bezier(0.2, 0, 0, 1); }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 900px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex; flex-direction: column; gap: 0.4rem;
    }
    .stat-card .stat-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.07em; }
    .stat-card .stat-value { font-size: 2rem; font-weight: 700; color: var(--header-bg); line-height: 1; }
    .stat-card.success .stat-value { color: var(--pass); }
    .stat-card.failed .stat-value { color: var(--fail); }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 1000px) { .dashboard-grid { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      padding: 1.6rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .chart-card:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(0,0,0,0.06); }
    .chart-card h4 {
      margin: 0 0 1.25rem;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--header-bg);
      border-bottom: 1px solid rgba(176,191,201,0.2);
      padding-bottom: 0.75rem;
      font-weight: 800;
      display: flex; align-items: center; gap: 10px;
    }
    .chart-card h4::before {
      content: '';
      display: inline-block;
      width: 4px; height: 16px;
      background: var(--primary);
      border-radius: 2px;
    }
    .chart-scroll-wrapper { overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; }
    .chart-container { position: relative; height: 300px; width: 100%; min-width: 100%; }

    .controls-bar {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin: 1.5rem 0 1.25rem;
      background: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(176, 191, 201, 0.4);
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      flex-wrap: wrap;
    }
    .status-group {
      display: flex;
      background: #f1f5f9;
      padding: 4px;
      border-radius: 10px;
      gap: 2px;
    }
    .status-tab {
      border: none; background: none;
      padding: 0.5rem 1.1rem;
      font-family: inherit; font-size: 0.75rem; font-weight: 800;
      color: #64748b; cursor: pointer;
      border-radius: 7px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex; align-items: center; gap: 8px;
      text-transform: uppercase; letter-spacing: 0.03em;
    }
    .status-tab.active { background: white; color: var(--header-bg); box-shadow: 0 2px 5px rgba(0,0,0,0.06); }
    .status-tab .count {
      background: #e2e8f0; color: #475569;
      padding: 1px 6.5px; border-radius: 4.5px; font-size: 0.65rem;
    }
    .status-tab.active .count { background: var(--accent-light); color: var(--primary); }
    .search-wrap {
      flex: 1; min-width: 300px; position: relative; display: flex; align-items: center;
    }
    .search-wrap svg { position: absolute; left: 12px; color: #94a3b8; pointer-events: none; }
    .search-input {
      width: 100%; height: 38px; padding: 0 1.25rem 0 2.5rem;
      border-radius: 8px; border: 1px solid transparent;
      font-family: inherit; font-size: 0.82rem;
      background: #f1f5f9; color: var(--text); transition: all 0.2s;
    }
    .search-input:focus { outline: none; border-color: var(--primary); background: white; box-shadow: 0 0 0 3px var(--accent-light); }
    .results-info { font-size: 0.72rem; font-weight: 800; color: var(--header-bg); text-transform: uppercase; letter-spacing: 0.05em; }

    /* Run Sections (accordion) */
    .run-section {
      margin-bottom: 1.25rem;
      background: white;
      border-radius: 10px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border: 1px solid var(--border);
      overflow: hidden;
      border-left: 6px solid #cbd5e1;
      transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
    }
    .run-section[open] {
      border-color: var(--header-bg);
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
      transform: translateY(-2px);
    }
    .run-section.status-error { border-left-color: #ef4444; }
    .run-section.status-warning { border-left-color: #f59e0b; }
    .run-section.status-error[open] { border-color: #ef4444; }

    .run-section-summary { cursor: pointer; padding: 1rem 1.25rem; background: #f8fafc; list-style: none; transition: background 0.2s; border-bottom: 1px solid var(--border-light); }
    .run-section-summary::-webkit-details-marker { display: none; }
    .run-section-summary:hover { background: #f1f5f9; }
    .summary-content { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .collapsing, .expanding { overflow: hidden; transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    .operation-pointer {
      display: flex; align-items: center; gap: 0.75rem;
      background: var(--header-bg); color: white;
      font-size: 0.75rem; font-weight: 700;
      padding: 0.4rem 2rem 0.4rem 1rem;
      clip-path: polygon(0% 0%, calc(100% - 15px) 0%, 100% 50%, calc(100% - 15px) 100%, 0% 100%);
      text-transform: uppercase; letter-spacing: 0.05em;
      filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.4));
    }
    .summary-badges { display: flex; gap: 0.5rem; align-items: center; }
    .badge-status { font-size: 0.65rem; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-status.success { background: var(--accent-light); color: var(--primary); border: 1px solid rgba(45,157,95,0.2); }
    .badge-status.fail { background: #fee2e2; color: #b91c1c; border: 1px solid rgba(185,28,28,0.2); }
    .badge-status.secondary { background: #f1f5f9; color: var(--text-secondary); border: 1px solid var(--border-light); }
    .batch-id { background: rgba(255,255,255,0.2) !important; color: white !important; border: 1px solid rgba(255,255,255,0.3) !important; padding: 0.1rem 0.4rem !important; font-family: monospace; }
    .badge-brand { opacity: 0.85; }
    .badge-purchaser { background: #ffffff !important; color: var(--header-bg) !important; padding: 0.1rem 0.5rem !important; border-radius: 4px; font-weight: 800; }
    .run-time { font-weight: 400; opacity: 0.9; margin-left: auto; }
    .accordion-arrow { transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1); color: #94a3b8; }
    details[open] .accordion-arrow { transform: rotate(180deg); color: var(--header-bg); }

    .run-section-body { padding: 0; overflow: hidden; }
    .chip { display: inline-flex; align-items: center; background: #f1f5f9; color: var(--text); padding: 0.2rem 0.6rem; border-radius: 100px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); }
    .chip.success { background: var(--accent-light); color: var(--primary); border-color: rgba(45,157,95,0.2); }
    .chip.fail { background: #fee2e2; color: #b91c1c; border-color: rgba(185,28,28,0.2); }
    .chip.secondary { background: #f8fafc; color: var(--header-bg); font-weight: 700; border-color: var(--border-light); }

    .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 1.5rem; border-radius: var(--radius-sm); box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--border); background: var(--surface); }
    table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: auto; min-width: 600px; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; overflow-wrap: anywhere; }
    th {
      background: var(--header-bg); color: white;
      font-size: 0.725rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800;
      border-right: 1px solid rgba(255,255,255,0.15); border-bottom: none; padding: 0.85rem 1rem;
    }
    th:last-child { border-right: none; }
    td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border-light); border-right: 1px solid var(--border-light); }
    td:last-child { border-right: none; }
    td.file-path { font-family: inherit; font-size: 0.72rem; color: var(--text-secondary); overflow-wrap: anywhere; word-break: break-all; }
    h3 { color: var(--header-bg); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 2rem 0 1rem; border-bottom: 2px solid var(--border-light); padding-bottom: 0.4rem; }

    .agent-style-summary {
      background: #f8fafc; border-left: 4px solid var(--header-bg);
      padding: 1rem; border-radius: 0 6px 6px 0; margin: 0.5rem 0 1rem;
      overflow-wrap: anywhere; word-break: break-word;
    }
    .anomalies-container { background: #f8fafc; border-left: 4px solid var(--header-bg); padding: 1rem; border-radius: 0 6px 6px 0; margin: 0.5rem 0 1rem; }

    .full-log-container { margin-top: 1.5rem; overflow: hidden; border-radius: 8px; border: 1px solid var(--border-light); }
    .full-log-container[open] { border-color: var(--header-bg); }

    .log-search-container { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .log-search-container input { flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit; font-size: 0.85rem; }

    .log-table th { position: sticky; top: 0; z-index: 100; background: var(--header-bg) !important; color: white !important; text-align: left; padding: 0.85rem 1rem; border-bottom: 2px solid rgba(0,0,0,0.1); height: 44px; line-height: 1.2; }
    .log-table th.action-cell { text-align: center; }
    .log-row-hidden { display: none !important; }
    .action-cell { text-align: center; vertical-align: middle; white-space: nowrap; }
    .action-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 6px;
      background: #f1f5f9; color: #64748b; transition: all 0.2s;
      text-decoration: none; border: 1px solid var(--border-light);
    }
    .action-btn:hover { background: var(--accent-light); color: var(--primary); border-color: var(--primary); }
    .action-cell .action-btn { margin: 0 2px; }
    .muted { color: var(--text-secondary); font-style: italic; }
    .small { font-size: 0.75rem; }
    .status-icon { font-size: 1rem; margin-right: 4px; }
    .status-icon.success { color: #2d9d5f; }
    .status-icon.error { color: #ef4444; }
    .filtered-out { display: none !important; }

    .history-pagination {
      display: flex; gap: 0.5rem; justify-content: center; margin: 2.5rem 0; padding: 1rem;
    }
    .pg-btn {
      padding: 0.55rem 1.1rem; border: 1px solid var(--border); background: white; border-radius: 8px;
      cursor: pointer; font-size: 0.85rem; font-weight: 700; color: var(--header-bg); font-family: inherit;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 4px rgba(0,0,0,0.04);
    }
    .pg-btn:hover:not(:disabled) { background: var(--accent-light); border-color: var(--primary); color: var(--primary); transform: translateY(-1px); }
    .pg-btn.active { background: var(--header-bg); color: white; border-color: var(--header-bg); box-shadow: 0 4px 10px rgba(33,108,109,0.2); }
    .pg-btn:disabled { opacity: 0.4; cursor: not-allowed; background: #f8fafc; }
    .pg-ellipsis { padding: 0.5rem; color: var(--text-secondary); font-weight: 700; display: flex; align-items: flex-end; }
    `;
  }

  static render(props: RunSummaryBodyProps): string {
    return RunSummaryBody(props);
  }
}
