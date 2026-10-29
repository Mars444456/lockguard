const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load environment variables from .env if present
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Add JSON response helper
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  // Match API routes
  const matched = router.match(req.method, pathname);
  if (matched) {
    req.params = matched.params;
    req.query = parsedUrl.query;

    if (req.method === 'POST' || req.method === 'PUT') {
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
      });
      req.on('end', async () => {
        try {
          req.body = bodyData ? JSON.parse(bodyData) : {};
        } catch {
          req.body = {};
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

  // Static File Serving from src/ui/
  let filePath = path.join(__dirname, '..', 'ui', pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Default SPA fallback to index.html for unknown routes
  const indexPath = path.join(__dirname, '..', 'ui', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.status(404).json({ error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`  🛡️  LockGuard Server Running at: http://localhost:${PORT}`);
  console.log(`  📊 Interactive Migration Playground: http://localhost:${PORT}`);
  console.log(`  🔌 REST API Base URL: http://localhost:${PORT}/api/v1`);
  console.log(`========================================================\n`);
});

module.exports = server;
