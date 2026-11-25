const { parentPort, workerData } = require('worker_threads');
const paper = require('./paper-lib');
const { extractPdfHints } = require('./pdf-hints');

try {
  const { method, args } = workerData;
  const fn = method === 'pdfHints' ? extractPdfHints : paper[method];
  parentPort.postMessage({ value: fn(...args) });
} catch (error) {
  parentPort.postMessage({ error: error.message || String(error) });
}
