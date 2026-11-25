const path = require('path');
const { Worker } = require('worker_threads');

// 一个批次一个工作线程。串行执行可防止扫描和归档互相覆盖磁盘索引。
let tail = Promise.resolve();
let pending = 0;

function run(method, ...args) {
  pending += 1;
  const job = tail.then(() => new Promise((resolve, reject) => {
    const dir = __dirname.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    const worker = new Worker(path.join(dir, 'paper-worker.js'), { workerData: { method, args } });
    let reply;
    worker.once('message', (message) => { reply = message; });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0 || !reply) reject(new Error('论文任务提前退出（' + code + '）'));
      else if (reply.error) reject(new Error(reply.error));
      else resolve(reply.value);
    });
  }));
  tail = job.catch(() => {}).finally(() => { pending -= 1; });
  return job;
}

module.exports = { run, busy: () => pending > 0, drain: () => tail };
