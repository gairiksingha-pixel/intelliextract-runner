import { InventoryBody, InventoryBodyProps } from "./InventoryBody.js";

export class InventoryView {
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
    .stat-card.success .stat-value { color: var(--primary); }
    .stat-card.failed .stat-value { color: #f44336; }
    .stat-card.rate .stat-value { color: var(--accent); }

    .chart-card { 
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: 16px; 
      padding: 1.6rem; 
      box-shadow: 0 4px 12px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02);
      margin-bottom: 2rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .chart-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 24px rgba(0,0,0,0.06);
    }
    .chart-card h4 { 
      margin: 0 0 1.25rem; 
      font-size: 0.85rem; 
      text-transform: uppercase; 
      letter-spacing: 0.1em; 
      color: var(--header-bg); 
      border-bottom: 1px solid rgba(176,191,201,0.2); 
      padding-bottom: 0.75rem; 
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .chart-card h4::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 16px;
      background: var(--primary);
      border-radius: 2px;
    }
    .chart-container { position: relative; height: 350px; width: 100%; }

    h3 { color: var(--header-bg); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 2rem 0 1rem; border-bottom: 2px solid var(--border-light); padding-bottom: 0.4rem; }

    table { border-collapse: separate; border-spacing: 0; width: 100%; margin-top: 1rem; background: white; border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--border); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; }
    th { background: var(--surface); color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
    td { font-size: 0.75rem; color: var(--text-secondary); }

    /* Pagination */
    .pagination {
      display: flex;
      gap: 0.4rem;
      justify-content: center;
      margin: 2rem 0;
      padding: 1rem;
    }
    .pg-btn {
      min-width: 38px;
      height: 38px;
      padding: 0 0.8rem;
      border: 1px solid var(--border-light);
      background: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--header-bg);
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pg-btn:hover:not(:disabled) { 
      background: var(--accent-light);
      border-color: var(--primary);
      color: var(--primary);
      transform: translateY(-1px);
    }
    .pg-btn.active { 
      background: var(--header-bg); 
      color: white; 
      border-color: var(--header-bg);
      box-shadow: 0 4px 10px rgba(33, 108, 109, 0.2);
    }
    .pg-btn:disabled { 
      opacity: 0.4; 
      cursor: not-allowed; 
      background: #f8fafc;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #64748b;
      transition: all 0.2s;
      text-decoration: none;
      border: 1px solid var(--border-light);
    }
    .action-btn:hover {
      background: var(--accent-light);
      color: var(--primary);
      border-color: var(--primary);
    }
    .action-cell {
      text-align: center;
      vertical-align: middle;
    }

    .controls-bar {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin: 0.5rem 0 1rem 0;
      background: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      flex-wrap: wrap;
    }

    .search-wrap {
      flex: 1;
      min-width: 300px;
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-wrap svg {
      position: absolute;
      left: 12px;
      color: #94a3b8;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 1rem 0 2.5rem;
      border-radius: 8px;
      border: 1px solid transparent;
      font-size: 0.85rem;
      background: #f1f5f9;
      color: var(--text);
      transition: all 0.2s;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
      background: white;
      box-shadow: 0 0 0 3px var(--accent-light);
    }
    .results-info { font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); }

    .download-chip {
      display: flex;
      align-items: center;
      height: 36px;
      background: white;
      border: 1px solid rgba(176, 191, 201, 0.6);
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    
    #files-table thead th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background 0.2s;
      position: relative;
      padding-right: 2rem;
    }
    #files-table thead th.sortable:hover {
      background: #f1f5f9;
      color: var(--primary);
    }
    #files-table thead th.sortable::after {
      content: '↕';
      position: absolute;
      right: 0.75rem;
      opacity: 0.3;
      font-size: 0.8rem;
    }
    #files-table thead th.sortable.sort-asc::after {
      content: '↑';
      opacity: 1;
      color: var(--primary);
    }
    #files-table thead th.sortable.sort-desc::after {
      content: '↓';
      opacity: 1;
      color: var(--primary);
    }
    `;
  }

  static render(props: InventoryBodyProps): string {
    return InventoryBody(props);
  }
}
