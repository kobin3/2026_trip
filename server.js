#!/usr/bin/env node
'use strict';

/**
 * Local static web server for the travel folder.
 *
 * - Serves real files (HTML, images, video, Godot wasm/pck, ...)
 * - Directories without index.html get a generated HTML file listing
 * - /games/ gets an auto-generated gallery of every game folder
 * - Supports HTTP range requests (needed for <video> seeking)
 * - No dependencies, Node.js >= 18
 *
 * Usage:
 *   node server.js [--port 3000] [--host 0.0.0.0] [--root .] [--open]
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

// ---------------------------------------------------------------- CLI options

function parseArgs(argv) {
  const opts = { port: 3000, host: '0.0.0.0', root: __dirname, open: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--port' || arg === '-p') opts.port = Number(next());
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7));
    else if (arg === '--host' || arg === '-H') opts.host = next();
    else if (arg.startsWith('--host=')) opts.host = arg.slice(7);
    else if (arg === '--root' || arg === '-r') opts.root = path.resolve(next());
    else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice(7));
    else if (arg === '--open') opts.open = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node server.js [options]',
          '',
          '  -p, --port <n>   Port to listen on (default 3000)',
          '  -H, --host <ip>  Bind address (default 0.0.0.0, use 127.0.0.1 for local only)',
          '  -r, --root <dir> Folder to serve (default: script folder)',
          '      --open       Open the site in the default browser',
          '  -h, --help       Show this help',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
  console.error('Invalid port: ' + opts.port);
  process.exit(1);
}

const ROOT = path.resolve(opts.root);
const GAMES_DIR = path.join(ROOT, 'games');

// ---------------------------------------------------------------- MIME types

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------- helpers

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);

const decodeEntities = (value) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

const TH_DATE = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatDate = (date) => (date ? TH_DATE.format(date) : '');

const encodePath = (segments) => segments.map((s) => encodeURIComponent(s)).join('/');

function pageShell({ title, body, head = '', wide = false }) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📁</text></svg>">
<style>
  :root{--teal:#0f766e;--teal-dark:#115e59;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--bg:#f4f7f7}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--bg);font-family:"Noto Sans Thai","Segoe UI",system-ui,sans-serif;color:var(--ink)}
  a{color:var(--teal)}
  .topbar{background:linear-gradient(135deg,#0f766e,#0891b2);color:#fff;padding:22px 20px 26px}
  .topbar .inner{max-width:${wide ? '1120px' : '960px'};margin:0 auto}
  .nav{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;opacity:.92;margin-bottom:14px}
  .nav a{color:#fff;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.35);padding-bottom:1px}
  .nav a:hover{border-bottom-color:#fff}
  h1{margin:0;font-size:clamp(22px,3.6vw,30px);line-height:1.3;word-break:break-word}
  .sub{margin:7px 0 0;font-size:13.5px;opacity:.92;line-height:1.6}
  .crumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13.5px;margin-top:12px}
  .crumbs a{color:#fff;text-decoration:none;opacity:.9}
  .crumbs a:hover{text-decoration:underline}
  .crumbs span.sep{opacity:.55}
  .crumbs span.here{font-weight:700}
  main{max-width:${wide ? '1120px' : '960px'};margin:0 auto;padding:24px 20px 56px}
  .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
  .toolbar input{flex:1 1 240px;min-width:180px;padding:10px 14px;border:1px solid var(--line);border-radius:999px;font:inherit;font-size:14px;background:#fff;color:var(--ink);outline:none}
  .toolbar input:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(15,118,110,.12)}
  .count{font-size:13px;color:var(--muted);white-space:nowrap}
  .panel{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(15,60,60,.07);overflow:hidden}
  .empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:14px}
  .footer{margin-top:18px;font-size:12.5px;color:var(--muted);text-align:center;line-height:1.8}
  .footer code{background:#e8efee;padding:1px 6px;border-radius:6px;font-size:12px;color:#0f5f59}
  table{width:100%;border-collapse:collapse;font-size:14px}
  thead th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:12px 18px;border-bottom:1px solid var(--line);background:#fafcfc}
  thead th.size,thead th.date{text-align:right}
  tbody td{padding:11px 18px;border-bottom:1px solid #f0f3f3;vertical-align:middle}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:hover{background:#f3faf8}
  td.name{width:100%}
  td.name a,td.name span.nolink{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);min-width:0}
  td.name a:hover{color:var(--teal)}
  td.name .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  td.name .ico{width:20px;text-align:center;flex:none}
  td.size,td.date{text-align:right;color:var(--muted);font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .open{display:inline-block;font-size:11.5px;font-weight:700;color:var(--teal);border:1px solid rgba(15,118,110,.35);border-radius:999px;padding:1px 8px;margin-left:8px;vertical-align:1px}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .card{background:#fff;color:var(--ink);border-radius:18px;padding:20px;text-decoration:none;display:flex;flex-direction:column;box-shadow:0 8px 26px rgba(15,60,60,.09);transition:transform .18s,box-shadow .18s;min-width:0}
  .card:hover{transform:translateY(-3px);box-shadow:0 16px 36px rgba(15,60,60,.16)}
  .card .icon{width:64px;height:64px;border-radius:16px;object-fit:cover;margin-bottom:12px;background:#e6f4f1;display:flex;align-items:center;justify-content:center;font-size:32px;line-height:1;flex:none}
  .card h2{margin:0 0 6px;font-size:17px;line-height:1.35;word-break:break-word}
  .card .folder{margin:0 0 12px;font-size:12px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
  .card .go{font-weight:700;color:var(--teal);font-size:14px;margin-top:auto}
  .badge{display:inline-block;background:#e6f4f1;color:var(--teal-dark);font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;margin-bottom:9px;width:fit-content}
  @media(max-width:900px){.cards{grid-template-columns:1fr 1fr}}
  @media(max-width:640px){.cards{grid-template-columns:1fr}td.date,thead th.date{display:none}tbody td,tbody th{padding-left:14px;padding-right:14px}}
</style>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function navHtml() {
  return `<div class="nav"><a href="/">🏠 หน้าแรก</a><a href="/games/">🎮 รวมเกม</a></div>`;
}

// ---------------------------------------------------------------- HTML pages

async function renderGamesGallery() {
  let entries = [];
  try {
    entries = await fsp.readdir(GAMES_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));

  const games = [];
  await Promise.all(
    folders.map(async (folder) => {
      const dir = path.join(GAMES_DIR, folder);
      const indexFile = path.join(dir, 'index.html');
      try {
        const stat = await fsp.stat(indexFile);
        if (!stat.isFile()) return;
        const html = await fsp.readFile(indexFile, 'utf8');
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? decodeEntities(titleMatch[1].trim()) || folder : folder;

        let icon = null;
        for (const candidate of ['index.icon.png', 'index.png', 'icon.png', 'apple-touch-icon.png']) {
          try {
            const iconStat = await fsp.stat(path.join(dir, candidate));
            if (iconStat.isFile()) {
              icon = `${encodeURIComponent(folder)}/${candidate}`;
              break;
            }
          } catch {
            /* keep looking */
          }
        }

        games.push({ folder, title, icon, mtime: stat.mtime });
      } catch {
        /* not a game folder */
      }
    })
  );
  games.sort((a, b) => a.folder.localeCompare(b.folder, 'en', { numeric: true, sensitivity: 'base' }));

  const cards = games
    .map((game, index) => {
      const initials = game.title.match(/[A-Za-z0-9ก-๙]/)?.[0] || '🎮';
      const icon = game.icon
        ? `<img class="icon" src="${game.icon}" alt="" loading="lazy" data-fallback="${escapeHtml(initials)}">`
        : `<div class="icon">🎮</div>`;
      return `<a class="card" href="${encodeURIComponent(game.folder)}/" data-search="${escapeHtml(
        `${game.title} ${game.folder}`.toLowerCase()
      )}" style="animation-delay:${Math.min(index * 20, 300)}ms">
        ${icon}
        <div class="badge">Godot Web</div>
        <h2>${escapeHtml(game.title)}</h2>
        <p class="folder">${escapeHtml(game.folder)}</p>
        <span class="go">เล่นเลย →</span>
      </a>`;
    })
    .join('\n');

  const body = `
<header class="topbar">
  <div class="inner">
    ${navHtml()}
    <h1>🎮 รวมเกมทั้งหมด</h1>
    <p class="sub">สแกนอัตโนมัติจากโฟลเดอร์ <code>games/</code> — พบ ${games.length} เกม · กดการ์ดเพื่อเล่นได้เลย</p>
  </div>
</header>
<main>
  <div class="toolbar">
    <input type="search" id="filter" placeholder="ค้นหาเกม…" autocomplete="off" aria-label="ค้นหาเกม">
    <span class="count" id="count">${games.length} เกม</span>
  </div>
  <div class="cards" id="cards">
    ${cards || '<div class="empty">ไม่พบเกมในโฟลเดอร์ games/</div>'}
  </div>
  <p class="footer">หน้านี้สร้างสดจากรายชื่อโฟลเดอร์ทุกครั้งที่โหลด · เกมใหม่ที่วางใน <code>games/</code> จะขึ้นที่นี่อัตโนมัติ</p>
</main>
<script>
  const input = document.getElementById('filter');
  const cards = [...document.querySelectorAll('#cards .card')];
  const count = document.getElementById('count');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const card of cards) {
      const hit = !q || card.dataset.search.includes(q);
      card.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    count.textContent = q ? shown + ' / ' + cards.length + ' เกม' : cards.length + ' เกม';
  });
  for (const img of document.querySelectorAll('img.icon[data-fallback]')) {
    img.addEventListener('error', () => {
      const div = document.createElement('div');
      div.className = 'icon';
      div.textContent = img.dataset.fallback;
      img.replaceWith(div);
    });
  }
</script>`;

  return pageShell({ title: `รวมเกม (${games.length}) · Travel`, body, wide: true });
}

