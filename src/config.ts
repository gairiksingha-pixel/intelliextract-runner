import { ConfigService } from "./infrastructure/services/ConfigService.js";
import { resolve } from "node:path";

export function loadConfig(path?: string) {
  const service = new ConfigService(path);
  return service.getConfig();
}

export function getConfigPath() {
  return (
    process.env.CONFIG_PATH || resolve(process.cwd(), "config", "config.yaml")
  );
}
