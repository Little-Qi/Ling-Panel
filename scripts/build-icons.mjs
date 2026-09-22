/**
 * 从 SVG 主稿导出应用图标（透明底、多尺寸 PNG + Windows ICO）
 * 用法: NODE_PATH=<mimo node_modules> node scripts/build-icons.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');

const APP_SVG = path.join(assets, 'ling-icon.svg');
const TRAY_SVG = path.join(assets, 'ling-icon-tray.svg');

/** PNG bytes → Windows .ico（嵌入 PNG 帧，Win Vista+） */
function packIco(pngFrames /* [{size, buf}] */) {
  const count = pngFrames.length;
  const headerSize = 6;
  const entrySize = 16;
  const offset0 = headerSize + entrySize * count;
  let offset = offset0;
  const entries = [];
  for (const f of pngFrames) {
    const dim = f.size >= 256 ? 0 : f.size;
    const e = Buffer.alloc(entrySize);
    e.writeUInt8(dim, 0);
    e.writeUInt8(dim, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(f.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += f.buf.length;
  }
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  return Buffer.concat([header, ...entries, ...pngFrames.map((f) => f.buf)]);
}

async function svgToPngBuffer(svgPath, size) {
  return sharp(svgPath, { density: 300 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function svgToPng(svgPath, size, outPath) {
  const buf = await svgToPngBuffer(svgPath, size);
  fs.writeFileSync(outPath, buf);
  const meta = await sharp(outPath).metadata();
  console.log('png', path.basename(outPath), meta.width, meta.height, meta.channels);
  return buf;
}

async function main() {
  // 主图标（方砖 + 灵珠胶囊）
  await svgToPng(APP_SVG, 1024, path.join(assets, 'app-icon.png'));

  // 托盘 / 窗口小图标（纯胶囊，透明底）
  await svgToPng(TRAY_SVG, 256, path.join(assets, 'ling-panel.png'));

  // Windows ICO：16/24/32/48/64/128/256
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = [];
  for (const s of icoSizes) {
    const buf = await svgToPngBuffer(APP_SVG, s);
    frames.push({ size: s, buf });
  }
  const icoBuf = packIco(frames);
  fs.writeFileSync(path.join(assets, 'app-icon.ico'), icoBuf);
  console.log('ico', 'app-icon.ico', icoBuf.length, 'frames', frames.length);

  // 校验透明角
  const check = await sharp(path.join(assets, 'app-icon.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels, data } = check;
  const px = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  console.log('corner alpha', px(0, 0), px(1023, 0), 'center', px(512, 512));

  const tray = await sharp(path.join(assets, 'ling-panel.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tpx = (x, y) => {
    const i = (y * tray.width + x) * tray.channels;
    return [tray.data[i], tray.data[i + 1], tray.data[i + 2], tray.data[i + 3]];
  };
  console.log('tray corner', tpx(0, 0), 'tray center', tpx(128, 128));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
