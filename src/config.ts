import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { config as loadEnv } from 'dotenv';
import type { Config } from './types.js';

loadEnv();

const CONFIG_PATH = process.env.CONFIG_PATH ?? resolve(process.cwd(), 'config', 'config.yaml');

function substituteEnv(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
    const key = value.slice(2, -1);
    return process.env[key] ?? value;
  }
  if (Array.isArray(value)) return value.map(substituteEnv);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteEnv(v);
    return out;
  }
  return value;
}

function validateConfig(c: Config, configPath: string): void {
  const missing: string[] = [];
  if (!c.api?.baseUrl || typeof c.api.baseUrl !== 'string') missing.push('api.baseUrl');
  if (typeof c.api?.timeoutMs !== 'number' || c.api.timeoutMs <= 0) missing.push('api.timeoutMs (positive number)');
  if (!Array.isArray(c.s3?.buckets)) missing.push('s3.buckets (array)');
  if (!c.s3?.stagingDir || typeof c.s3.stagingDir !== 'string') missing.push('s3.stagingDir');
  if (!c.s3?.region || typeof c.s3.region !== 'string') missing.push('s3.region');
  if (!c.run?.checkpointPath || typeof c.run.checkpointPath !== 'string') missing.push('run.checkpointPath');
  if (typeof c.run?.concurrency !== 'number' || c.run.concurrency < 1) missing.push('run.concurrency (>= 1)');
  if (!c.logging?.dir || typeof c.logging.dir !== 'string') missing.push('logging.dir');
  if (!c.report?.outputDir || typeof c.report.outputDir !== 'string') missing.push('report.outputDir');
  if (!Array.isArray(c.report?.formats) || c.report.formats.length === 0) missing.push('report.formats (non-empty array)');
  if (missing.length > 0) {
    throw new Error(`Invalid config at ${configPath}. Missing or invalid: ${missing.join(', ')}.`);
  }
}

export function loadConfig(configPath: string = CONFIG_PATH): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load config from ${configPath}. Copy config.example.yaml to config.yaml and set values. ${msg}`, { cause: e });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid YAML in ${configPath}. ${msg}`, { cause: e });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config at ${configPath} must be a YAML object.`);
  }
  const withEnv = substituteEnv(parsed) as Config;
  validateConfig(withEnv, configPath);
  // Apply env overrides for API
  if (process.env.ENTELLIEXTRACT_BASE_URL) withEnv.api.baseUrl = process.env.ENTELLIEXTRACT_BASE_URL;
  const envConfig = withEnv as unknown as Record<string, unknown>;
  if (process.env.ENTELLIEXTRACT_ACCESS_KEY !== undefined) envConfig.accessKey = process.env.ENTELLIEXTRACT_ACCESS_KEY;
  if (process.env.ENTELLIEXTRACT_SECRET_MESSAGE !== undefined) envConfig.secretMessage = process.env.ENTELLIEXTRACT_SECRET_MESSAGE;
  if (process.env.ENTELLIEXTRACT_SIGNATURE !== undefined) envConfig.signature = process.env.ENTELLIEXTRACT_SIGNATURE;
  return withEnv;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
