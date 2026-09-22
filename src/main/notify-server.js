const http = require('http');

const ALLOWED = new Set(['codex', 'claude', 'gpt', 'ling', 'system']);

function startNotifyServer({ port = 43822, onNotify }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const match = url.pathname.match(/^\/notify\/([a-z0-9_-]+)$/i);
    if (!match) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const source = match[1].toLowerCase();
    if (!ALLOWED.has(source)) {
      res.writeHead(403);
      res.end('Source not allowed');
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      const payload = {
        source,
        title: String(body.title || '任务已完成'),
        project: body.project ? String(body.project) : '',
        taskId: body.task_id ? String(body.task_id) : '',
        message: body.message ? String(body.message) : '',
        at: Date.now(),
      };
      try {
        onNotify(payload);
      } catch (err) {
        console.error('[notify] handler failed', err);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  server.on('error', (err) => {
    console.error('[notify] server error', err.message);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[notify] listening on 127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startNotifyServer, ALLOWED };
