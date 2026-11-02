const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load environment variables from .env if present
try { process.loadEnvFile(); } catch(error) { if(error.code!=='ENOENT')throw error; }

const PORT = parseInt(process.env.PORT || '3000', 10);
const registerRoutes = require('./routes');

// Router implementation
class SimpleRouter {
  constructor() {
    this.routes = [];
  }

  get(pathPattern, handler) {
    this.addRoute('GET', pathPattern, handler);
  }

  post(pathPattern, handler) {
    this.addRoute('POST', pathPattern, handler);
  }

  delete(pathPattern, handler) {
    this.addRoute('DELETE', pathPattern, handler);
  }

  addRoute(method, pathPattern, handler) {
    const paramNames = [];
    const regexPath = pathPattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      regex: new RegExp(`^${regexPath}$`),
      paramNames,
      handler
    });
  }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method === method) {
        const m = pathname.match(r.regex);
        if (m) {
          const params = {};
          r.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(m[i + 1]);
          });
          return { handler: r.handler, params };
        }
      }
    }
    return null;
  }
}

const router = new SimpleRouter();
registerRoutes(router);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveFile(file, res) {
  if (process.env.LOCKGUARD_EPHEMERAL_DEMO === 'true' && path.extname(file).toLowerCase() === '.html') {
    const banner = '<aside role="note" style="padding:14px 20px;background:#302917;color:#ffebbd;border-bottom:1px solid #8f7846;text-align:center;font:14px/1.6 system-ui">Тестовый стенд: аккаунты, история и схемы могут сброситься при перезапуске. Используйте только учебные данные.</aside>';
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(file, 'utf8').replace(/<body\b[^>]*>/i, match => match + banner));
  } else fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Add JSON response helper
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  let parsedUrl;
  let matched;
  try {
    parsedUrl = new URL(req.url, 'http://localhost');
    decodeURIComponent(parsedUrl.pathname);
    matched = router.match(req.method, parsedUrl.pathname);
  } catch {
    return res.status(400).json({ error: 'Malformed request URL' });
  }
  const pathname = parsedUrl.pathname;

  // Match API routes
  if (matched) {
    req.params = matched.params;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());

    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      let bodyBytes = 0;
      const MAX_BODY_SIZE = 1024 * 1024; // 1 MB limit
      let sizeExceeded = false;

      req.on('data', chunk => {
        if (sizeExceeded) return;
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY_SIZE) {
          sizeExceeded = true;
          chunks.length = 0;
          res.status(413).json({ error: 'Payload Too Large: maximum body size is 1MB' });
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (sizeExceeded) return;
        try {
          const bodyData = Buffer.concat(chunks).toString('utf8');
          req.rawBody = Buffer.concat(chunks);
          if (pathname === '/api/v1/billing/robokassa/result' && (req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded') {
            const form = new URLSearchParams(bodyData);
            const entries = [...form.entries()];
            if (entries.length > 20 || new Set(entries.map(([key]) => key)).size !== entries.length) {
              return res.status(400).json({ error: 'Duplicate or excessive payment parameters' });
            }
            req.body = Object.fromEntries(entries);
          } else req.body = bodyData ? JSON.parse(bodyData) : {};
          if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'JSON body must be an object' });
          }
        } catch {
          return res.status(400).json({ error: 'Malformed JSON body' });
        }
        try {
          await matched.handler(req, res);
        } catch (err) {
          console.error('Handler error:', err);
          res.status(500).json({ error: 'Server handler error' });
        }
      });
      return;
    } else {
      req.body = {};
      try {
        await matched.handler(req, res);
      } catch (err) {
        console.error('Handler error:', err);
        res.status(500).json({ error: 'Server handler error' });
      }
      return;
    }
  }

  if (pathname.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }

  // Static File Serving from src/ui/
  const uiDir = path.resolve(__dirname, '..', 'ui');
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    decodedPath = pathname;
  }

  // Path Traversal Protection: reject any path attempting directory traversal
  if (decodedPath.includes('..') || req.url.includes('..')) {
    res.status(403).json({ error: 'Forbidden: Path traversal detected' });
    return;
  }

  const safeRelativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let filePath = path.resolve(uiDir, safeRelativePath);

  if (!filePath.startsWith(uiDir)) {
    res.status(403).json({ error: 'Forbidden: Path traversal detected' });
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    serveFile(filePath, res);
    return;
  }

  // Default SPA fallback to index.html for unknown routes
  const indexPath = path.join(uiDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    serveFile(indexPath, res);
    return;
  }

  res.status(404).json({ error: 'Not Found' });
});

if (require.main === module) {
  const stopBackups = require('./backup-scheduler')(require('./db'));
  server.on('close', stopBackups);
  server.listen(PORT, () => {
    console.log(`\n========================================================`);
    console.log(`  🛡️  LockGuard Server Running at: http://localhost:${PORT}`);
    console.log(`  📊 Interactive Migration Playground: http://localhost:${PORT}`);
    console.log(`  🔌 REST API Base URL: http://localhost:${PORT}/api/v1`);
    console.log(`========================================================\n`);
  });
}

module.exports = server;
