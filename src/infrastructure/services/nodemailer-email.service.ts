import nodemailer from "nodemailer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  IEmailService,
  EmailConfig,
  FailureDetail,
} from "../../core/domain/services/email.service.js";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";

export class NodemailerEmailService implements IEmailService {
  constructor(private recordRepo: IExtractionRecordRepository) {}

  async getEmailConfig(): Promise<EmailConfig> {
    return await this.recordRepo.getEmailConfig();
  }

  async saveEmailConfig(config: EmailConfig): Promise<void> {
    await this.recordRepo.saveEmailConfig(config);
  }

  async sendConsolidatedFailureEmail(
    runId: string,
    failures: FailureDetail[],
    metrics?: any,
  ): Promise<void> {
    if (failures.length === 0) return;

    const config = await this.getEmailConfig();
    const senderEmail = process.env.MAILER_EMAIL || config.senderEmail;
    const appPassword = process.env.MAILER_PASSWORD || config.appPassword;
    const recipientEmail = config.recipientEmail;

    if (!senderEmail || !appPassword || !recipientEmail) return;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: appPassword,
      },
    });

    const displayRunId =
      runId.startsWith("RUN") || runId.startsWith("SKIP") ? `#${runId}` : runId;
    const subject = `[intelliExtract] Extraction Failed-${displayRunId}`;

    const rows = failures
      .map(
        (f) => `
                <tr style="border-bottom:#e4e4e7 1px solid;">
                  <td style="padding:12px 8px; font-size: 13px; color: #334155;">${f.filePath}</td>
                  <td style="padding:12px 8px;color:#d93025;font-weight:bold; font-size: 13px;">Failed</td>
                  <td style="padding:12px 8px; font-size: 13px; color: #64748b;">N/A</td>
                </tr>`,
      )
      .join("");

    const currentYear = new Date().getFullYear();
    const overallStatusColor = "#d93025";

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
                    box-shadow:0 3px 10px rgba(0,0,0,0.08);font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
              <tbody>
                <!-- Header -->
                <tr>
                  <td align="center" style="padding:30px 30px 0 30px;">
                    <img 
                      src="https://alpha.cdn.intellirevenue.com/general/intellirevenue-logo.png"
                      alt="IntelliRevenue Logo" width="210"
                      style="display:block;margin-bottom:10px;">
                    <hr style="border:none;border-top:#e4e4e7 2px solid;width:100%;max-width:640px;margin:0 auto 10px auto;">
                  </td>
                </tr>

                <!-- Overall Summary Card -->
                <tr>
                  <td style="padding:20px 30px 20px 30px;">
                    <div style="background:linear-gradient(135deg, ${overallStatusColor}15 0%, ${overallStatusColor}05 100%);
                                border-left:4px solid ${overallStatusColor};padding:20px;border-radius:8px;margin-bottom:20px;">
                      <h2 style="margin:0 0 15px 0;color:#333;font-size:20px;">Extraction Run Summary</h2>
                      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
                        <tr>
                          <td style="padding:5px 0;"><strong>Status:</strong></td>
                          <td style="padding:5px 0;color:${overallStatusColor};font-weight:bold;font-size:16px;">Failed</td>
                        </tr>
                        <tr>
                          <td style="padding:5px 0;"><strong>Failed:</strong></td>
                          <td style="padding:5px 0;color:#d93025;font-weight:bold;">${metrics?.failed ?? failures.length}</td>
                        </tr>
                        <tr>
                          <td style="padding:5px 0;"><strong>Run ID:</strong></td>
                          <td style="padding:5px 0;">${displayRunId}</td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>

                <!-- Failure Details -->
                <tr>
                  <td style="padding:0 30px 20px 30px;">
                    <h3 style="margin:0 0 15px 0;color:#333;font-size:18px;">
                      Failed Extractions
                    </h3>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="width:100%;border-collapse:collapse;font-size:13px;
                             border-radius:5px;overflow:hidden;border:1px solid #e4e4e7;">
                      <thead>
                        <tr style="background-color:#f4f4f5;text-align:left;">
                          <th style="padding:12px 8px;color:#555; font-weight: 700;">File Path</th>
                          <th style="padding:12px 8px;color:#555; font-weight: 700;">Status</th>
                          <th style="padding:12px 8px;color:#555; font-weight: 700;">Duration</th>
                        </tr>
                      </thead>
                      <tbody>${rows}</tbody>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td align="center" style="padding:10px 30px 35px 30px;font-size:12px;color:#888;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                    <hr style="border:none;border-top:#e4e4e7 2px solid;width:100%;max-width:640px;margin:0 auto 18px auto;">
                    This is an automated message from the IntelliExtract Runner.<br>
                    © ${currentYear} IntelliRevenue. All rights reserved.
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
        from: `"IntelliExtract Runner" <${senderEmail}>`,
        to: recipientEmail,
        subject,
        html,
      });

      await this.recordRepo.saveEmailLog({
        timestamp: new Date().toISOString(),
        runId,
        recipient: recipientEmail,
        subject,
        status: "sent",
      });
    } catch (error: any) {
      console.error("Failed to send consolidated failure email:", error);
      await this.recordRepo.saveEmailLog({
        timestamp: new Date().toISOString(),
        runId,
        recipient: recipientEmail,
        subject,
        status: "failed",
        error: error.message || String(error),
      });
    }
  }

  async sendFailureEmail(
    params: FailureDetail & { runId: string },
  ): Promise<void> {
    const config = await this.getEmailConfig();
    const senderEmail = process.env.MAILER_EMAIL || config.senderEmail || "";
    const appPassword = process.env.MAILER_PASSWORD || config.appPassword || "";
    const recipientEmail = config.recipientEmail || "";

    if (!senderEmail || !appPassword || !recipientEmail) return;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: appPassword,
      },
    });

    const subject = `❌ Extraction Failed: ${params.brand} - ${params.purchaser || "N/A"}`;
    const LOGO_PATH = join(process.cwd(), "assets", "logo.png");

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap');
    body { font-family: 'Ubuntu', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f7f9; color: #2c2c2c; padding: 20px; line-height: 1.5; }
    .container { background-color: #ffffff; border: 1px solid #b0bfc9; border-radius: 12px; padding: 25px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #c62828; padding-bottom: 15px; margin-bottom: 20px; }
    .header h1 { color: #c62828; font-size: 1.25rem; margin: 0; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
    .item { margin-bottom: 15px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px; }
    .label { font-size: 0.7rem; color: #5a5a5a; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; display: block; }
    .value { font-size: 0.85rem; font-weight: 700; color: #216c6d; word-break: break-all; }
    .error-box { background-color: #ffebee; border: 1px solid #ffcdd2; border-radius: 8px; padding: 15px; margin-top: 20px; }
    .error-text { color: #c62828; font-weight: 700; font-size: 0.8rem; white-space: pre-wrap; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
    .footer { font-size: 0.65rem; color: #6b7c85; text-align: center; margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 15px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="cid:logo" alt="IntelliExtract" style="height: 28px; width: auto; margin-bottom: 12px; display: block;">
      <h1>Extraction failure detected</h1>
    </div>
    
    <div class="item">
      <span class="label">Brand / Tenant</span>
      <span class="value">${params.brand}</span>
    </div>
    
    <div class="item">
      <span class="label">Purchaser</span>
      <span class="value">${params.purchaser || "Not Provided"}</span>
    </div>

    <div class="item">
      <span class="label">Pattern Key</span>
      <span class="value">${params.patternKey || "Unknown"}</span>
    </div>

    <div class="item">
      <span class="label">Run ID</span>
      <span class="value">${params.runId}</span>
    </div>

    <div class="item">
      <span class="label">File Path</span>
      <span class="value">${params.filePath}</span>
    </div>

    <div class="error-box">
      <span class="label" style="color: #c62828;">Error Detail (Status: ${params.statusCode || "Infra"})</span>
      <div class="error-text">${params.errorMessage || "Unknown infrastructure or response failure"}</div>
    </div>

    <div class="footer">
      This is an automated notification from your IntelliExtract Runner.
      <br>&copy; ${new Date().getFullYear()} intellirevenue
    </div>
  </div>
</body>
</html>`;

    try {
      await transporter.sendMail({
        from: `"IntelliExtract Runner" <${senderEmail}>`,
        to: recipientEmail,
        subject,
        html,
        attachments: existsSync(LOGO_PATH)
          ? [{ filename: "logo.png", path: LOGO_PATH, cid: "logo" }]
          : [],
      });

      await this.recordRepo.saveEmailLog({
        timestamp: new Date().toISOString(),
        runId: params.runId,
        recipient: recipientEmail,
        subject,
        status: "sent",
      });
    } catch (error: any) {
      console.error("Failed to send failure email:", error);
      await this.recordRepo.saveEmailLog({
        timestamp: new Date().toISOString(),
        runId: params.runId,
        recipient: recipientEmail,
        subject,
        status: "failed",
        error: error.message || String(error),
      });
    }
  }
}