async function renderDirectoryListing(dirUrl, dirAbs) {
  const entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  const items = entries.filter((entry) => !entry.name.startsWith('.'));

  const visible = (
    await Promise.all(
      items.map(async (entry) => {
        const abs = path.join(dirAbs, entry.name);
        let stat;
        try {
          stat = await fsp.stat(abs);
        } catch {
          return null;
        }
        const isDir = stat.isDirectory();
        const ext = isDir ? '' : path.extname(entry.name).toLowerCase();

        let icon = '📄';
        if (isDir) icon = '📁';
        else if (['.html', '.htm'].includes(ext)) icon = '🌐';
        else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'].includes(ext)) icon = '🖼️';
        else if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) icon = '🎬';
        else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) icon = '🎵';
        else if (ext === '.pdf') icon = '📕';
        else if (['.md', '.txt'].includes(ext)) icon = '📝';
        else if (['.js', '.mjs', '.json', '.css', '.wasm', '.pck'].includes(ext)) icon = '⚙️';

        return {
          name: entry.name,
          isDir,
          size: stat.size,
          mtime: stat.mtime,
          ext,
          icon,
          href: encodeURIComponent(entry.name) + (isDir ? '/' : ''),
        };
      })
    )
  ).filter(Boolean);

  visible.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'th', { numeric: true, sensitivity: 'base' });
  });

  const rows = visible.map((item) => {
    const openBadge = ['.html', '.htm'].includes(item.ext) && !item.isDir ? '<span class="open">เปิด</span>' : '';
    return `<tr data-search="${escapeHtml(item.name.toLowerCase())}">
        <td class="name"><a href="${item.href}"><span class="ico">${item.icon}</span><span class="txt">${escapeHtml(
      item.name
    )}</span>${openBadge}</a></td>
        <td class="size">${item.isDir ? '—' : formatSize(item.size)}</td>
        <td class="date">${formatDate(item.mtime)}</td>
      </tr>`;
  });

  const segments = dirUrl.split('/').filter(Boolean);
  const crumbs = [`<a href="/">🏠 หน้าแรก</a>`];
  let href = '';
  segments.forEach((segment, index) => {
    href += '/' + segment;
    const label = decodeURIComponent(segment);
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(
      index === segments.length - 1
        ? `<span class="here">${escapeHtml(label)}</span>`
        : `<a href="${href}/">${escapeHtml(label)}</a>`
    );
  });

  const parentLink = segments.length ? `<a href="/${encodePath(segments.slice(0, -1))}/">⬆️ ขึ้นหนึ่งระดับ</a>` : '';

  const body = `
<header class="topbar">
  <div class="inner">
    ${navHtml()}
    <h1>📂 ${escapeHtml(segments.length ? decodeURIComponent(segments.at(-1)) : 'โฟลเดอร์หลัก')}</h1>
    <p class="sub">รายการไฟล์และโฟลเดอร์ใน <code>${escapeHtml('/' + segments.join('/'))}</code></p>
    <div class="crumbs">${crumbs.join(' ')}</div>
  </div>
</header>
<main>
  <div class="toolbar">
    <input type="search" id="filter" placeholder="ค้นหาไฟล์…" autocomplete="off" aria-label="ค้นหาไฟล์">
    <span class="count" id="count">${visible.length} รายการ</span>
    ${parentLink ? `<span class="count">${parentLink}</span>` : ''}
  </div>
  <div class="panel">
    ${
      rows.length
        ? `<table>
      <thead><tr><th>ชื่อ</th><th class="size">ขนาด</th><th class="date">แก้ไขล่าสุด</th></tr></thead>
      <tbody id="rows">${rows.join('\n')}</tbody>
    </table>`
        : '<div class="empty">โฟลเดอร์นี้ว่างเปล่า</div>'
    }
  </div>
  <p class="footer">เสิร์ฟโดย <code>server.js</code> · โฟลเดอร์ที่มี <code>index.html</code> จะเปิดหน้านั้นอัตโนมัติ</p>
</main>
<script>
  const input = document.getElementById('filter');
  const rows = [...document.querySelectorAll('#rows tr')];
  const count = document.getElementById('count');
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = !q || row.dataset.search.includes(q);
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    count.textContent = q ? shown + ' / ' + rows.length + ' รายการ' : rows.length + ' รายการ';
  });
</script>`;

  return pageShell({
    title: `${segments.length ? decodeURIComponent(segments.at(-1)) : 'ไฟล์'} · Travel`,
    body,
  });
}

