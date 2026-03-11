/** Lightweight progress tracker for long-running SDK sessions. */
export class SessionProgress {
  private readonly label: string;
  private readonly t0 = Date.now();
  private turns = 0;
  private toolCalls = 0;
  private lastLogAt = 0;

  constructor(label: string) {
    this.label = label;
    this.log("session started");
  }

  /** Call on each message from query(). Logs noteworthy events. */
  onMessage(msg: unknown): void {
    const m = msg as Record<string, unknown>;

    if (m.type === "assistant") {
      this.turns++;
      const content = (m as any).message?.content;
      if (Array.isArray(content)) {
        const toolUses = content.filter((b: any) => b.type === "tool_use");
        if (toolUses.length > 0) {
          const names = toolUses.map((t: any) => t.name as string).join(", ");
          this.toolCalls += toolUses.length;
          this.log(`turn ${this.turns} → tools: ${names}`);
          return;
        }
      }
      this.logThrottled(`turn ${this.turns} → generating text`);
    } else if (m.type === "result") {
      const cost = (m as any).total_cost_usd;
      const costStr = typeof cost === "number" ? ` ($${cost.toFixed(4)})` : "";
      this.log(`done — ${this.turns} turns, ${this.toolCalls} tool calls${costStr}`);
    }
  }

  private log(detail: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    console.error(`[${elapsed}s] ${this.label}: ${detail}`);
    this.lastLogAt = Date.now();
  }

  /** Log at most once every 10s to avoid spam during long text generation. */
  private logThrottled(detail: string): void {
    if (Date.now() - this.lastLogAt > 10_000) {
      this.log(detail);
    }
  }
}
