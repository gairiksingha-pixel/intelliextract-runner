import { ServerResponse } from "node:http";
import { resolve, basename } from "node:path";
import { existsSync, statSync, createReadStream } from "node:fs";
import { URL } from "node:url";
// @ts-ignore
import archiver from "archiver";
import { ICheckpointRepository } from "../../core/domain/repositories/checkpoint.repository.js";
import { z } from "zod";

const ExportZipSchema = z.object({
  files: z.array(z.string()).min(1),
  zipName: z.string().optional(),
});

const ExportByRunsSchema = z.object({
  runIds: z.array(z.string()).min(1),
});

export class ExportController {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private rootDir: string,
    private extractionsDir: string,
    private stagingDir: string,
    private reportsDir: string,
  ) {}

  async downloadFile(url: string, res: ServerResponse, method?: string) {
    try {
      const q = new URL(url, "http://localhost").searchParams;
      const fileId = q.get("file");
      if (!fileId) throw new Error("File path is required");

      const fullPath = resolve(this.rootDir, fileId);
      const allowedResolve = [
        this.extractionsDir,
        this.stagingDir,
        this.reportsDir,
      ].map((d) => resolve(d));

      const normalize = (p: string) =>
        resolve(p).toLowerCase().replace(/\\/g, "/");
      const normalizedFullPath = normalize(fullPath);
      const isAllowed = allowedResolve.some((dir) =>
        normalizedFullPath.startsWith(normalize(dir)),
      );

      if (!isAllowed) {
        res.writeHead(403);
        res.end("Access denied");
        return;
      }

      if (!existsSync(fullPath)) {
        res.writeHead(404);
        res.end("File not found");
        return;
      }

      const fileStat = statSync(fullPath);
      const filename = basename(fullPath);

      const headers: Record<string, string | number> = {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileStat.size,
      };

      if (method === "HEAD") {
        res.writeHead(200, headers);
        res.end();
        return;
      }

      res.writeHead(200, headers);
      createReadStream(fullPath).pipe(res);
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500);
        res.end(e.message || "Unknown error");
      }
    }
  }

  async exportZip(body: unknown, res: ServerResponse) {
    try {
      const parse = ExportZipSchema.safeParse(body);
      if (!parse.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parse.error.issues[0]?.message }));
        return;
      }

      const { files, zipName } = parse.data;
      const finalZipName = (zipName || "export") + ".zip";

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${finalZipName.replace(/"/g, '\\"')}"`,
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      archive.pipe(res);

      const allowedResolve = [
        this.reportsDir,
        this.extractionsDir,
        this.stagingDir,
      ].map((d) => resolve(d));

      const normalize = (p: string) =>
        resolve(p).toLowerCase().replace(/\\/g, "/");
      const allowedNormalized = allowedResolve.map((d: string) => normalize(d));

      for (const f of files) {
        const absPath = resolve(this.rootDir, f);
        const normalizedAbsPath = normalize(absPath);
        const isAllowed = allowedNormalized.some((dir: string) =>
          normalizedAbsPath.startsWith(dir),
        );
        if (isAllowed && existsSync(absPath) && statSync(absPath).isFile()) {
          archive.file(absPath, { name: basename(absPath) });
        }
      }
      archive.finalize();
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: String(e.message || "Unknown error") }),
        );
      }
    }
  }

  async exportResultsByRuns(body: unknown, res: ServerResponse) {
    try {
      const parse = ExportByRunsSchema.safeParse(body);
      if (!parse.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parse.error.issues[0]?.message }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="run_results_${Date.now()}.zip"`,
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      archive.pipe(res);

      for (const runId of parse.data.runIds) {
        const records = await this.checkpointRepo.getRecordsForRun(runId);
        for (const r of records) {
          if (!r.fullResponse) continue;

          const safe = (r.relativePath || "")
            .replaceAll("/", "_")
            .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
          const base = r.brand + "_" + (safe || "file");
          const jsonName = base.endsWith(".json") ? base : base + ".json";

          archive.append(JSON.stringify(r.fullResponse, null, 2), {
            name: (r.status === "done" ? "succeeded/" : "failed/") + jsonName,
          });
        }
      }

      archive.finalize();
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: String(e.message || "Unknown error") }),
        );
      }
    }
  }

  async exportAllExtractions(res: ServerResponse) {
    try {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="extractions.zip"',
      });
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      const records = await this.checkpointRepo.getAllCheckpoints();
      for (const r of records) {
        if (!r.fullResponse) continue;

        const safe = (r.relativePath || "")
          .replaceAll("/", "_")
          .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
        const base = r.brand + "_" + (safe || "file");
        const jsonName = base.endsWith(".json") ? base : base + ".json";

        archive.append(JSON.stringify(r.fullResponse, null, 2), {
          name: (r.status === "done" ? "succeeded/" : "failed/") + jsonName,
        });
      }

      archive.finalize();
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: String(e.message || "Unknown error") }),
        );
      }
    }
  }
}
