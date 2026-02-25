import { commonStyles } from "./style.js";
import { NotificationModal, AlertModal } from "./Modals.js";

interface PageLayoutProps {
  title: string;
  content: string;
  scripts?: string;
  styles?: string;
  meta?: string;
  favIcon?: string;
  logo?: string;
  smallLogo?: string;
  activeTab?: string;
}

export function PageLayout({
  title,
  content,
  scripts = "",
  styles = "",
  meta = "",
  favIcon = "",
  logo = "",
  smallLogo = "",
  activeTab = "",
}: PageLayoutProps) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — IntelliExtract</title>
  ${favIcon ? `<link rel="icon" href="${favIcon}" type="image/x-icon">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    ${commonStyles}
    ${styles}
    body { visibility: hidden; }
    body.ready { visibility: visible; animation: pageFadeIn 0.4s ease-out; }
  </style>
  <script src="/assets/js/common.js"></script>
  <script src="/assets/js/sidebar-component.js"></script>
  ${meta}
</head>
<body style="background: #f5f7f9; color: var(--text);">
  <script>document.body.className += ' ready';</script>
  <div id="page-loader">
    <div class="loader-spinner"></div>
    <div class="loader-text">Loading...</div>
  </div>
  <div class="app-container">
    <app-sidebar active-tab="${activeTab}" logo-uri="${logo}" small-logo-uri="${smallLogo}"></app-sidebar>
    <div class="content-wrapper">
      ${content}
    </div>
  </div>
  ${NotificationModal()}
  ${AlertModal()}
  ${scripts}
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        const loader = document.getElementById('page-loader');
        if (loader) loader.style.display = 'none';
      }, 300);
    });
  </script>
</body>
</html>`;
}
