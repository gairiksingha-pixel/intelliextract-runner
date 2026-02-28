import { ConfigService } from "../services/ConfigService.js";
import { resolve } from "node:path";

/**
 * Utility function to load application configuration.
 * Decouples the configuration loading from specific service instances.
 */
export function loadConfig(path?: string) {
  const service = new ConfigService(path);
  return service.getConfig();
}

/**
 * Resolves the configuration file path based on environment variables or default locations.
 */
export function getConfigPath() {
  return (
    process.env.CONFIG_PATH || resolve(process.cwd(), "config", "config.yaml")
  );
}
