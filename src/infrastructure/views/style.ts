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
      --primary: #2d9d5f;
      --accent-light: #e8f5ee;
      --pass: #248f54;
      --pass-bg: #e8f5ee;
      --fail: #c62828;
      --fail-bg: #ffebee;
      --muted: #6b7c85;
      --radius: 12px;
      --radius-sm: 8px;
    }
    * { box-sizing: border-box; }
    html { overflow-y: scroll; scrollbar-gutter: stable; }
    @keyframes pageFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    body {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      animation: pageFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    /* Shared Sidebar Layout */
    .app-container { display: flex; min-height: 100vh; width: 100%; }
    .content-wrapper { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; overflow-y: auto; background: #f5f7f9; }
    
    /* Page Loader */
    #page-loader {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; flex-direction: column; gap: 1.5rem;
      animation: fadeIn 0.3s ease;
    }
    .loader-spinner {
      width: 48px; height: 48px;
      border: 4px solid var(--primary);
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      animation: rotation 1s linear infinite;
    }
    @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* Universal Modal Styles */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); 
      backdrop-filter: blur(4px); z-index: 3000;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; visibility: hidden; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-overlay.open { opacity: 1; visibility: visible; }
    .modal-content {
      background: white; width: 620px; max-width: 90%; max-height: 90vh;
      border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 20px 50px rgba(0,0,0,0.15);
      transform: translateY(20px) scale(0.98); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-overlay.open .modal-content { transform: translateY(0) scale(1); }
    .modal-header { padding: 1.5rem 2rem; background: white; border-bottom: 1px solid var(--border-light); display: flex; align-items: center; justify-content: space-between; }
    .modal-title { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--header-bg); }
    .modal-close-icon { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
    .modal-body { padding: 2rem; overflow-y: auto; }
    .modal-footer { padding: 1.25rem 2rem; background: #f8fafc; border-top: 1px solid var(--border-light); display: flex; justify-content: flex-end; gap: 1rem; }

    /* Form Elements */
    .schedule-field { margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .schedule-label { font-size: 0.75rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
    .schedule-input { height: 42px; border: 1px solid var(--border); border-radius: 8px; padding: 0 1rem; font-family: inherit; font-size: 0.9rem; }
    .schedule-input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 3px var(--accent-light); }
    .schedule-hint { font-size: 0.7rem; color: var(--muted); line-height: 1.5; }
    
    .subtitle-chip { font-size: 0.75rem; font-weight: 700; color: var(--primary); background: var(--accent-light); padding: 0.4rem 0.8rem; border-radius: 100px; display: inline-flex; margin-bottom: 1rem; }

    /* Alert Special Styles */
    .alert-content { width: 440px; text-align: center; }
    .alert-badge { display: inline-block; padding: 0.25rem 0.75rem; background: var(--primary); color: white; border-radius: 100px; font-size: 0.65rem; font-weight: 800; margin: 1.5rem 0 1rem; }
    .alert-message { font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 2rem; line-height: 1.6; padding: 0 1rem; }

    /* Shared Buttons */
    .btn-secondary { height: 38px; padding: 0 1.25rem; background: #fff; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; color: var(--text-secondary); font-weight: 700; transition: all 0.2s; }
    .btn-secondary:hover { background: #f8fafc; border-color: var(--border-light); }
    .download-report-btn { height: 38px; padding: 0 1.5rem; background: var(--header-bg); border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 700; display: inline-flex; align-items: center; transition: all 0.2s; }
    .download-report-btn:hover { filter: brightness(1.1); }
    
    @keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;
