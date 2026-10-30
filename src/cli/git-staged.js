const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = args => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000
});

function root() {
  return git(['rev-parse', '--show-toplevel']).trim();
}

module.exports = {
  list() {
    try {
      const directory = root();
      return git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
        .split('\0').filter(file => file.endsWith('.sql')).map(file => path.resolve(directory, file));
    } catch (cause) {
      throw new Error('Cannot read staged migrations from Git. Audit was not completed.', { cause });
    }
  },
  read(file) {
    const relative = path.relative(root(), file).split(path.sep).join('/');
    return git(['show', `:${relative}`]);
  }
};
