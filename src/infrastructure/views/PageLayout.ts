import { commonStyles } from "./style.js";
import {
  NotificationModal,
  AlertModal,
  ScheduleModal,
  ExtractionDataModal,
  ReportViewOverlay,
} from "./Modals.js";

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
  <script type="module" src="/assets/js/icons.js"></script>
  <script type="module" src="/assets/js/common.js"></script>
  <script type="module" src="/assets/js/sidebar-component.js"></script>
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
      ${ScheduleModal()}
      ${ExtractionDataModal()}
      ${ReportViewOverlay()}
    </div>
  </div>
  ${scripts}
</body>
</html>`;
}
