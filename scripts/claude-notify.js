#!/usr/bin/env node
/** Claude Code → 灵动面板 通知转发示例 */
const http = require('http');

function notify(source, payload) {
  const data = JSON.stringify(payload);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: Number(process.env.LING_NOTIFY_PORT || 43822),
      path: `/notify/${source}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    },
    (res) => {
      res.resume();
      res.on('end', () => {
        console.log(`[ling-panel] notify ${source} status=${res.statusCode}`);
      });
    }
  );
  req.on('error', (err) => {
    console.error('[ling-panel] notify failed:', err.message);
  });
  req.write(data);
  req.end();
}

const title = process.argv[2] || 'Claude 任务已完成';
const project = process.argv[3] || '';
notify('claude', { title, project, task_id: String(Date.now()) });
