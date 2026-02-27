export const commonStyles = `
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
      --shadow-lg: 0 12px 30px -10px rgba(0, 0, 0, 0.15), 0 4px 15px -5px rgba(0, 0, 0, 0.1);
      --shadow-inset: inset 0 0.85px 1.7px rgba(0, 0, 0, 0.06);
      --shadow-btn: 0 0.85px 2.55px rgba(0, 0, 0, 0.12);
      --warning: #f59e0b;
      --warning-hover: #d97706;
    }
    * { box-sizing: border-box; }
    button, input, select, textarea { font-family: inherit; }

    /* Universal Button Sliding & Hover Effects */
    button:not(:disabled):not(.modal-close-icon):not(.filter-dropdown-trigger) {
      position: relative; overflow: hidden; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    button:not(:disabled):not(.modal-close-icon):not(.filter-dropdown-trigger)::after {
      content: ""; position: absolute; top: 0; left: -150%; width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), rgba(45, 157, 95, 0.15), rgba(255, 255, 255, 0.4), transparent);
      transform: skewX(-20deg); z-index: 10; pointer-events: none;
    }
    button:not(:disabled):not(.modal-close-icon):not(.filter-dropdown-trigger):hover::after {
      left: 150%; transition: left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    button:active:not(:disabled) { transform: scale(0.97); }

    html { overflow-y: scroll; scrollbar-gutter: stable; }

    @keyframes appFadeIn { from { opacity: 0; } to { opacity: 1; } }
    body {
      font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
      margin: 0; padding: 0; background: var(--bg); color: var(--text);
      line-height: 1.4; font-size: 13px; display: flex; flex-direction: column;
      animation: appFadeIn 0.6s ease-out both;
    }

    /* Shared Sidebar Layout */
    .app-container { display: flex; min-height: 100vh; width: 100%; }
    .content-wrapper { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; overflow-y: auto; background: #f5f7f9; }

    @keyframes headerSlideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    .header {
      background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(10px);
      border: 1px solid rgba(176, 191, 201, 0.45); border-radius: var(--radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06); margin: 0.75rem auto 0.5rem auto;
      width: calc(100% - 2.5rem); max-width: 1820px; box-sizing: border-box;
      position: sticky; top: 0; z-index: 1000; min-height: 72px;
      padding: 0.6rem 1.25rem; display: flex; align-items: center; justify-content: space-between;
      animation: headerSlideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-title-area { display: flex; flex-direction: column; gap: 2px; }
    .header-main-title { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text); letter-spacing: -0.01em; line-height: 1.2; }

    /* Header Actions */
    .header-actions-wrap { display: flex; align-items: center; gap: 0.75rem; margin-right: 1.25rem; }
    .header-action-btn {
      height: 32px; padding: 0 0.85rem; border-radius: var(--radius-sm);
      font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 6px;
      cursor: pointer; transition: all 0.2s; border: 1px solid rgba(176, 191, 201, 0.4);
      background: #f8fafc; color: var(--text-secondary); white-space: nowrap;
    }
    .header-action-btn:hover { background: #f1f5f9; border-color: var(--primary); color: var(--primary); }
    .header-action-btn.primary { background: var(--primary); color: white; border-color: var(--primary); }
    .header-action-btn.primary:hover { background: var(--primary-hover); filter: brightness(1.05); }

    .header-filter-row { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; }
    .header-field-wrap { display: flex; align-items: center; margin-right: 0.5rem; height: 34px; }
    .header-field-wrap > .header-field-error { display: none; }
    .header-field-error { display: none; }

    .logo-link { text-decoration: none; display: block; transition: opacity 0.2s ease; }
    .logo-link:hover { opacity: 0.85; }
    .header .logo { height: 32px; width: auto; display: block; object-fit: contain; cursor: pointer; }
    .header-label { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; font-weight: 700; }

    .filter-chip {
      display: flex; align-items: center; height: 34px; background: var(--surface);
      border: 0.85px solid rgba(176, 191, 201, 0.6); border-radius: var(--radius-sm);
      transition: all 0.2s ease; box-shadow: 0 0.85px 1.7px rgba(0, 0, 0, 0.06); overflow: hidden;
    }
    .filter-chip:hover { border-color: rgba(176, 191, 201, 0.7); }
    .filter-chip:focus-within { border-color: var(--primary); box-shadow: 0 0 0 1.7px rgba(45, 157, 95, 0.2); }
    .filter-chip .header-label {
      font-size: 0.725rem; color: var(--primary); white-space: nowrap; font-weight: 800;
      background: var(--pass-bg); padding: 0 0.85rem; height: 100%; display: flex; align-items: center;
      border-right: 1.2px solid rgba(45, 157, 95, 0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }

    .filter-dropdown { position: relative; width: 180px; min-width: 180px; }
    .header-filter-row .filter-dropdown { width: 180px; min-width: 180px; }
    #brand-dropdown, #purchaser-dropdown { width: auto; max-width: none; }
    #brand-dropdown .filter-chip, #purchaser-dropdown .filter-chip { width: auto !important; }
    #brand-dropdown .filter-dropdown-trigger { width: 185px !important; }
    #purchaser-dropdown .filter-dropdown-trigger { width: 185px !important; }
    .brand-field-wrap { flex: 0 0 auto; }
    .purchaser-field-wrap { flex: 0 0 auto; }

    .filter-dropdown-trigger {
      width: 100%; height: 34px; padding: 0.297rem 1.7rem 0.297rem 0.51rem;
      border: 1px solid rgba(45, 157, 95, 0.2); border-radius: var(--radius-sm);
      background: var(--accent-light); color: var(--text-secondary); font-size: 0.8rem;
      font-family: inherit; text-align: center; cursor: pointer; box-sizing: border-box;
      transition: all 0.2s ease; display: flex; align-items: center; justify-content: center;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%232d9d5f' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 0.425rem center;
    }
    .filter-chip .filter-dropdown-trigger {
      width: 180px; height: 100%; border: none; background-color: transparent;
      box-shadow: none; padding: 0 1.5rem; justify-content: center;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
    }
    .filter-dropdown-trigger:hover {
      border-color: rgba(176, 191, 201, 0.7);
      box-shadow: 0 1.7px 3.4px rgba(0, 0, 0, 0.08), inset 0 0.85px 0.85px rgba(255, 255, 255, 0.9);
    }
    .filter-dropdown-trigger:focus {
      outline: none; border-color: var(--primary);
      box-shadow: 0 0 0 1.7px rgba(45, 157, 95, 0.2), 0 1.7px 3.4px rgba(0, 0, 0, 0.08), inset 0 0.85px 0.85px rgba(255, 255, 255, 0.9);
    }
    .filter-dropdown-panel {
      display: none; position: absolute; top: 100%; left: 0; margin-top: 8px;
      min-width: 100%; max-height: 400px; overflow-y: auto;
      border: 1px solid rgba(176, 191, 201, 0.4); border-radius: var(--radius-sm);
      background: var(--surface); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      z-index: 100; padding: 0.5rem 0; opacity: 0;
      transform: scale(0.96) translateY(4px); transform-origin: top; will-change: transform, opacity;
    }
    .filter-dropdown-panel.open {
      display: block; animation: dropdownScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: all;
    }
    @keyframes dropdownScaleIn { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    .filter-dropdown-option { display: flex; align-items: center; gap: 0.425rem; padding: 0.34rem 0.51rem; font-size: 0.8rem; cursor: pointer; white-space: nowrap; }
    .filter-dropdown-option:hover { background: var(--row-alt); }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }

    .header-filter-reset-wrap { margin-right: 0 !important; }
    .header-filter-reset-wrap .header-btn-reset { margin-top: 0; }
    .header-btn-reset {
      height: 34px; width: 34px; padding: 0; border: 0.85px solid var(--header-border);
      border-radius: var(--radius-sm); background: var(--header-bg); color: var(--header-text);
      font-family: inherit; cursor: pointer; box-shadow: var(--shadow-btn);
      transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;
    }
    .header-btn-reset:focus { outline: none; border-color: var(--header-text); box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3); }
    .header-btn-reset:hover { background: var(--primary-hover); border-color: var(--primary-hover); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15); }

    @keyframes mainSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    .main {
      flex: 1; display: flex; flex-direction: column; min-height: 0;
      padding: 0 0 1.25rem 0; max-width: 1820px; width: calc(100% - 2.5rem);
      margin: 0 auto; box-sizing: border-box;
      animation: mainSlideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: 0.1s;
    }

    /* System Status Pill */
    .system-status-pill {
      display: flex; align-items: center; gap: 0.5rem; background: white;
      padding: 0.4rem 0.85rem; border-radius: 100px; border: 1px solid rgba(203, 213, 225, 0.5);
      margin-left: 1.25rem; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);
      box-shadow: var(--shadow-sm); transition: all 0.3s ease;
    }
    .system-status-pill.busy { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .system-status-pill.offline { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
    .pulse-dot { width: 8px; height: 8px; background: var(--primary); border-radius: 50%; box-shadow: 0 0 0 0 rgba(45, 157, 95, 0.4); animation: pulse 2s infinite; }
    .busy .pulse-dot { background: #f59e0b; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); animation: pulse-busy 1.5s infinite; }
    .offline .pulse-dot { background: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); animation: pulse-offline 1s infinite; }
    @keyframes pulse { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(45, 157, 95, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(45, 157, 95, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(45, 157, 95, 0); } }
    @keyframes pulse-busy { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); } }
    @keyframes pulse-offline { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: scale(1.1); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }

    /* Page Loader */
    #page-loader {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; flex-direction: column; gap: 1.5rem; animation: fadeIn 0.3s ease;
    }
    .loader-spinner {
      width: 48px; height: 48px; border: 4px solid var(--primary); border-bottom-color: transparent;
      border-radius: 50%; display: inline-block; box-sizing: border-box; animation: rotation 1s linear infinite;
    }
    .loader-text { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--header-bg); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
    @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .btn-icon-inline { width: 14px; height: 14px; margin-right: 6px; vertical-align: text-bottom; }

    /* Modal Styles */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(2, 6, 23, 0.65);
      backdrop-filter: blur(5px); display: none; align-items: center; justify-content: center;
      z-index: 5000; pointer-events: none; transition: all 0.3s ease;
    }
    .modal-overlay.open { display: flex; pointer-events: all; animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes modalFadeOut { from { opacity: 1; } to { opacity: 0; } }
    .modal {
      background: var(--surface); border-radius: 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05);
      width: 1152px; max-width: 90vw; height: 786px; max-height: 85vh;
      padding: 0; box-sizing: border-box; display: flex; flex-direction: column;
      animation: modalSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; overflow: hidden;
    }
    @keyframes modalSlideUp { from { opacity: 0; transform: scale(0.96) translateY(24px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes modalSlideDown { from { opacity: 1; transform: scale(1) translateY(0); } to { opacity: 0; transform: scale(0.96) translateY(24px); } }
    .modal-overlay.closing { animation: modalFadeOut 0.25s ease-in forwards; }
    .modal-overlay.closing .modal { animation: modalSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes slideInRight { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
    .modal-screen-animate { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: visible; }
    .modal-screen-animate.slide-right { animation: slideInRight 0.18s cubic-bezier(0.2, 0, 0, 1) forwards; }
    .modal-screen-animate.slide-left { animation: slideInLeft 0.18s cubic-bezier(0.2, 0, 0, 1) forwards; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.75rem; background: white; border-bottom: 1px solid rgba(203, 213, 225, 0.4); }
    .modal-title { display: flex; align-items: center; gap: 0.75rem; font-size: 1.15rem; font-weight: 700; color: var(--header-bg); }
    .title-badge {
      background: var(--primary); color: white; font-size: 0.625rem; font-weight: 800;
      padding: 0.35rem 1.25rem 0.35rem 0.75rem;
      clip-path: polygon(0% 0%, calc(100% - 12px) 0%, 100% 50%, calc(100% - 12px) 100%, 0% 100%);
      text-transform: uppercase; letter-spacing: 0.1em;
    }
    .modal-body {
      padding: 1.75rem; flex: 1; overflow-y: visible; scrollbar-width: thin; scrollbar-color: var(--border) transparent; display: flex; flex-direction: column;
    }
    .modal-body::-webkit-scrollbar { width: 6px; }
    .modal-body::-webkit-scrollbar-track { background: transparent; }
    .modal-body::-webkit-scrollbar-thumb { background-color: rgba(176, 191, 201, 0.6); border-radius: 20px; }
    .modal-footer { padding: 1.25rem 1.8rem; background: #f8fafc; border-top: 1px solid rgba(203, 213, 225, 0.45); display: flex; justify-content: flex-end; gap: 0.75rem; }
    .modal-close-icon { border: none; background: transparent; cursor: pointer; font-size: 1rem; color: var(--muted); padding: 0.17rem; }
    .modal-close-icon:hover { color: var(--fail); }

    /* Buttons */
    .btn-secondary {
      height: 34px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent-light); color: var(--primary); border: 1px solid rgba(45, 157, 95, 0.2);
      border-radius: var(--radius-sm); padding: 0 1.25rem; font-size: 0.8rem; font-weight: 700;
      cursor: pointer; font-family: inherit; box-shadow: var(--shadow-sm); transition: all 0.2s ease;
    }
    .btn-secondary:hover { background: #dcf2e6; color: var(--primary-hover); border-color: var(--primary); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }

    button.download-sync-report-btn,
    button.download-report-btn {
      height: 34px; border: none; border-radius: var(--radius-sm); padding: 0 0.5rem;
      font-size: 0.8rem; font-weight: 700; cursor: pointer; font-family: inherit;
      box-sizing: border-box; box-shadow: var(--shadow-btn); color: #fff;
      width: 180px; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;
    }
    button.download-report-schedule-btn {
      background: var(--primary) !important; color: #fff !important; box-shadow: var(--shadow-btn) !important;
    }
    button.download-report-schedule-btn:hover:not(:disabled) { background: var(--primary-hover) !important; }

    /* Schedule Styles */
    .schedule-header-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1.1rem; gap: 0.85rem;
      padding: 0.6rem 0.34rem 0.6rem 0.68rem;
      background: linear-gradient(90deg, rgba(33, 108, 109, 0.07) 0%, rgba(33, 108, 109, 0.02) 100%);
      border-left: 3.5px solid var(--header-bg); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }
    .subtitle-chip { display: inline-flex; align-items: center; gap: 0.4rem; background: transparent; color: var(--header-bg); font-size: 0.8rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 0; }
    .schedule-list {
      width: 100%; border-collapse: separate; border-spacing: 0;
      font-size: 0.8rem; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid rgba(203, 213, 225, 0.4);
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
    .schedule-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 4rem 2rem; color: var(--muted); text-align: center;
      background: #f8fafc; border: 2px dashed rgba(203, 213, 225, 0.4); border-radius: var(--radius);
    }
    .schedule-empty::before {
      content: ""; display: block; width: 48px; height: 48px; margin: 0 auto 1rem; opacity: 0.45;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23216c6d' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E");
      background-repeat: no-repeat; background-size: contain; background-position: center;
    }

    .badge { display: inline-block; padding: 0.2rem 0.5rem; font-size: 0.72rem; font-weight: 700; border-radius: 4px; }
    .badge-pass { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .badge-fail { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

    /* Report card container for Inventory/Explorer */
    .report-card-box {
      background: var(--surface); border: 1px solid rgba(176, 191, 201, 0.55);
      border-radius: var(--radius); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      overflow: hidden; display: flex; flex-direction: column; flex: 1;
    }

    @keyframes rowEntry { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;
