// An Alerter that records what it was asked to send, applying the same once-per-key rule.
import type { Alerter } from '../../src/alert.js';

export class RecordingAlerter implements Alerter {
  pings = 0;
  messages: string[] = [];
  private keys = new Set<string>();

  async ping() {
    this.pings += 1;
  }
  async notify(message: string) {
    this.messages.push(message);
  }
  async notifyOnce(key: string, message: string) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.messages.push(message);
  }
}
