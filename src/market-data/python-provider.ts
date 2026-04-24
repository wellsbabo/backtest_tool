import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {DateString} from "../domain/types.js";
import {z} from "zod";
import type {MarketDataProvider, MarketDataRequest, MarketDataResponse} from "./types.js";

const barSchema = z.object({
  symbol: z.string(),
  date: z.string(),
  close: z.number(),
  currency: z.string().optional().nullable(),
  market: z.string().optional().nullable(),
  source: z.string(),
});

const responseSchema = z.object({
  symbol: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  count: z.number(),
  bars: z.array(barSchema),
});

export type PythonMarketDataProviderOptions = {
  pythonCommand?: string;
  scriptPath?: string;
};

export class PythonMarketDataProvider implements MarketDataProvider {
  private readonly pythonCommand: string;
  private readonly scriptPath: string;

  constructor(options: PythonMarketDataProviderOptions = {}) {
    this.pythonCommand = options.pythonCommand ?? resolveDefaultPythonCommand();
    this.scriptPath = options.scriptPath ?? "scripts/fetch_market_data.py";
  }

  async getDailyCloses(request: MarketDataRequest): Promise<MarketDataResponse> {
    const args = [
      this.scriptPath,
      "--symbol",
      request.symbol,
      "--start",
      request.startDate,
      "--end",
      request.endDate,
    ];

    return new Promise<MarketDataResponse>((resolve, reject) => {
      const child = spawn(this.pythonCommand, args, {stdio: ["ignore", "pipe", "pipe"]});

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(buildPythonLaunchError(this.pythonCommand, error));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(buildPythonRuntimeError(code, stderr));
          return;
        }

        try {
          const parsed = responseSchema.parse(JSON.parse(stdout));
          resolve({
            ...parsed,
            startDate: parsed.startDate as DateString,
            endDate: parsed.endDate as DateString,
            bars: parsed.bars.map((bar) => ({
              ...bar,
              date: bar.date as DateString,
              currency: bar.currency ?? undefined,
              market: bar.market ?? undefined,
            })),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

function resolveDefaultPythonCommand(): string {
  const configuredPython = process.env.BACKTEST_PYTHON?.trim();
  if (configuredPython) {
    return configuredPython;
  }

  const venvCandidates = process.platform === "win32" ? getWindowsVenvCandidates() : getPosixVenvCandidates();
  const existingVenvPython = venvCandidates.find((candidate) => fs.existsSync(candidate));
  if (existingVenvPython) {
    return existingVenvPython;
  }

  return process.platform === "win32" ? "python" : "python3";
}

function getWindowsVenvCandidates(): string[] {
  return [
    path.join("venv", "Scripts", "python.exe"),
    path.join(".venv", "Scripts", "python.exe"),
  ];
}

function getPosixVenvCandidates(): string[] {
  return [
    path.join("venv", "bin", "python"),
    path.join(".venv", "bin", "python"),
  ];
}

function buildPythonLaunchError(pythonCommand: string, error: Error): Error {
  const message = error.message || String(error);
  return new Error(
    [
      `Python runtime could not be started with "${pythonCommand}".`,
      "Create a virtual environment and install the Python dependencies, or set BACKTEST_PYTHON to a working interpreter.",
      `Original error: ${message}`,
    ].join(" "),
  );
}

function buildPythonRuntimeError(code: number | null, stderr: string): Error {
  const trimmed = stderr.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes("modulenotfounderror") || lower.includes("finance-datareader is required")) {
    return new Error(
      [
        "Python dependencies are missing.",
        "Install them with `pip install finance-datareader pandas` in the Python environment used by the app.",
        trimmed || `Python adapter exited with code ${code}`,
      ].join(" "),
    );
  }

  return new Error(trimmed || `Python adapter exited with code ${code}`);
}
