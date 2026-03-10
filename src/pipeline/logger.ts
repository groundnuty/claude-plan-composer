import { createWriteStream, type WriteStream } from "node:fs";

/** NDJSON logger that handles backpressure for SDK message streams */
export class NdjsonLogger {
  private readonly stream: WriteStream;

  constructor(logPath: string) {
    this.stream = createWriteStream(logPath);
  }

  /** Write a message as an NDJSON line, awaiting drain if needed */
  async write(msg: unknown): Promise<void> {
    const ok = this.stream.write(JSON.stringify(msg) + "\n");
    if (!ok) {
      await new Promise<void>(resolve => this.stream.once("drain", resolve));
    }
  }

  /** Close the stream and wait for it to finish */
  async close(): Promise<void> {
    await new Promise<void>(resolve => this.stream.end(resolve));
  }
}
