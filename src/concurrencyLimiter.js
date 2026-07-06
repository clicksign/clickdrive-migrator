class ConcurrencyLimiter {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      const task = () => {
        this.active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.dequeue();
          });
      };

      if (this.active < this.limit) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  dequeue() {
    if (this.queue.length === 0 || this.active >= this.limit) return;
    const next = this.queue.shift();
    next();
  }
}

module.exports = { ConcurrencyLimiter };
