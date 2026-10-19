#!/usr/bin/env node
// Packages the extension into dist/niner-schedule-wizard-v<version>.zip for the Chrome Web Store
// and GitHub releases. Zero dependencies: writes the zip with node's zlib.
//   node tools/build.js           build (runs tests first)
//   node tools/build.js --no-test skip tests
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = ['manifest.json', 'background.js', 'src', 'icons'];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;

// ---- sanity checks
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };
if (!/^\d+(\.\d+){0,3}$/.test(version)) fail(`manifest version "${version}" is not a valid Chrome version`);
if (!manifest.description || manifest.description.length > 132) fail('manifest description must be 1-132 characters');
const referenced = [
  manifest.background && manifest.background.service_worker,
  ...Object.values(manifest.icons || {}),
  ...((manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])])),
  ...((manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])),
].filter(Boolean);
for (const f of referenced) if (!fs.existsSync(path.join(ROOT, f))) fail(`manifest references missing file: ${f}`);

// ---- tests
if (!process.argv.includes('--no-test')) {
  for (const t of fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'))) {
    try { execFileSync(process.execPath, [path.join(ROOT, 'tests', t)], { stdio: 'pipe' }); }
    catch (e) { process.stdout.write(String(e.stdout || '')); fail(`tests failed: ${t}`); }
    console.log('✓ ' + t);
  }
}
for (const f of referenced.filter((f) => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`syntax error in ${f}\n${e.stderr}`); }
}

// ---- collect files
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).sort().flatMap((n) => walk(path.posix.join(rel, n)));
  return /(^|\/)(\.|Thumbs\.db$)/.test(rel) ? [] : [rel];
}
const files = INCLUDE.flatMap(walk);

// ---- minimal zip writer (deflate, no zip64)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const parts = [];
const central = [];
let offset = 0;
const { time, date } = dosTime(new Date());
for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  parts.push(local, name, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += local.length + name.length + comp.length;
}
const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `niner-schedule-wizard-v${version}.zip`);
fs.writeFileSync(out, Buffer.concat([...parts, cenBuf, end]));
console.log(`✓ ${files.length} files → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
