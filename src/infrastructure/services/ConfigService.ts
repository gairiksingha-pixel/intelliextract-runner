import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { config as loadEnv } from "dotenv";
import { IConfigService } from "../../core/domain/services/IConfigService.js";
import { Config } from "../../core/domain/entities/Config.js";
import { FernetSecretService } from "./FernetSecretService.js";

export class ConfigService implements IConfigService {
  private config: Config;

  constructor(configPath?: string) {
    loadEnv();
    FernetSecretService.loadSecrets();
    const resolvedPath =
      configPath ||
      process.env.CONFIG_PATH ||
      resolve(process.cwd(), "config", "config.yaml");
    this.config = this.loadConfig(resolvedPath);
  }

  private loadConfig(path: string): Config {
    let raw = readFileSync(path, "utf-8");
    let parsed = yaml.load(raw) as any;

    // Simple env substitution for ${VAR}
    const substitute = (obj: any): any => {
      if (
        typeof obj === "string" &&
        obj.startsWith("${") &&
        obj.endsWith("}")
      ) {
        const key = obj.slice(2, -1);
        return process.env[key] || obj;
      }
      if (Array.isArray(obj)) return obj.map(substitute);
      if (obj !== null && typeof obj === "object") {
        const out: any = {};
        for (const [k, v] of Object.entries(obj)) out[k] = substitute(v);
        return out;
      }
      return obj;
    };

    const config = substitute(parsed) as Config;

    // Apply environment overrides (following legacy logic)
    if (process.env.INTELLIEXTRACT_BASE_URL)
      config.api.baseUrl = process.env.INTELLIEXTRACT_BASE_URL;

    // S3 Overrides from ENV
    const envBucket = process.env.S3_BUCKET?.trim();
    const envTP = process.env.S3_TENANT_PURCHASERS;
    if (envBucket && envTP) {
      try {
        const mapping = JSON.parse(envTP);
        const buckets: any[] = [];
        for (const [brand, purchasers] of Object.entries(mapping)) {
          if (!Array.isArray(purchasers)) continue;
          for (const purchaser of purchasers as string[]) {
            buckets.push({
              name: brand,
              bucket: envBucket,
              prefix: `${brand}/${purchaser}/`,
              tenant: brand,
              purchaser,
            });
          }
        }
        if (buckets.length > 0) config.s3.buckets = buckets;
      } catch (_) {}
    }

    return config;
  }

  getConfig(): Config {
    return this.config;
  }
  getS3Config(): Config["s3"] {
    return this.config.s3;
  }
  getApiConfig(): Config["api"] {
    return this.config.api;
  }
  getRunConfig(): Config["run"] {
    return this.config.run;
  }
  getLoggingConfig(): Config["logging"] {
    return this.config.logging;
  }
  getReportConfig(): Config["report"] {
    return this.config.report;
  }
}
