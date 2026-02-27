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
  <title>${title} — intellirevenue</title>
  ${favIcon ? `<link rel="icon" href="${favIcon}" type="image/x-icon">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    ${commonStyles}
    ${styles}
  </style>
  <script src="/assets/js/sidebar-component.js"></script>
  ${meta}
</head>
<body>
  <div id="page-loader">
    <div class="loader-spinner"></div>
    <div class="loader-text">Loading...</div>
  </div>
  <div class="app-container">
    <app-sidebar active-tab="${activeTab}" logo-uri="${logo}" small-logo-uri="${smallLogo}"></app-sidebar>
    <div class="content-wrapper">
      ${content}
      ${NotificationModal()}
      ${AlertModal()}
    </div>
  </div>
  ${scripts}
  <script>
    (function() {
      function showLoader() { var l = document.getElementById('page-loader'); if (l) l.style.display = 'flex'; }
      function hideLoader() { var l = document.getElementById('page-loader'); if (l) l.style.display = 'none'; }
      if (document.readyState === 'complete') { hideLoader(); }
      window.addEventListener('pageshow', function(e) { if (e.persisted) { hideLoader(); } else { hideLoader(); } });
      window.addEventListener('load', hideLoader);
      setTimeout(hideLoader, 5000);
      document.addEventListener('click', function(e) {
        var t = e.target.closest('a');
        if (t && t.href && !t.href.startsWith('javascript:') && !t.href.startsWith('#') && t.target !== '_blank' && !e.ctrlKey && !e.metaKey) {
          var currentUrl = window.location.href.split('#')[0].split('?')[0];
          var targetUrl = t.href.split('#')[0].split('?')[0];
          if (targetUrl !== currentUrl && targetUrl !== currentUrl + '/' && currentUrl !== targetUrl + '/') {
            showLoader();
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}
