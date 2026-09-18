// A promise mutex: run() calls wait their turn in call order, and a call that throws still releases.
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Held from a card's merge through its verification or rollback, so two cards never merge, verify
// or revert at the same time: a smoke test always sees the build of the merge it is checking, and a
// revert never lands on another card's unverified merge.
export const mergeLock = new Mutex();