function renderError(status, message) {
  const titles = {
    400: 'คำขอไม่ถูกต้อง',
    403: 'ไม่มีสิทธิ์เข้าถึง',
    404: 'ไม่พบหน้านี้',
    500: 'เซิร์ฟเวอร์ผิดพลาด',
  };
  const body = `
<header class="topbar">
  <div class="inner">
    ${navHtml()}
    <h1>${status} · ${titles[status] || 'ผิดพลาด'}</h1>
    <p class="sub">${escapeHtml(message || '')}</p>
  </div>
</header>
<main>
  <div class="panel"><div class="empty" style="padding:48px 24px">
    <p style="font-size:38px;margin:0 0 12px">🗺️</p>
    <p>ลองกลับไปหน้าแรก หรือเลือกโฟลเดอร์จากรายการด้านล่าง</p>
    <p style="margin-top:18px"><a href="/" style="font-weight:700">🏠 กลับหน้าแรก</a> · <a href="/games/" style="font-weight:700">🎮 รวมเกม</a></p>
  </div></div>
</main>`;
  return pageShell({ title: `${status} · Travel`, body });
}

// ---------------------------------------------------------------- responses

function baseHeaders(res, relPath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  const firstSegment = relPath.split(path.sep)[0];
  if (firstSegment === 'games') {
    // Cross-origin isolation so Godot builds that use threads / SharedArrayBuffer work.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
}

function sendHtml(req, res, status, html, relPath = '') {
  const buf = Buffer.from(html, 'utf8');
  baseHeaders(res, relPath);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function sendError(req, res, status, message, relPath = '') {
  sendHtml(req, res, status, renderError(status, message), relPath);
}

async function serveFile(req, res, absPath, relPath, stat) {
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  baseHeaders(res, relPath);
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', 'no-cache');

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  const ifModifiedSince = Date.parse(req.headers['if-modified-since'] || '');
  if (!req.headers['if-none-match'] && ifModifiedSince && Math.floor(stat.mtimeMs / 1000) * 1000 <= ifModifiedSince) {
    res.writeHead(304);
    res.end();
    return;
  }

  let start = 0;
  let end = stat.size - 1;
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      const [, rawStart, rawEnd] = match;
      if (rawStart === '' && rawEnd === '') {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        res.writeHead(416);
        res.end();
        return;
      }
      if (rawStart === '') {
        start = Math.max(0, stat.size - Number(rawEnd));
      } else {
        start = Number(rawStart);
        if (rawEnd !== '') end = Math.min(Number(rawEnd), stat.size - 1);
      }
      if (start > end || start >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        res.writeHead(416);
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
    } else {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
  } else {
    res.writeHead(200, { 'Content-Length': stat.size });
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(absPath, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) sendError(req, res, 500, 'อ่านไฟล์ไม่สำเร็จ');
    else res.destroy();
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------- request handler

function resolveSafePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) throw new Error('bad-path');
  const relPath = decoded.replace(/^\/+/, '');
  const segments = relPath.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) throw new Error('forbidden');
  const absPath = path.resolve(ROOT, relPath);
  const relative = path.relative(ROOT, absPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('forbidden');
  return { absPath, segments };
}

async function handleRequest(req, res) {
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    console.log(`${time}  ${req.method.padEnd(4)} ${res.statusCode} ${req.url}  ${ms.toFixed(1)}ms`);
  });

  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    return sendError(req, res, 400, 'URL ไม่ถูกต้อง');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendError(req, res, 405, 'รองรับเฉพาะ GET และ HEAD');
  }

  if (parsed.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  let resolved;
  try {
    resolved = resolveSafePath(parsed.pathname);
  } catch (error) {
    return sendError(req, res, error.message === 'forbidden' ? 403 : 400, 'เส้นทางนี้ไม่สามารถเข้าถึงได้');
  }

  const { absPath, segments } = resolved;
  const relPath = segments.join(path.sep);

  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    return sendError(req, res, 404, 'ไม่พบไฟล์หรือโฟลเดอร์ที่ขอ', relPath);
  }

  if (stat.isDirectory()) {
    if (!parsed.pathname.endsWith('/')) {
      res.writeHead(301, { Location: `${parsed.pathname}/${parsed.search}` });
      return res.end();
    }

    // The games folder always gets a fresh gallery, even though a static index.html exists.
    if (absPath === GAMES_DIR) {
      const gallery = await renderGamesGallery();
      if (gallery) return sendHtml(req, res, 200, gallery, relPath);
    }

    const indexFile = path.join(absPath, 'index.html');
    try {
      const indexStat = await fsp.stat(indexFile);
      if (indexStat.isFile()) {
        return serveFile(req, res, indexFile, path.join(relPath, 'index.html'), indexStat);
      }
    } catch {
      /* no index.html, fall through to listing */
    }

    try {
      const listing = await renderDirectoryListing(parsed.pathname, absPath);
      return sendHtml(req, res, 200, listing, relPath);
    } catch (error) {
      return sendError(req, res, 500, `อ่านโฟลเดอร์ไม่สำเร็จ: ${error.message}`, relPath);
    }
  }

  if (!stat.isFile()) {
    return sendError(req, res, 404, 'ไม่ใช่ไฟล์ปกติ', relPath);
  }

  return serveFile(req, res, absPath, relPath, stat);
}

