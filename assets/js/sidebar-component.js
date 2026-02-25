(function () {
  if (!document.getElementById("sidebar-component-styles")) {
    const style = document.createElement("style");
    style.id = "sidebar-component-styles";
    style.textContent = `
      .sidebar {
        width: 275px;
        min-width: 0;
        background: #ffffff;
        border-right: 1px solid rgba(176, 191, 201, 0.3);
        display: flex;
        flex-direction: column;
        height: 100vh;
        position: sticky;
        top: 0;
        z-index: 2000;
        padding: 2rem 0;
        box-shadow: 4px 0 15px rgba(0, 0, 0, 0.02);
        transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: visible;
      }
      .sidebar.collapsed {
        width: 80px;
      }
      .sidebar-toggle-btn {
        position: absolute;
        right: -12px;
        top: 30px;
        width: 24px;
        height: 24px;
        background: white;
        border: 1px solid rgba(176, 191, 201, 0.3);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2100;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        transition: all 0.3s;
        color: #5a5a5a;
      }
      .sidebar-toggle-btn:hover {
        background: #e8f5ee;
        color: #2d9d5f;
        border-color: #2d9d5f;
      }
      .sidebar-toggle-btn svg {
        width: 14px;
        height: 14px;
        transition: transform 0.3s;
        stroke-width: 2.5;
      }
      .sidebar.collapsed .sidebar-toggle-btn svg {
        transform: none;
      }
      .sidebar-header {
        padding: 0 1.75rem 2.5rem 1.75rem;
        transition: padding 0.3s;
        position: relative;
      }
      .sidebar.collapsed .sidebar-header {
        padding: 0 0.75rem 2.5rem 0.75rem;
        display: flex;
        justify-content: center;
      }
      .sidebar-logo {
        height: 36px;
        width: auto;
        max-width: 100%;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.05));
        transition: height 0.3s;
      }
      .logo-small {
        display: none;
        height: 32px;
        width: auto;
      }
      .sidebar.collapsed .sidebar-logo {
        display: none;
      }
      .sidebar.collapsed .logo-small {
        display: block;
      }
      .sidebar-nav {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding: 0 1rem;
      }
      .nav-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.85rem 1.25rem;
        border-radius: 12px;
        color: #64748b;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
        border: 1px solid transparent;
        overflow: hidden;
      }
      .sidebar.collapsed .nav-item {
        padding: 0.85rem;
        justify-content: center;
        gap: 0;
      }
      .nav-item span {
        transition: opacity 0.2s, transform 0.2s;
        opacity: 1;
      }
      .sidebar.collapsed .nav-item span {
        opacity: 0;
        width: 0;
        pointer-events: none;
        transform: translateX(10px);
      }
      .nav-item svg {
        width: 22px;
        height: 22px;
        stroke-width: 2;
        transition: all 0.3s;
        opacity: 0.8;
      }
      .nav-item:hover {
        background: #f8fafc;
        color: #1e293b;
        transform: translateX(4px);
      }
      .nav-item:hover svg {
        opacity: 1;
        color: #2d9d5f;
      }
      .nav-item.active {
        background: #e8f5ee;
        color: #1e293b;
        box-shadow: 0 4px 12px rgba(45, 157, 95, 0.1);
        border-color: rgba(45, 157, 95, 0.1);
        pointer-events: none;
        cursor: default;
      }
      .nav-item.active svg {
        color: #2d9d5f;
        opacity: 1;
        transform: scale(1.1);
      }
`;
    document.head.appendChild(style);
  }

  class AppSidebar extends HTMLElement {
    connectedCallback() {
      const activeTab = this.getAttribute("active-tab") || "";
      const logoUri = this.getAttribute("logo-uri") || "/assets/logo.png";
      const smallLogoUri =
        this.getAttribute("small-logo-uri") || "/assets/logo-small.png";

      const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
      const sidebarWidth = isCollapsed ? "80px" : "275px";
      const collapsedClass = isCollapsed ? "collapsed" : "";

      this.innerHTML = `
                <aside class="sidebar ${collapsedClass}" id="sidebar" style="width: ${sidebarWidth}">
                    <div class="sidebar-toggle-btn" onclick="toggleSidebar()" title="Toggle Sidebar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </div>
                    <div class="sidebar-header">
                        <a href="/">
                            <img src="${logoUri}" alt="intellirevenue" class="sidebar-logo">
                            <img src="${smallLogoUri}" alt="ir" class="logo-small">
                        </a>
                    </div>
                    <nav class="sidebar-nav">
                        <a href="/" class="nav-item ${activeTab === "dashboard" ? "active" : ""}" data-tab="dashboard">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                            <span>Operations</span>
                        </a>
                        <a href="/reports/inventory" class="nav-item ${activeTab === "inventory" ? "active" : ""}" data-tab="inventory">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path></svg>
                            <span>Inventory</span>
                        </a>
                        <a href="/reports/summary" class="nav-item ${activeTab === "summary" ? "active" : ""}" data-tab="summary">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
                            <span>Run Summary</span>
                        </a>
                        <a href="/reports/explorer" class="nav-item ${activeTab === "explorer" ? "active" : ""}" data-tab="explorer">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                            <span>Data Explorer</span>
                        </a>
                    </nav>
                </aside>
            `;
    }
  }

  if (!window.toggleSidebar) {
    window.toggleSidebar = function () {
      const sidebar = document.getElementById("sidebar");
      if (!sidebar) return;
      const isCollapsed = sidebar.classList.contains("collapsed");
      if (isCollapsed) {
        sidebar.classList.remove("collapsed");
        sidebar.style.width = "275px";
      } else {
        sidebar.classList.add("collapsed");
        sidebar.style.width = "80px";
      }
      localStorage.setItem("sidebarCollapsed", !isCollapsed);
    };
  }

  if (!customElements.get("app-sidebar")) {
    customElements.define("app-sidebar", AppSidebar);
  }
})();
