const fs = require('fs');
const path = require('path');
const {
  RuleEngine,
  TerminalFormatter,
  GitHubPrFormatter,
  JsonFormatter
} = require('../core');

class LockGuardCLI {
  static run(argv = process.argv.slice(2)) {
    const args = this.parseArgs(argv);

    if (args.help || args.command === 'help' || !args.command) {
      this.printHelp();
      return 0;
    }

    if (args.command === 'rules') {
      return this.handleRulesCommand(args);
    }

    if (args.command === 'init') {
      return this.handleInitCommand(args);
    }

    if (args.command === 'check') {
      return this.handleCheckCommand(args);
    }

    console.error(`Unknown command: ${args.command}. Run "lockguard --help" for usage.`);
    return 2;
  }

  static parseArgs(argv) {
    const args = {
      command: null,
      files: [],
      format: 'table',
      apiKey: process.env.LOCKGUARD_API_KEY || null,
      failOn: 'HIGH',
      output: null,
      help: false,
      version: false
    };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (arg === '--help' || arg === '-h') {
        args.help = true;
      } else if (arg === '--version' || arg === '-v') {
        args.version = true;
      } else if (arg.startsWith('--format=')) {
        args.format = arg.split('=')[1].toLowerCase();
      } else if (arg === '--format' && argv[i + 1]) {
        args.format = argv[++i].toLowerCase();
      } else if (arg.startsWith('--api-key=')) {
        args.apiKey = arg.split('=')[1];
      } else if (arg === '--api-key' && argv[i + 1]) {
        args.apiKey = argv[++i];
      } else if (arg.startsWith('--fail-on=') || arg.startsWith('--severity=')) {
        args.failOn = arg.split('=')[1].toUpperCase();
      } else if ((arg === '--fail-on' || arg === '--severity') && argv[i + 1]) {
        args.failOn = argv[++i].toUpperCase();
      } else if (arg.startsWith('--migrations-dir=') || arg.startsWith('--migrations_dir=')) {
        args.files.push(arg.split('=')[1]);
      } else if ((arg === '--migrations-dir' || arg === '--migrations_dir') && argv[i + 1]) {
        args.files.push(argv[++i]);
      } else if (arg.startsWith('--output=')) {
        args.output = arg.split('=')[1];
      } else if (arg === '--output' && argv[i + 1]) {
        args.output = argv[++i];
      } else if (!args.command && !arg.startsWith('-')) {
        args.command = arg;
      } else if (!arg.startsWith('-')) {
        args.files.push(arg);
      }
    }

    return args;
  }

  static printHelp() {
    console.log(`
🛡️  LockGuard CLI: Automated PostgreSQL Table Lock Gatekeeper

USAGE:
  lockguard check <files-or-directory> [options]
  lockguard rules
  lockguard init

COMMANDS:
  check        Analyze SQL migration files for dangerous locks (ACCESS EXCLUSIVE, etc.)
  rules        Display the catalog of Top-8 fatal PostgreSQL lock rules
  init         Scaffold GitHub Action workflow and configuration

OPTIONS:
  --format=<type>       Output format: 'table' (default), 'github-pr-comment', 'json', 'markdown'
  --fail-on=<level>     Exit code 1 on severity: 'CRITICAL', 'HIGH' (default), 'MEDIUM'
  --api-key=<key>       LockGuard Team/Business API Key (or set LOCKGUARD_API_KEY env var)
  --output=<file>       Write report output to specified file path
  -h, --help            Show this help text
  -v, --version         Show version
`);
  }

  static handleRulesCommand() {
    const engine = new RuleEngine();
    const rules = engine.getRules();

    console.log('\n🛡️  LockGuard Active Rule Catalog (Top-8 Fatal Anti-Patterns):\n');
    for (const r of rules) {
      console.log(`• [${r.id}] ${r.name}`);
      console.log(`  Severity: ${r.severity} | Lock Level: ${r.lockLevel}`);
      console.log(`  Description: ${r.description}\n`);
    }
    return 0;
  }

  static handleInitCommand() {
    const workflowDir = path.join(process.cwd(), '.github', 'workflows');
    const workflowFile = path.join(workflowDir, 'lockguard.yml');

    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }

    const workflowContent = `name: LockGuard Migration Gatekeeper

on:
  pull_request:
    paths:
      - 'migrations/**'
      - 'prisma/migrations/**'
      - '**/*.sql'

jobs:
  lockguard-check:
    name: Check Dangerous PostgreSQL Locks
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run LockGuard CI Gatekeeper
        run: |
          npx lockguard check migrations/ --format=github-pr-comment --output=lockguard-report.md
        env:
          LOCKGUARD_API_KEY: \${{ secrets.LOCKGUARD_API_KEY }}

      - name: Post PR Comment
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            if (fs.existsSync('lockguard-report.md')) {
              const body = fs.readFileSync('lockguard-report.md', 'utf8');
              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: body
              });
            }
`;

    fs.writeFileSync(workflowFile, workflowContent, 'utf8');
    console.log(`✔ Created GitHub Action workflow at: ${workflowFile}`);
    return 0;
  }

  static handleCheckCommand(args) {
    if (args.files.length === 0) {
      args.files = ['migrations', 'fixtures', '.'];
    }

    // Resolve all SQL files
    const sqlFiles = [];
    for (const target of args.files) {
      const fullPath = path.resolve(process.cwd(), target);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          this.collectSqlFiles(fullPath, sqlFiles);
        } else if (fullPath.endsWith('.sql')) {
          sqlFiles.push(fullPath);
        }
      }
    }

    if (sqlFiles.length === 0) {
      console.warn(`No .sql migration files found in: ${args.files.join(', ')}`);
      return 0;
    }

    const engine = new RuleEngine();
    const results = [];

    for (const filePath of sqlFiles) {
      const relativeName = path.relative(process.cwd(), filePath);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      const analysis = engine.analyze(sqlContent, {
        filename: relativeName,
        failOnSeverity: args.failOn
      });
      results.push(analysis);
    }

    // Format output
    let outputText = '';
    if (args.format === 'json') {
      outputText = JsonFormatter.format(results);
    } else if (args.format === 'github-pr-comment' || args.format === 'markdown') {
      outputText = GitHubPrFormatter.format(results);
    } else {
      outputText = TerminalFormatter.format(results);
    }

    console.log(outputText);

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, outputText, 'utf8');
    }

    // Automatically populate GitHub Action Step Summary if running in GitHub Actions
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        const summaryContent = (args.format === 'github-pr-comment' || args.format === 'markdown')
          ? outputText
          : GitHubPrFormatter.format(results);
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + summaryContent + '\n', 'utf8');
      } catch (err) {
        // Silently continue if step summary is inaccessible
      }
    }

    // Determine exit code
    const anyFailed = results.some(r => !r.passed);
    return anyFailed ? 1 : 0;
  }

  static collectSqlFiles(dir, collected) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        this.collectSqlFiles(full, collected);
      } else if (entry.isFile() && entry.name.endsWith('.sql')) {
        collected.push(full);
      }
    }
  }
}

module.exports = LockGuardCLI;
