import nodemailer from "nodemailer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INotificationService } from "../../core/domain/services/INotificationService.js";

export class NodemailerService implements INotificationService {
  private logoPath: string;

  constructor(
    private config: {
      senderEmail?: string;
      appPassword?: string;
      recipientEmail?: string;
    },
  ) {
    this.logoPath = join(process.cwd(), "assets", "logo.png");
  }

  updateConfig(config: any) {
    this.config = config;
  }

  async sendFailureNotification(
    runId: string,
    failures: any[],
    metrics?: any,
  ): Promise<void> {
    if (failures.length === 0) return;

    const sender = process.env.MAILER_EMAIL || this.config.senderEmail;
    const pass = process.env.MAILER_PASSWORD || this.config.appPassword;
    const recipient = this.config.recipientEmail;

    if (!sender || !pass || !recipient) return;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: sender, pass: pass },
    });

    const displayRunId =
      runId.startsWith("RUN") || runId.startsWith("SKIP") ? `#${runId}` : runId;
    const subject = `[intelliExtract] Extraction Failed-${displayRunId}`;

    const playwrightRows = failures
      .map(
        (f) => `
      <tr style="border-bottom:#e4e4e7 1px solid;">
        <td style="padding:12px 8px; font-size: 13px; color: #334155;">${f.filePath}</td>
        <td style="padding:12px 8px;color:#d93025;font-weight:bold; font-size: 13px;">Failed</td>
        <td style="padding:12px 8px; font-size: 13px; color: #64748b;">N/A</td>
      </tr>`,
      )
      .join("");

    const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="background-color:#f4f4f5;padding:40px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="700"
              style="background-color:#ffffff;border-radius:12px;overflow:hidden;
                    box-shadow:0 3px 10px rgba(0,0,0,0.08);">
              <tbody>
                <tr>
                  <td align="center" style="padding:30px 30px 0 30px;">
                    <img src="https://alpha.cdn.intellirevenue.com/general/intellirevenue-logo.png" alt="Logo" width="210">
                    <hr style="border:none;border-top:#e4e4e7 2px solid;width:100%;max-width:640px;margin:20px auto;">
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 30px;">
                    <div style="background:rgba(217, 48, 37, 0.05); border-left:4px solid #d93025;padding:20px;border-radius:8px;">
                      <h2 style="margin:0 0 15px 0;color:#333;font-size:20px;">Extraction Run Summary</h2>
                      <p><strong>Status:</strong> <span style="color:#d93025;font-weight:bold;">Failed</span></p>
                      <p><strong>Failed Files:</strong> ${metrics?.failed ?? failures.length}</p>
                      <p><strong>Run ID:</strong> ${displayRunId}</p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 30px 20px 30px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e4e4e7;">
                      <thead>
                        <tr style="background-color:#f4f4f5;text-align:left;">
                          <th style="padding:12px 8px; font-weight:700;">File Path</th>
                          <th style="padding:12px 8px; font-weight:700;">Status</th>
                          <th style="padding:12px 8px; font-weight:700;">Duration</th>
                        </tr>
                      </thead>
                      <tbody>${playwrightRows}</tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:20px;font-size:12px;color:#888;">
                    &copy; ${new Date().getFullYear()} IntelliRevenue. All rights reserved.
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

    try {
      await transporter.sendMail({
        from: `"IntelliExtract Runner" <${sender}>`,
        to: recipient,
        subject,
        html,
      });
    } catch (error) {
      console.error("Failed to send notification email:", error);
    }
  }
}
