/** The streaming input of a Claude Code process: messages pushed at any time, read by the SDK. */
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buf: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(m: SDKUserMessage) {
    if (this.closed) return;
    this.buf.push(m);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      while (this.buf.length) yield this.buf.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}
