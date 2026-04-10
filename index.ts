import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3006;

app.use(cors());
app.use(express.json());

const DOWNLOADS_DIR = path.join(__dirname, "..", "downloads");
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

interface Job {
  id: string;
  status: "pending" | "downloading" | "complete" | "error";
  progress: number;
  filename: string | null;
  filePath: string | null;
  error: string | null;
  title: string | null;
}

const jobs = new Map<string, Job>();

// Start a download
app.post("/api/download", (req: Request, res: Response) => {
  const { url, format } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid URL" });
    return;
  }

  // Basic YouTube URL validation
  if (
    !url.match(
      /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/
    )
  ) {
    res.status(400).json({ error: "Invalid YouTube URL" });
    return;
  }

  const outputFormat = format || "mp3";
  const jobId = uuidv4();
  const job: Job = {
    id: jobId,
    status: "pending",
    progress: 0,
    filename: null,
    filePath: null,
    error: null,
    title: null,
  };
  jobs.set(jobId, job);

  // Each job gets its own subdirectory so yt-dlp can use %(title)s freely
  const jobDir = path.join(DOWNLOADS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const outputTemplate = path.join(jobDir, "%(title)s.%(ext)s");

  const args: string[] = [
    url,
    "-x",
    "--audio-format",
    outputFormat,
    "-o",
    outputTemplate,
    "--newline",
    "--no-playlist",
  ];

  const proc = spawn("yt-dlp", args);
  job.status = "downloading";

  proc.stdout.on("data", (data: Buffer) => {
    const line = data.toString();

    // Parse progress: [download]  45.2% of 3.54MiB ...
    const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
    if (progressMatch) {
      job.progress = parseFloat(progressMatch[1]);
    }

    // Capture destination so we know the exact filename yt-dlp chose
    const destMatch = line.match(/\[(?:ExtractAudio|download)\] Destination: (.+)/);
    if (destMatch) {
      job.filePath = destMatch[1].trim();
      job.filename = path.basename(job.filePath);
      job.title = path.basename(job.filePath, path.extname(job.filePath));
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      console.error(`yt-dlp stderr: ${msg}`);
    }
  });

  proc.on("close", (code) => {
    if (code === 0) {
      job.progress = 100;
      job.status = "complete";

      // Fallback: scan the job directory if we didn't catch the destination line
      if (!job.filePath) {
        const files = fs.readdirSync(jobDir);
        if (files.length > 0) {
          job.filename = files[0];
          job.filePath = path.join(jobDir, files[0]);
          job.title = path.basename(files[0], path.extname(files[0]));
        }
      }
    } else {
      job.status = "error";
      job.error = `yt-dlp exited with code ${code}`;
      // Clean up empty job directory on failure
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  res.json({ jobId });
});

// SSE progress endpoint
app.get("/api/progress/:id", (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const interval = setInterval(() => {
    const current = jobs.get(req.params.id);
    if (!current) {
      clearInterval(interval);
      res.end();
      return;
    }

    const payload = {
      status: current.status,
      progress: current.progress,
      title: current.title,
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

    if (current.status === "complete" || current.status === "error") {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// Download the converted file
app.get("/api/file/:id", (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "complete" || !job.filePath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  if (!fs.existsSync(job.filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  res.download(job.filePath, job.filename || "download", () => {
    // Clean up the job directory after the file has been sent
    const jobDir = path.join(DOWNLOADS_DIR, job.id);
    fs.rmSync(jobDir, { recursive: true, force: true });
  });
});

// Serve React frontend in production
const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
