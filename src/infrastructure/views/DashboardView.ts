import { DashboardBody } from "./DashboardBody.js";

export class DashboardView {
  static getStyles() {
    return `
      :root {
        --bg: #f5f7f9;
        --surface: #ffffff;
        --text: #2c2c2c;
        --text-secondary: #5a5a5a;
        --border: #b0bfc9;
        --border-light: #cbd5e1;
        --header-bg: #216c6d;
        --header-text: #ffffff;
        --header-border: #1a5758;
        --accent: #2d9d5f;
        --accent-light: #e8f5ee;
        --primary: #2d9d5f;
        --primary-hover: #248f54;
        --pass: #248f54;
        --pass-bg: #e8f5ee;
        --fail: #c62828;
        --fail-bg: #ffebee;
        --muted: #6b7c85;
        --row-alt: #fafbfc;
        --cell-pad: 0.722rem 0.85rem;
        --radius: 6.8px;
        --radius-sm: 5.1px;
        --radius-xs: 3.4px;
        --shadow-sm: 0 0.85px 2.55px rgba(0, 0, 0, 0.08);
        --shadow-md: 0 1.7px 6.8px rgba(0, 0, 0, 0.1);
        --shadow-lg:
          0 12px 30px -10px rgba(0, 0, 0, 0.15),
          0 4px 15px -5px rgba(0, 0, 0, 0.1);
        --shadow-inset: inset 0 0.85px 1.7px rgba(0, 0, 0, 0.06);
        --shadow-btn: 0 0.85px 2.55px rgba(0, 0, 0, 0.12);
        --warning: #f59e0b;
        --warning-hover: #d97706;
      }

      @keyframes appFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes headerSlideDown {
        from { opacity: 0; transform: translateY(-12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes mainSlideUp {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes rowEntry {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .header {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(176, 191, 201, 0.45);
        border-radius: var(--radius);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
        margin: 0.75rem auto 0.5rem auto;
        width: calc(100% - 2.5rem);
        max-width: 1820px;
        position: sticky;
        top: 0;
        z-index: 1000;
        min-height: 72px;
        padding: 0.6rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        animation: headerSlideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        padding: 0 0 1.25rem 0;
        max-width: 1820px;
        width: calc(100% - 2.5rem);
        margin: 0 auto;
        box-sizing: border-box;
        animation: mainSlideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: 0.1s;
      }

      .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
      .header-title-area { display: flex; flex-direction: column; gap: 2px; }
      .header-main-title {
        margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text);
        letter-spacing: -0.01em; line-height: 1.2;
      }

      .system-status-pill {
        display: flex; align-items: center; gap: 0.6rem; background: white;
        padding: 0.5rem 1rem; border-radius: 100px; border: 1px solid var(--border-light);
        margin-left: 1.5rem; font-size: 0.7rem; font-weight: 800; color: var(--text-secondary);
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .system-status-pill.busy { border-color: #fbbf24; color: #92400e; background: #fffbeb; }
      .system-status-pill.offline { border-color: #f87171; color: #991b1b; background: #fef2f2; }

      .table-section {
        flex: 1 1 0%; min-height: 0; overflow: auto; display: flex;
        flex-direction: column; background: var(--surface);
        border: 1px solid rgba(176, 191, 201, 0.55); border-radius: var(--radius);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      }
      .table-section table {
        width: 100%; border-collapse: collapse; font-size: 0.9rem;
        background: var(--surface); border-radius: var(--radius);
      }
      th, td { padding: var(--cell-pad); text-align: center; border: 1px solid rgba(176, 191, 201, 0.55); vertical-align: middle; }
      
      thead th {
        background: var(--header-bg); color: var(--header-text);
        font-weight: 700; font-size: 0.8rem; letter-spacing: 0.02em;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      /* Filtering and Header Elements */
      .header-filter-row { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; }
      .filter-chip {
        display: flex; align-items: center; height: 34px; background: var(--surface);
        border: 0.85px solid rgba(176, 191, 201, 0.6); border-radius: var(--radius-sm);
        transition: all 0.2s ease; box-shadow: 0 0.85px 1.7px rgba(0, 0, 0, 0.06);
        overflow: hidden;
      }
      .filter-chip .header-label {
        font-size: 0.725rem; color: var(--primary); font-weight: 800; background: var(--pass-bg);
        padding: 0 0.85rem; height: 100%; display: flex; align-items: center;
        border-right: 1.2px solid rgba(45, 157, 95, 0.2); text-transform: uppercase; letter-spacing: 0.04em;
      }
      
      .filter-dropdown-trigger {
        border: none; background: transparent; height: 100%; padding: 0.297rem 1.7rem 0.297rem 0.51rem;
        font-size: 0.8rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
        width: 185px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 0.425rem center;
      }

      .header-btn-reset {
        height: 34px; width: 34px; padding: 0; background: var(--header-bg); color: var(--header-text);
        border: 0.85px solid var(--header-border); border-radius: var(--radius-sm);
        cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;
      }

      /* Operation Rows */
      tbody tr { animation: rowEntry 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
      tbody td.op-name { background: var(--header-bg); color: #ffffff; width: 181.9px; max-width: 181.9px; }
      .op-content-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.425rem; }
      .op-title { font-size: 1.1rem; font-weight: 700; margin-top: 0.2rem; }
      .op-description { font-size: 0.85rem; font-weight: 400; opacity: 0.9; }
      .op-icon-wrap { width: 1.8rem; height: 1.8rem; color: white; flex-shrink: 0; }
      .op-icon-wrap svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; }

      .limit-chip {
        display: flex; align-items: center; height: 38px; background: var(--surface);
        border: 1px solid rgba(176, 191, 201, 0.6); border-radius: var(--radius-sm);
        padding: 0 0.5rem; gap: 0.5rem;
      }
      .limit-label { font-size: 0.7rem; font-weight: 800; color: var(--muted); text-transform: uppercase; width: 45px; text-align: left; }
      .limit-chip input {
        border: none; background: transparent; font-family: inherit; font-size: 0.9rem;
        font-weight: 700; color: var(--header-bg); width: 45px; text-align: right;
      }

      .btn-primary.run {
        background: var(--primary); color: white; border: none; height: 40px; border-radius: 10px;
        padding: 0 1.25rem; font-weight: 800; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 0.5rem;
        cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-btn);
      }
      .btn-primary.run:hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(45, 157, 95, 0.3); filter: brightness(1.05); }

      .result {
        border-radius: 12px; padding: 1rem; min-height: 80px; display: flex; flex-direction: column; justify-content: center;
        border: 1px solid var(--border-light); background: #f8fafc; font-family: "JetBrains Mono", monospace; font-size: 0.8rem;
        text-align: center;
      }
      .result.pass { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
      .result.fail { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
      .result.running { background: #f0f9ff; border-color: #bae6fd; color: #0369a1; }
    `;
  }

  static render(_props?: { brands: string[]; purchasers: string[] }) {
    return DashboardBody();
  }
}
