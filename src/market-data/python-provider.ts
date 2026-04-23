import {spawn} from "node:child_process";
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
    this.pythonCommand = options.pythonCommand ?? "python";
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

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Python adapter exited with code ${code}`));
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
