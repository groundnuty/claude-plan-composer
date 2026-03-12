import { createWriteStream, type WriteStream } from "node:fs";

/** NDJSON logger that handles backpressure for SDK message streams */
export class NdjsonLogger {
  private readonly stream: WriteStream;
  private _bytesWritten = 0;

  constructor(logPath: string) {
    this.stream = createWriteStream(logPath);
  }

  /** Write a message as an NDJSON line, awaiting drain if needed */
  async write(msg: unknown): Promise<void> {
    const line = JSON.stringify(msg) + "\n";
    this._bytesWritten += Buffer.byteLength(line, "utf8");
    const ok = this.stream.write(line);
    if (!ok) {
      await new Promise<void>((resolve) => this.stream.once("drain", resolve));
    }
  }

  /** Number of bytes written to the log file so far */
  get bytesWritten(): number {
    return this._bytesWritten;
  }

  /** Close the stream and wait for it to finish */
  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