// ---------------------------------------------------------------- startup

function getNetworkUrls(port) {
  const urls = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      execFile('open', [url]);
    } else {
      execFile('xdg-open', [url]);
    }
  } catch {
    /* browser opening is best-effort */
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Request failed:', error);
    if (!res.headersSent) sendError(req, res, 500, 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
    else res.destroy();
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ พอร์ต ${opts.port} ถูกใช้งานอยู่ — ลองรันด้วย --port อื่น เช่น: node server.js --port ${opts.port + 1}\n`);
  } else if (error.code === 'EACCES') {
    console.error(`\n❌ ไม่มีสิทธิ์เปิดพอร์ต ${opts.port} — ลองใช้พอร์ตมากกว่า 1024\n`);
  } else {
    console.error('\n❌ เปิดเซิร์ฟเวอร์ไม่สำเร็จ:', error.message, '\n');
  }
  process.exit(1);
});

server.listen(opts.port, opts.host, () => {
  const port = server.address().port;
  const localUrl = `http://localhost:${port}`;
  const networkUrls = getNetworkUrls(port);

  console.log('');
  console.log('  🏝️  Travel server');
  console.log('  ─────────────────────────────────────────');
  console.log(`  📂 Root:     ${ROOT}`);
  console.log(`  🏠 Local:    ${localUrl}`);
  if (opts.host === '0.0.0.0' || opts.host === '::') {
    for (const url of networkUrls) console.log(`  📱 Network:  ${url}`);
  }
  console.log(`  🎮 Games:    ${localUrl}/games/`);
  console.log('  ─────────────────────────────────────────');
  console.log('  กด Ctrl+C เพื่อหยุดเซิร์ฟเวอร์');
  console.log('');

  if (opts.open) openBrowser(localUrl);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n👋 ปิดเซิร์ฟเวอร์แล้ว');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
