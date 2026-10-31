const { fork } = require('node:child_process');
const { scryptSync } = require('node:crypto');

const unavailable = () => Object.assign(new Error('Сервис входа временно недоступен. Повторите запрос.'), { statusCode: 503 });

function deriveIsolated(password, salt) {
  return new Promise((resolve, reject) => {
    const essentials = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|lang|lc_.*|tz)$/i.test(key)));
    let worker;
    try {
      worker = fork(__filename, [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: ['--max-old-space-size=32', '--max-semi-space-size=1'],
        env: { ...essentials, MALLOC_ARENA_MAX: '2', UV_THREADPOOL_SIZE: '1' } });
    } catch { reject(unavailable()); return; }
    let key, failed = false, done = false;
    const finish = code => {
      if (done) return;
      done = true; clearTimeout(deadline);
      if (!failed && code === 0 && key) resolve(key);
      else reject(unavailable());
    };
    const deadline = setTimeout(() => { failed = true; worker.kill(); }, 30000); deadline.unref();
    worker.on('message', message => {
      if (key || typeof message?.key !== 'string' || !/^[a-f0-9]{128}$/.test(message.key)) {
        failed = true; worker.kill(); return;
      }
      key = Buffer.from(message.key, 'hex');
    });
    worker.once('error', () => {
      failed = true;
      if (worker.pid) worker.kill();
      else finish(1);
    });
    // Wait for process exit, not just the key: native allocations must be released
    // before another expensive derivation is admitted.
    worker.once('exit', finish);
    worker.send({ password, salt }, error => { if (error) { failed = true; worker.kill(); } });
  });
}

if (require.main === module) {
  if (!process.send) process.exitCode = 1;
  else {
    process.once('disconnect', () => process.exit(1));
    process.once('message', message => {
      try {
        if (typeof message?.password !== 'string' || message.password.length < 12 || message.password.length > 128 ||
            Buffer.byteLength(message.password) > 256 || !/^[a-f0-9]{32}$/.test(message.salt)) throw unavailable();
        const key = scryptSync(message.password, message.salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
        process.send({ key: key.toString('hex') }, error => process.exit(error ? 1 : 0));
      } catch { process.send({ error: true }, () => process.exit(1)); }
    });
  }
}

module.exports = deriveIsolated;
