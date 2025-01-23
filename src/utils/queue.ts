/*
 * @Date: 2024-12-31 17:57:06
 * @Author: johnhom1024
 * @LastEditors: johnhom1024
 * @Description: 下载媒体队列，限制同时可以下载媒体的数量
 */

type MaybePromise<T> = T | Promise<T>;

type RunFunction = () => MaybePromise<any>;

export class QueueLimit {
  public waitQueue: RunFunction[] = [];
  public runningQueue: RunFunction[] = [];
  public limit: number;
  constructor(limit?: number) {
    this.limit = limit || 5;
  }

  public add(Fn: RunFunction) {
    this.waitQueue.push(Fn);
    this.run();
  }

  public async run() {
    if (this.runningQueue.length >= this.limit) {
      return;
    }

    const Fn = this.waitQueue.shift();
    if (Fn) {
      this.runningQueue.push(Fn);
      try {
        await Fn();
      } finally {
        this.runningQueue = this.runningQueue.filter((fn) => fn !== Fn);
        this.run();
      }
    }
  }
}
