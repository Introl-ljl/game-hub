const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const envFile = loadEnvFile(path.join(__dirname, '.env.backend'));
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || envFile.BACKEND_ORIGIN || 'http://192.168.1.104:3050';
const PROXY_SECRET = process.env.BACKEND_PROXY_SECRET || process.env.PROXY_SECRET || envFile.PROXY_SECRET;
const HOP_BY_HOP = ['connection', 'content-length', 'host', 'transfer-encoding', 'accept-encoding', 'origin', 'cf-connecting-ip', 'cf-ray'];

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return proxyApi(request, response, url);
  serveStatic(response, url);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Game Hub running at http://localhost:${PORT}`);
  console.log(PROXY_SECRET ? `API proxy → ${BACKEND_ORIGIN}` : 'API proxy disabled (no PROXY_SECRET in .env.backend)');
});

async function proxyApi(request, response, url) {
  if (!PROXY_SECRET) return sendJson(response, 503, { error: '本地后端未配置', code: 'BACKEND_UNAVAILABLE' });
  try {
    const targetPath = url.pathname === '/api/health' ? '/healthz' : url.pathname;
    const target = new URL(targetPath + url.search, BACKEND_ORIGIN);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP.includes(name.toLowerCase())) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('x-gamehub-proxy-secret', PROXY_SECRET);
    headers.set('x-gamehub-client-ip', request.socket.remoteAddress || 'unknown');
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    response.statusCode = upstream.status;
    const setCookies = upstream.headers.getSetCookie?.() || [];
    for (const [name, value] of upstream.headers) {
      if (['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie'].includes(name.toLowerCase())) continue;
      response.setHeader(name, value);
    }
    if (setCookies.length) response.setHeader('Set-Cookie', setCookies.map((cookie) => cookie.replace(/;\s*secure/gi, '')));
    response.setHeader('Cache-Control', 'no-store');
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('API proxy failed', error);
    sendJson(response, 502, { error: '后端服务暂时不可用', code: 'BACKEND_UNAVAILABLE' });
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128 * 1024) { request.destroy(); reject(new Error('Request body too large')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function serveStatic(response, url) {
  let requested = url.pathname === '/' ? '/index.html' : url.pathname;
  if (['/seconds', '/schulte'].includes(requested)) requested += '/';
  if (requested.endsWith('/')) {
    if (!['/seconds/', '/schulte/'].includes(requested)) return respond(response, 404, 'Not found');
    requested += 'index.html';
  }
  const file = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!file.startsWith(PUBLIC_DIR)) return respond(response, 403, 'Forbidden');
  fs.readFile(file, (error, content) => {
    if (error) return respond(response, error.code === 'ENOENT' ? 404 : 500, 'Not found');
    response.writeHead(200, {
      'Content-Type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': shouldRevalidate(file) ? 'no-cache' : 'public, max-age=3600'
    });
    response.end(content);
  });
}

function shouldRevalidate(file) {
  return path.extname(file) === '.html' || file.endsWith('sw.js') || file.endsWith('daily-levels.json');
}

function respond(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function loadEnvFile(file) {
  try {
    const env = {};
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}
