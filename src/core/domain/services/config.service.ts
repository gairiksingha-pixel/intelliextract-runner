import { Config } from "../entities/config.entity.js";

export interface IConfigService {
  getConfig(): Config;
  getS3Config(): Config["s3"];
  getApiConfig(): Config["api"];
  getRunConfig(): Config["run"];
  getLoggingConfig(): Config["logging"];
  getReportConfig(): Config["report"];
}
