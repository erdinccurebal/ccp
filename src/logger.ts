import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** Default max log file size: 10 MB */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/** Default max rotated backup files */
const DEFAULT_MAX_FILES = 5;

function parseSize(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/);
  if (!match) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }
  const num = parseFloat(match[1]);
  switch (match[2]) {
    case "kb": return num * 1024;
    case "mb": return num * 1024 * 1024;
    case "gb": return num * 1024 * 1024 * 1024;
    default:   return num;
  }
}

function parseLevel(value: string | undefined): number {
  const normalized = (value || "info").toLowerCase() as LogLevel;
  return LEVELS[normalized] ?? LEVELS.info;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: string, args: unknown[]): string {
  const parts = args.map((a) =>
    typeof a === "string" ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a),
  );
  return `${timestamp()} [${level.toUpperCase()}] ${parts.join(" ")}`;
}

class Logger {
  private level: number;
  private filePath: string | null;
  private maxSize: number;
  private maxFiles: number;
  private currentSize: number;

  constructor() {
    this.level = parseLevel(process.env.LOG_LEVEL);
    this.filePath = process.env.LOG_FILE || null;
    this.maxSize = parseSize(process.env.LOG_MAX_SIZE, DEFAULT_MAX_SIZE);
    this.maxFiles = Math.max(0, parseInt(process.env.LOG_MAX_FILES || "", 10) || DEFAULT_MAX_FILES);
    this.currentSize = 0;

    if (this.filePath) {
      try {
        mkdirSync(dirname(this.filePath), { recursive: true });
      } catch {
        // directory may already exist
      }

      // Read initial file size for rotation tracking
      try {
        this.currentSize = statSync(this.filePath).size;
      } catch {
        this.currentSize = 0;
      }
    }
  }

  /**
   * Rotates log files when current file exceeds maxSize.
   *
   * Rotation scheme:
   *   proxy.log      → proxy.log.1
   *   proxy.log.1    → proxy.log.2
   *   ...
   *   proxy.log.(n-1) → proxy.log.n
   *   proxy.log.n    → deleted
   *
   * After rotation a fresh proxy.log is created on next write.
   */
  private rotate(): void {
    if (!this.filePath) return;

    try {
      // Delete oldest backup if it exists
      const oldest = `${this.filePath}.${this.maxFiles}`;
      if (existsSync(oldest)) {
        unlinkSync(oldest);
      }

      // Shift existing backups: .4→.5, .3→.4, .2→.3, .1→.2
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i}`;
        const dest = `${this.filePath}.${i + 1}`;
        if (existsSync(src)) {
          renameSync(src, dest);
        }
      }

      // Current file → .1
      renameSync(this.filePath, `${this.filePath}.1`);
      this.currentSize = 0;
    } catch {
      // If rotation fails, keep writing to avoid data loss
    }
  }

  private writeToFile(formatted: string): void {
    if (!this.filePath) return;

    try {
      const line = formatted + "\n";
      const lineBytes = Buffer.byteLength(line, "utf-8");

      // Check if rotation is needed BEFORE writing
      if (this.currentSize + lineBytes > this.maxSize) {
        this.rotate();
      }

      appendFileSync(this.filePath, line);
      this.currentSize += lineBytes;
    } catch {
      // Silently ignore file write failures to avoid infinite loops
    }
  }

  private write(level: LogLevel, consoleFn: (...args: unknown[]) => void, args: unknown[]): void {
    if (LEVELS[level] > this.level) return;

    const formatted = formatMessage(level, args);

    // Always write to console
    consoleFn(formatted);

    // Also write to file if configured (with rotation)
    this.writeToFile(formatted);
  }

  error(...args: unknown[]): void {
    this.write("error", console.error, args);
  }

  warn(...args: unknown[]): void {
    this.write("warn", console.warn, args);
  }

  info(...args: unknown[]): void {
    this.write("info", console.log, args);
  }

  debug(...args: unknown[]): void {
    this.write("debug", console.log, args);
  }

  /** Returns the current log level name */
  getLevel(): LogLevel {
    const entry = Object.entries(LEVELS).find(([, v]) => v === this.level);
    return (entry?.[0] as LogLevel) || "info";
  }

  /** Returns the log file path, or null if not configured */
  getFilePath(): string | null {
    return this.filePath;
  }

  /** Returns the max file size in bytes */
  getMaxSize(): number {
    return this.maxSize;
  }

  /** Returns the max number of rotated backup files */
  getMaxFiles(): number {
    return this.maxFiles;
  }
}

export const logger = new Logger();
