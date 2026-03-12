import { Command } from "commander";
import { runMonitor } from "../monitor/monitor.js";

const coerceInt = (v: string): number => parseInt(v, 10);

export const monitorCommand = new Command("monitor")
  .description("Monitor running cpc pipelines or review completed runs")
  .argument("[dir]", "Run directory for post-hoc monitoring")
  .option("--once", "Single snapshot, no refresh loop")
  .option("--interval <seconds>", "Poll interval in seconds (default: 3)", coerceInt)
  .option("--json", "Output raw JSON (for scripting)")
  .action(async (dir: string | undefined, opts) => {
    try {
      await runMonitor({
        dir,
        interval: opts.interval,
        once: opts.once,
        json: opts.json,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });
