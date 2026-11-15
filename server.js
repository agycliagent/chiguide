'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.LLM_BASE_URL || 'https://llm.xinjiyuan.tech/v1').replace(/\/+$/, '');
const MODEL = process.env.LLM_MODEL || 'boss-31b';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, { model: MODEL, hasServerKey: Boolean(process.env.LLM_API_KEY) });
  }

  if (url.pathname === '/api/chat/completions' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_000_000) return sendJson(res, 413, { error: { message: 'Request body too large.' } });
    }
    let payload;
    try { payload = JSON.parse(body); }
    catch { return sendJson(res, 400, { error: { message: 'Invalid JSON request.' } }); }
    if (!Array.isArray(payload.messages)) {
      return sendJson(res, 400, { error: { message: 'A messages array is required.' } });
    }
    const apiKey = process.env.LLM_API_KEY || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!apiKey) return sendJson(res, 401, { error: { message: 'Set LLM_API_KEY in .env or enter an API key in the app settings.' } });
    try {
      const upstream = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...payload, model: payload.model || MODEL })
      });
      const responseBody = await upstream.text();
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(responseBody);
    } catch (error) {
      return sendJson(res, 502, { error: { message: `Could not reach the model API: ${error.message}` } });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: { message: 'Method not allowed.' } });
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return sendJson(res, 400, { error: { message: 'Invalid path.' } }); }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) return sendJson(res, 403, { error: { message: 'Forbidden.' } });
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    return req.method === 'HEAD' ? res.end() : res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ChiGuide is running at http://localhost:${PORT}`);
  console.log(`Model API: ${BASE_URL} (${MODEL})`);
  console.log(`Server-side API key: ${process.env.LLM_API_KEY ? 'configured' : 'not configured (enter one in the UI)'}`);
});
