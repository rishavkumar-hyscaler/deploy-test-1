import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function startFrontend(t, backendUrl = 'http://127.0.0.1:1') {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, PORT: '0', BACKEND_URL: backendUrl },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.on('error', reject);
    child.once('exit', code => reject(new Error(`Frontend exited: ${code}`)));
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Frontend listening on port (\d+)/);
      if (match) resolve(Number(match[1]));
    });
  });
  return `http://127.0.0.1:${port}`;
}

const options = { timeout: 15000 };

test('serves the React build, JavaScript assets, and client-side routes', options, async t => {
  const base = await startFrontend(t);
  const expected = await readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(await home.text(), expected);
  const asset = expected.match(/src="([^" ]+\.js)"/)[1];
  const script = await fetch(base + asset);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.ok((await script.text()).length > 0);
  const route = await fetch(base + '/tasks/123');
  assert.equal(route.status, 200);
  assert.equal(await route.text(), expected);
});

test('proxies API method, path, query, body, and response status', options, async t => {
  const backend = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, path: req.url, body }));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const base = await startFrontend(t, `http://127.0.0.1:${backend.address().port}`);
  const body = JSON.stringify({ title: 'Practice CI' });
  const response = await fetch(base + '/api/tasks?source=test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { method: 'POST', path: '/api/tasks?source=test', body });
});

test('returns 502 when the backend is unavailable', options, async t => {
  // Reserve then release a local port so this test needs no external backend.
  const backend = http.createServer();
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const port = backend.address().port;
  await new Promise(resolve => backend.close(resolve));
  const base = await startFrontend(t, `http://127.0.0.1:${port}`);
  const response = await fetch(base + '/api/tasks');
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'Backend unavailable');
});
