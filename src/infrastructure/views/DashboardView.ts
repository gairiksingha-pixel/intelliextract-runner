import { DashboardBody } from "./DashboardBody.js";

export class DashboardView {
  static getStyles() {
    return `
      /* Dashboard table layout - exact match to reference index.html */
      .table-section {
        flex: 1 1 0%; min-height: 0; overflow: auto; display: flex; flex-direction: column;
        background: var(--surface); border: 1px solid rgba(176, 191, 201, 0.55);
        border-radius: var(--radius); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      }
      .table-section table {
        height: 100%; width: 100%; table-layout: fixed; border-collapse: collapse;
        font-size: 0.9rem; background: var(--surface); border-radius: var(--radius);
      }
      th, td { padding: var(--cell-pad); text-align: center; border: 1px solid rgba(176, 191, 201, 0.55); vertical-align: middle; }
      .op-name { text-align: center; }
      .table-section th:first-child, .table-section td:first-child { border-left: none !important; }
      .table-section th:last-child, .table-section td:last-child { border-right: none !important; }
      .table-section thead th { border-top: none !important; }
      .table-section tbody tr:last-child td { border-bottom: none !important; }
      thead tr { height: 40.8px; }
      thead th { height: 40.8px; box-sizing: border-box; }
      tbody { height: 100%; }
      tbody tr { height: 33.333%; }
      tbody td { height: 33.333%; box-sizing: border-box; }
      thead th {
        background: var(--header-bg); color: var(--header-text);
        font-weight: 700; font-size: 0.8rem; text-transform: none; letter-spacing: 0.02em;
        border: 1px solid rgba(255, 255, 255, 0.1); border-bottom: none; text-align: center;
      }
      tbody tr { background: #f0f9f4; animation: rowEntry 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
      tbody tr.row-inactive { opacity: 0.85; pointer-events: none; }
      tbody tr.row-inactive td { border-color: rgba(33, 108, 109, 0.45); }
      tbody tr.row-inactive td:not(.op-name) { background: var(--row-alt); }
      tbody tr:nth-child(1) { animation-delay: 0.05s; }
      tbody tr:nth-child(2) { animation-delay: 0.1s; }
      tbody tr:nth-child(3) { animation-delay: 0.15s; }
      tbody tr:nth-child(4) { animation-delay: 0.2s; }
      tbody tr:nth-child(5) { animation-delay: 0.25s; }
      tbody td.op-name { background: var(--header-bg); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.15); }
      tbody td.op-name .op-icon-wrap { color: #ffffff; }

      .op-name { width: 181.9px; min-width: 181.9px; max-width: 181.9px; font-weight: 700; }
      .op-content-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.425rem; line-height: 1.25; text-align: center; width: 100%; margin: 0 auto; }
      .op-icon-wrap { width: 1.8rem; height: 1.8rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--primary); }
      .op-title { font-size: 1.1rem; font-weight: 700; margin-top: 0.2rem; display: block; }
      .op-description { font-size: 0.85rem; font-weight: 400; opacity: 0.9; display: block; }
      .op-icon-wrap svg { width: 100%; height: 100%; fill: none; }

      .limits-col { width: 143px; min-width: 143px; max-width: 143px; }
      .limits-cell { font-size: 0.85rem; color: var(--text-secondary); overflow: hidden; vertical-align: top; }
      .limits-cell .limit-row { display: flex; flex-direction: column; gap: 0.425rem; min-height: 1.87rem; }
      .limit-chip {
        display: flex; align-items: center; height: 38px; background: var(--surface);
        border: 1px solid rgba(176, 191, 201, 0.6); border-radius: var(--radius-sm);
        overflow: hidden; box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05); transition: all 0.2s ease;
      }
      .limit-chip:hover:not(:has(input:disabled)) { border-color: rgba(176, 191, 201, 0.7); }
      .limit-chip:has(input:focus) { border-color: var(--primary); box-shadow: 0 0 0 1.7px rgba(45, 157, 95, 0.2); }
      .limits-cell .limit-label {
        background: var(--bg); padding: 0 0.637rem; height: 100%; display: flex; align-items: center;
        border-right: 1px solid rgba(176, 191, 201, 0.55); font-size: 0.7rem; font-weight: 700;
        color: var(--text-secondary); text-transform: uppercase; min-width: 60px; white-space: nowrap;
      }
      .limits-cell input[type="number"] {
        flex: 1; width: 100%; height: 100%; border: none; background: transparent;
        padding: 0 0.51rem; font-size: 0.9rem; font-weight: 700; font-family: inherit;
        color: var(--text); box-shadow: none; text-align: center; transition: all 0.2s ease;
      }
      .limits-cell input[type="number"]::-webkit-inner-spin-button,
      .limits-cell input[type="number"]::-webkit-outer-spin-button { opacity: 0.5; cursor: pointer; transition: opacity 0.2s ease; }
      .limits-cell input:hover::-webkit-inner-spin-button { opacity: 1; }
      .limits-cell input[type="number"]:focus { outline: none; }
      .limits-cell input[type="number"]:disabled { opacity: 0.6; }
      .limit-chip:has(input:disabled) { background: var(--row-alt); box-shadow: none; }
      .limits-cell .limit-hint {
        margin-top: 0.425rem; padding: 0.552rem 1.062rem; font-size: 0.9rem; font-weight: 700;
        color: var(--primary); background: var(--accent-light); border-radius: var(--radius-sm);
        border: 0.85px solid rgba(45, 157, 95, 0.25); display: flex; align-items: center;
        justify-content: center; height: 38px; box-sizing: border-box; width: 100%; text-align: center;
      }
      .field-reset {
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 100%; border: none; background: transparent;
        color: var(--text-secondary); cursor: pointer; opacity: 0.7;
        border-left: 1px solid rgba(176, 191, 201, 0.4); transition: all 0.2s;
      }
      .field-reset:hover:not(:disabled) { opacity: 1; color: var(--fail); background: var(--fail-bg); }
      .field-reset:disabled { opacity: 0.2; cursor: not-allowed; pointer-events: none; }
      .field-reset svg { width: 14px; height: 14px; stroke-width: 2.5; }


      .run-cell { width: 143px; min-width: 143px; max-width: 143px; text-align: center; vertical-align: top; }
      .run-cell .btn-group { display: grid; grid-template-columns: 1fr; gap: 0.425rem; width: 100%; margin: 0 auto; min-width: 0; box-sizing: border-box; }
      .run-cell .btn-row { display: contents; }
      .run-cell .btn-group > .btn-row > button { min-width: 0; }

      button.run {
        background: var(--primary); color: #fff; border: 1px solid rgba(45, 157, 95, 0.25);
        border-radius: var(--radius-sm); height: 38px; padding: 0 1.062rem;
        font-size: 0.9rem; font-weight: 700; cursor: pointer; font-family: inherit;
        box-shadow: var(--shadow-btn); width: 100%; min-width: 0; box-sizing: border-box;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        display: flex; align-items: center; justify-content: center;
      }
      button.run:hover:not(:disabled) { background: var(--primary-hover); box-shadow: 0 1.7px 5.1px rgba(0, 0, 0, 0.18); }
      button.run:disabled { opacity: 0.65; cursor: not-allowed; }

      button.reset-case {
        background: var(--surface); color: var(--text-secondary); border: 0.85px solid rgba(176, 191, 201, 0.45);
        border-radius: var(--radius-sm); height: 38px; padding: 0 0.85rem; font-size: 0.85rem;
        font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: var(--shadow-sm);
        width: 100%; min-width: 0; box-sizing: border-box; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; display: flex; align-items: center; justify-content: center;
      }
      button.reset-case:hover { background: var(--row-alt); color: var(--text); box-shadow: 0 1.7px 3.4px rgba(0, 0, 0, 0.1); }
      button.reset-case.stop-btn { background: var(--fail); color: #fff; border-color: var(--fail); box-shadow: var(--shadow-btn); }
      button.reset-case.stop-btn:hover { background: #a00; border-color: #a00; color: #fff; }
      button.reset-case.pause-btn { background: #379c9d; color: #fff; border: 0.85px solid #2a7a7b; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
      button.reset-case.pause-btn:hover { background: #2a7a7b; border-color: #1e5859; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15); color: #fff; }
      button.reset-case.resume-btn { background: var(--accent-light); border-color: var(--accent); color: var(--accent); }
      button.reset-case.resume-btn:hover { background: var(--accent); color: #fff; }
      button.reset-during-resume { display: none !important; }
      button.reset-during-resume.show-during-resume {
        display: block !important; width: 100%; min-height: 2.337rem;
        box-sizing: border-box; padding: 0.552rem 1.062rem; font-size: 0.9rem;
      }

      .btn-group .retry-failed-btn { background: var(--header-bg); color: #ffffff; border: 1px solid var(--header-border); }
      .btn-group .retry-failed-btn:hover { background: #1a5758; color: #ffffff; border-color: #1a5758; box-shadow: 0 2px 5px rgba(33, 108, 109, 0.2); }
      .btn-group .retry-failed-btn:disabled { background: var(--surface); color: var(--muted); border-color: var(--border-light); box-shadow: none; }

      .result-header { width: 402.9px; min-width: 402.9px; max-width: 402.9px; }
      .result-cell { width: 402.9px; min-width: 402.9px; max-width: 402.9px; vertical-align: top; overflow: hidden; position: relative; }
      .result {
        position: absolute; top: 0.722rem; left: 0.85rem; right: 0.85rem; bottom: 0.722rem;
        font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
        font-size: 0.8rem; padding: 0.51rem 0.637rem; white-space: pre-wrap; word-break: break-word;
        border: 1px solid rgba(203, 213, 225, 0.25); border-radius: var(--radius);
        background: #fafafa; overflow: auto; box-sizing: border-box; box-shadow: var(--shadow-sm); text-align: center;
      }
      .result.pass { background: var(--pass-bg); border-color: #b8e0c8; }
      .result.fail { background: var(--fail-bg); border-color: #f8d4d4; }
      .result.running {
        background: var(--accent-light); border-color: #b8e0c8;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        gap: 0.5rem; padding: 0.5rem; overflow: hidden;
        height: 100%; box-sizing: border-box;
      }
      .result.running > * { position: relative; top: -12%; }


      .result.running .loading-dots::after { content: ""; animation: loading-dots 1.2s steps(4, end) infinite; }
      @keyframes loading-dots { 0%, 20% { content: ""; } 40% { content: "."; } 60% { content: ".."; } 80%, 100% { content: "..."; } }
      .result.result-placeholder {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: #f8fafc; border: 1px dashed rgba(176, 191, 201, 0.5); color: var(--muted);
        text-align: center; padding: 1rem; padding-bottom: calc(1rem + 5%);
        height: calc(100% - 1.444rem); box-sizing: border-box;
      }
      .result-placeholder-text { font-size: 0.825rem; font-weight: 500; line-height: 1.4; opacity: 0.9; display: block; width: 100%; }
      .result-placeholder::before { content: "📋"; font-size: 1.5rem; margin-bottom: 0.5rem; filter: grayscale(1); opacity: 0.3; }
      .result.result-placeholder .result-placeholder-text { color: var(--muted); font-size: 0.85rem; font-style: normal; }
      .result.result-placeholder.result-validation-alert {
        background: #fffbeb; border-color: rgba(245, 158, 11, 0.5); border-style: dashed;
      }
      .result.result-placeholder.result-validation-alert::before { content: "⚠️"; filter: none; opacity: 0.8; }
      .result.result-placeholder.result-validation-alert .result-placeholder-text { color: #92400e; }
      .result .exit { font-weight: 700; margin-bottom: 0.2rem; color: var(--text); width: 100%; text-align: center; }
      .result.running .exit { font-size: 0.825rem; display: block; }
      .result .out { color: var(--text-secondary); }

      .result .sync-progress-wrap { font-size: 1.05rem; font-weight: 700; color: var(--text); width: 100%; text-align: center; line-height: 1.1; margin-top: 0.425rem; }
      .result .extraction-progress-wrap { margin-top: 0.637rem; }
      .result .skip-progress-wrap { margin-top: 0.425rem; color: var(--muted); font-size: 0.825rem; }
      .result .sync-progress-bar {
        width: 100%; height: 21px; background: rgba(203, 213, 225, 0.3);
        border-radius: var(--radius-sm); overflow: hidden;
        box-shadow: 0 0.85px 1.7px rgba(0, 0, 0, 0.06), inset 0 0.85px 1.7px rgba(0, 0, 0, 0.06);
        border: 0.85px solid rgba(176, 191, 201, 0.3);
        margin-top: 0.425rem;
      }
      .result .sync-progress-fill {
        height: 100%; background: linear-gradient(180deg, var(--primary) 0%, var(--primary-hover) 100%);
        border-radius: calc(var(--radius-sm) - 0.85px); transition: width 0.2s ease-out;
        box-shadow: inset 0 0.85px 0 rgba(255, 255, 255, 0.25);
      }
      .result .sync-progress-fill.skip-fill { background: linear-gradient(180deg, #8b9da8 0%, #6b7c85 100%); }
      .result .sync-progress-fill.sync-progress-indeterminate {
        width: 35% !important;
        background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%), var(--primary) !important;
        animation: sync-scanner 1.4s ease-in-out infinite;
        box-shadow: 0 0 10px var(--primary);
      }
      @keyframes sync-scanner {
        0% { transform: translateX(-105%); }
        50% { transform: translateX(190%); }
        100% { transform: translateX(-105%); }
      }

      /* Result detail table */
      .result-table-wrap {
        width: 100%; height: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.8rem;
        table-layout: fixed; border-radius: var(--radius-sm); overflow: hidden; box-shadow: var(--shadow-inset);
      }
      .result-table-wrap th, .result-table-wrap td { padding: 0.425rem 0.51rem; text-align: left; vertical-align: middle; border: 1px solid rgba(203, 213, 225, 0.2); }
      .result-table-wrap th { background: var(--header-bg) !important; color: #ffffff !important; font-weight: 800; width: 195.5px; min-width: 195.5px; border-bottom: none; text-transform: uppercase; font-size: 0.725rem; letter-spacing: 0.05em; }
      .result-table-wrap td { background: var(--surface); color: var(--text-secondary); word-break: break-word; white-space: pre-wrap; font-weight: 500; }
      .result-table-wrap tr { height: 1px; }
      .result-table-wrap tr:nth-child(even) td { background: var(--row-alt); }
      .result-table-wrap tr:first-child th:first-child, .result-table-wrap tr:first-child td:first-child { border-top-left-radius: var(--radius-sm); }
      .result-table-wrap tr:first-child th:last-child, .result-table-wrap tr:first-child td:last-child { border-top-right-radius: var(--radius-sm); }
      .result-table-wrap tr:last-child th:first-child, .result-table-wrap tr:last-child td:first-child { border-bottom-left-radius: var(--radius-sm); }
      .result-table-wrap tr:last-child th:last-child, .result-table-wrap tr:last-child td:last-child { border-bottom-right-radius: var(--radius-sm); }
      .result-table-wrap tr.status-row td { font-weight: 700; font-size: 0.85rem; }
      .result.pass .result-table-wrap tr.status-row td { color: var(--pass); }
      .result.fail .result-table-wrap tr.status-row td { color: var(--fail); }

      .info-icon {
        display: inline-block; margin-left: 0.15rem; width: 16px; height: 16px;
        border-radius: 50%; border: 1px solid var(--primary); color: var(--primary);
        font-size: 0.8rem; font-weight: 700; line-height: 14px; text-align: center;
        cursor: default; background: var(--accent-light); vertical-align: middle;
      }
      .info-icon:hover { border-color: var(--primary-hover); color: var(--primary-hover); }

      /* Schedule Management Modal Styles */
      .schedule-header-row {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.1rem; gap: 0.85rem;
        padding: 0.6rem 0.34rem 0.6rem 0.68rem; background: linear-gradient(90deg, rgba(33, 108, 109, 0.07) 0%, rgba(33, 108, 109, 0.02) 100%);
        border-left: 3.5px solid var(--header-bg); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      }
      .subtitle-chip {
        display: inline-flex; align-items: center; gap: 0.4rem; background: transparent;
        color: var(--header-bg); font-size: 0.8rem; font-weight: 800; letter-spacing: 0.04em;
        text-transform: uppercase; padding: 0;
      }
      .btn-secondary {
        height: 34px; display: inline-flex; align-items: center; justify-content: center;
        background: var(--accent-light); color: var(--primary); border: 1px solid rgba(45, 157, 95, 0.2);
        border-radius: var(--radius-sm); padding: 0 1.25rem; font-size: 0.8rem; font-weight: 700;
        cursor: pointer; font-family: inherit; box-shadow: var(--shadow-sm); transition: all 0.2s ease;
      }
      .btn-secondary:hover {
        background: #dcf2e6; color: var(--primary-hover); border-color: var(--primary); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .schedule-empty {
        color: var(--muted); text-align: center; padding: 2rem 1rem; flex: 1; display: flex; align-items: center; justify-content: center;
      }
      .schedule-list {
        width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.8rem;
        border-radius: var(--radius-sm); overflow: hidden; border: 1px solid rgba(203, 213, 225, 0.4);
      }
      .schedule-list th {
        padding: 0.34rem 0.51rem; border-right: 1px solid rgba(203, 213, 225, 0.4); border-bottom: none;
        text-align: left; vertical-align: top; background: var(--header-bg) !important; color: #ffffff !important; font-weight: 700;
      }
      .schedule-list td {
        padding: 0.34rem 0.51rem; border-bottom: 1px solid rgba(203, 213, 225, 0.45);
        border-right: 1px solid rgba(203, 213, 225, 0.45); text-align: left; vertical-align: top;
        background: var(--surface); color: var(--text-secondary);
      }
      .schedule-list tr:nth-child(even) td { background: var(--row-alt); }
      .schedule-list tr:last-child td { border-bottom: none; }
      .schedule-list tr th:last-child, .schedule-list tr td:last-child { border-right: none; }

      .schedule-outcome-skipped {
        display: inline-block; padding: 0.17rem 0.4rem; border-radius: 0.25rem; font-weight: 700;
        font-size: 0.75rem; background: #fef3c7; color: #92400e;
      }
      .schedule-outcome-executed {
        display: inline-block; padding: 0.17rem 0.4rem; border-radius: 0.25rem; font-weight: 700;
        font-size: 0.75rem; background: #d1fae5; color: #065f46;
      }
      .schedule-form-grid {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.68rem 0.85rem; margin-top: 0.34rem;
      }
      .schedule-field { display: flex; flex-direction: column; gap: 0.21rem; }
      .schedule-label {
        font-size: 0.65rem; font-weight: 800; color: white; background: var(--header-bg);
        padding: 0.25rem 1.1rem 0.25rem 0.65rem; width: fit-content; text-transform: uppercase;
        letter-spacing: 0.06em; margin-bottom: 0.2rem; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
        clip-path: polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%);
      }
      .schedule-hint { font-size: 0.75rem; color: var(--muted); line-height: 1.3; }
      .schedule-note-card {
        background: #f8fafc; border: 1px solid rgba(176, 191, 201, 0.35); border-radius: var(--radius-sm);
        padding: 0.85rem 1rem; margin-top: 1rem; margin-right: 0.34rem; font-size: 0.8rem;
        color: var(--text-secondary); line-height: 1.5; box-shadow: var(--shadow-sm);
        position: relative; overflow: hidden;
      }
      .schedule-note-card::before {
        content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--header-bg);
      }
      .schedule-error { margin-top: 0.34rem; font-size: 0.78rem; color: var(--fail); }
      .schedule-field .filter-dropdown { width: 100%; min-width: 100%; }

      /* Responsive tweaks for 1024x768 matching index.html */
      @media (max-width: 1080px) {
        .header { margin: 0.5rem 1rem 0.25rem 1rem; }
        .header-btn-reset, #brand-dropdown .filter-dropdown-trigger, #purchaser-dropdown .filter-dropdown-trigger { width: 155px !important; }
        .main { padding: 0 1rem 0.75rem 1rem; }
        .result.result-placeholder { padding: 0.75rem; }
        .result-placeholder-text { font-size: 0.75rem; }
      }
      /* Better vertical fit for 768px height matching index.html */
      @media (max-height: 800px) {
        .header { margin-top: 0.25rem; margin-bottom: 0.15rem; }
        .main { padding-top: 0; padding-bottom: 0.5rem; }
        .limit-chip, button.run, .header-btn-reset { height: 32px; font-size: 0.8rem; }
        .op-title { font-size: 0.95rem; }
        .op-description { font-size: 0.75rem; }
      }
    `;
  }

  static render(_props?: { brands: string[]; purchasers: string[] }) {
    return DashboardBody();
  }
}
