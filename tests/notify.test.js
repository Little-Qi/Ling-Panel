const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startNotifyServer, ALLOWED } = require('../src/main/notify-server');

function post(port, source, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/notify/${source}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('notify server accepts allowed source', async () => {
  const received = [];
  const server = startNotifyServer({
    port: 43999,
    onNotify: (p) => received.push(p),
  });
  await new Promise((r) => setTimeout(r, 80));
  const res = await post(43999, 'codex', { title: '完成', project: 'demo' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].source, 'codex');
  assert.strictEqual(received[0].title, '完成');
  server.close();
});

test('notify server rejects unknown source', async () => {
  const server = startNotifyServer({ port: 43998, onNotify: () => {} });
  await new Promise((r) => setTimeout(r, 80));
  const res = await post(43998, 'evil', { title: 'x' });
  assert.strictEqual(res.status, 403);
  server.close();
});

test('allowed list includes claude gpt', () => {
  assert.ok(ALLOWED.has('claude'));
  assert.ok(ALLOWED.has('gpt'));
});
