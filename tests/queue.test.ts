import { QueueLimit } from '@/utils/queue';
import { describe, beforeEach, test, it, vi, expect } from 'vitest';

describe('QueueLimit', () => {
  let queueLimit: QueueLimit;

  beforeEach(() => {
    queueLimit = new QueueLimit(2);
  });

  it('should limit the number of concurrent tasks', async () => {
    const task1 = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const task2 = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const task3 = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));

    queueLimit.add(task1);
    queueLimit.add(task2);
    queueLimit.add(task3);

    // Initially, only two tasks should be running
    expect(task1).toHaveBeenCalled();
    expect(task2).toHaveBeenCalled();
    expect(task3).not.toHaveBeenCalled();

    // Wait for the first two tasks to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // After the first two tasks complete, the third task should start
    expect(task3).toHaveBeenCalled();
  });

  test('should run when function is add', async () => {
    const fn = vi.fn(() => {
      return Promise.resolve();
    });
    // 监视run方法是否被调用
    const queueLimitRun = vi.spyOn(queueLimit, 'run');
    queueLimit.add(fn);
    expect(queueLimitRun).toHaveBeenCalled();
  })

  test('测试任务同时执行的上限', async () => {
    const fn = vi.fn(() => {
      return Promise.resolve();
    });

    queueLimit.add(fn);
    queueLimit.add(fn);
    queueLimit.add(fn);

    expect(queueLimit.runningQueue.length).toBe(2);
    expect(queueLimit.waitQueue.length).toBe(1);
  })

})
