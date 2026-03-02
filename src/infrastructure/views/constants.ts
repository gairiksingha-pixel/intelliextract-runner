import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SCHEDULE_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata",
];

export function loadStaticAssets(root: string) {
  let logo = "";
  let smallLogo = "";
  let favIcon = "";

  try {
    const logoPath = join(root, "assets", "logo.png");
    if (existsSync(logoPath)) {
      const buffer = readFileSync(logoPath);
      logo = `data:image/png;base64,${buffer.toString("base64")}`;
    }
    const smallLogoPath = join(root, "assets", "logo-small.png");
    if (existsSync(smallLogoPath)) {
      const buffer = readFileSync(smallLogoPath);
      smallLogo = `data:image/png;base64,${buffer.toString("base64")}`;
    }
  } catch (_) {}

  try {
    const favPath = join(root, "assets", "favicon.ico");
    if (existsSync(favPath)) {
      const buffer = readFileSync(favPath);
      favIcon = `data:image/x-icon;base64,${buffer.toString("base64")}`;
    }
  } catch (_) {}

  return { logo, smallLogo, favIcon };
}
