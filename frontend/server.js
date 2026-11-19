import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const backend = new URL(process.env.BACKEND_URL || 'http://backend:8080');
const port = Number(process.env.PORT || 80);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?')) {
    const upstream = http.request({
      hostname: backend.hostname,
      port: backend.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: backend.host },
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end('Backend unavailable');
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) file = resolve(root, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }
    const info = await stat(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 500).end('Unable to serve request');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Frontend listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
