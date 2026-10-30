const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  RuleEngine,
  TerminalFormatter,
  GitHubPrFormatter,
  JsonFormatter,
  SarifFormatter,
  AutoSplitter,
  ContextAnalyzer,
  CascadeGraph,
  PostDeployWatchdog,
  ShadowReplaySimulator,
  PgParser
} = require('../core');
const GitHookManager = require('./git-hook');

class LockGuardCLI {
  static run(argv = process.argv.slice(2)) {
    const config = this.loadConfig();
    const args = this.parseArgs(argv, config);

    if (args.version) {
      console.log('LockGuard v1.1.0');
      return 0;
    }

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
      return this.handleCheckCommand(args, config);
    }

    if (args.command === 'split') {
      return this.handleSplitCommand(args);
    }

    if (args.command === 'install-hook') {
      return this.handleInstallHookCommand(args);
    }

    if (args.command === 'hook') {
      return this.handleHookCommand(args);
    }

    if (args.command === 'watchdog') {
      return this.handleWatchdogCommand(args);
    }

    if (args.command === 'simulate') {
      return this.handleSimulateCommand(args);
    }

    console.error(`Unknown command: ${args.command}. Run "lockguard --help" for usage.`);
    return 2;
  }

  static loadConfig() {
    const configPath = path.join(process.cwd(), '.lockguardrc.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`⚠️ Warning: Could not parse .lockguardrc.json: ${err.message}`);
      }
    }
    return {};
  }

  static parseArgs(argv, config = {}) {
    const args = {
      command: null,
      files: [],
      format: config.format || 'table',
      apiKey: process.env.LOCKGUARD_API_KEY || null,
      failOn: config.failOn || 'HIGH',
      failOnWarning: !!config.failOnWarning,
      defaultLockTimeout: config.defaultLockTimeout || '3s',
      ignoreRules: config.ignoreRules || [],
      strict: !!config.strict,
      changed: false,
      changedBase: null,
      staged: false,
      fix: false,
      output: null,
      orm: 'sql',
      withContext: false,
      context: false,
      schemaStats: null,
      write: false,
      outDir: null,
      isolated: false,
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
      } else if (arg.startsWith('--output=')) {
        args.output = arg.split('=')[1];
      } else if (arg === '--output' && argv[i + 1]) {
        args.output = argv[++i];
      } else if (arg.startsWith('--orm=')) {
        args.orm = arg.split('=')[1].toLowerCase();
      } else if (arg === '--orm' && argv[i + 1]) {
        args.orm = argv[++i].toLowerCase();
      } else if (arg === '--context' || arg === '--with-context') {
        args.withContext = true;
        args.context = true;
      } else if (arg.startsWith('--schema-stats=')) {
        args.schemaStats = arg.split('=')[1];
      } else if (arg === '--schema-stats' && argv[i + 1]) {
        args.schemaStats = argv[++i];
      } else if (arg === '--write') {
        args.write = true;
      } else if (arg.startsWith('--out-dir=')) {
        args.outDir = arg.split('=')[1];
      } else if (arg === '--out-dir' && argv[i + 1]) {
        args.outDir = argv[++i];
      } else if (arg === '--isolated') {
        args.isolated = true;
      } else if (arg === '--strict') {
        args.strict = true;
      } else if (arg === '--fix') {
        args.fix = true;
      } else if (arg === '--staged') {
        args.staged = true;
      } else if (arg.startsWith('--changed=')) {
        args.changed = true;
        args.changedBase = arg.split('=')[1];
      } else if (arg === '--changed') {
        args.changed = true;
        if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
          args.changedBase = argv[++i];
        } else {
          args.changedBase = 'origin/main';
        }
      } else if (arg.startsWith('--migrations-dir=') || arg.startsWith('--migrations_dir=')) {
        args.files.push(arg.split('=')[1]);
      } else if ((arg === '--migrations-dir' || arg === '--migrations_dir') && argv[i + 1]) {
        args.files.push(argv[++i]);
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
  lockguard check [files-or-directory] [options]
  lockguard split <file.sql> [--write] [--out-dir=<dir>] [--orm=sql|prisma|drizzle|django|alembic]
  lockguard install-hook
  lockguard watchdog
  lockguard simulate <file.sql>
  lockguard rules
  lockguard init

COMMANDS:
  check         Analyze SQL migration files for dangerous locks (ACCESS EXCLUSIVE, etc.)
  split         Auto-Splitter: Deconstruct monolithic migration into zero-downtime multi-phase releases
  install-hook  Install Git pre-commit hook to catch locks before pushing to GitHub
  watchdog      Post-deploy watchdog: Detect invalid/broken indexes from failed CONCURRENTLY runs
  simulate      Shadow replay: Simulate concurrent query traffic and measure lock latency
  rules         Display the catalog of Top-12 fatal PostgreSQL lock rules
  init          Scaffold GitHub Action workflow and configuration

OPTIONS:
  --changed [base]        Check only new/modified .sql files against git base (default: origin/main)
  --staged                Check only staged .sql files (for pre-commit hooks)
  --fix                   Automatically apply safe fixes (e.g. insert lock_timeout, add CONCURRENTLY)
  --write                 Write generated split migration phases to disk (used with split)
  --out-dir=<dir>         Output directory for generated migration files (used with split)
  --isolated              Check each migration file in isolation without inter-file shared context
  --schema-stats=<file>   Load real-world table size/row counts from JSON to enrich lock duration
  --context               Enrich analysis with live table row count & estimated lock durations
  --format=<type>         Output format: 'table' (default), 'json', 'sarif', 'github-pr-comment', 'markdown'
  --strict                Exit with code 1 on warnings as well as critical/high errors
  --fail-on=<level>       Exit code 1 on severity: 'CRITICAL', 'HIGH' (default), 'MEDIUM'
  --orm=<type>            Target ORM for Auto-Splitter: 'sql' (default), 'prisma', 'drizzle', 'django', 'alembic'
  --api-key=<key>         LockGuard Team/Business API Key (or set LOCKGUARD_API_KEY env var)
  --output=<file>         Write report output to specified file path
  -h, --help              Show this help text
  -v, --version           Show version
`);
  }

  static handleRulesCommand() {
    const engine = new RuleEngine();
    const rules = engine.getRules();

    console.log(`\n🛡️  LockGuard Active Rule Catalog (Top-${rules.length} Fatal Anti-Patterns):\n`);
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
    const configPath = path.join(process.cwd(), '.lockguardrc.json');

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
          npx lockguard check --changed origin/main --format=github-pr-comment --output=lockguard-pr-report.md
`;

    const sampleConfig = {
      ignoreRules: [],
      failOnWarning: false,
      defaultLockTimeout: '3s',
      strict: false
    };

    fs.writeFileSync(workflowFile, workflowContent, 'utf8');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(sampleConfig, null, 2) + '\n', 'utf8');
      console.log(`✔ Created configuration file at: ${configPath}`);
    }
    console.log(`✔ Created GitHub Action workflow at: ${workflowFile}`);
    return 0;
  }

  static collectSqlFiles(dir, fileList = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          this.collectSqlFiles(fullPath, fileList);
        }
      } else if (entry.name.endsWith('.sql')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  static getGitChangedFiles(base = 'origin/main') {
    try {
      const out = execSync(`git diff --name-only --diff-filter=AM ${base}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return out.split(/\r?\n/).map(s => s.trim()).filter(s => s.endsWith('.sql') && fs.existsSync(s));
    } catch {
      try {
        const out = execSync(`git diff --name-only --diff-filter=AM HEAD~1`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        return out.split(/\r?\n/).map(s => s.trim()).filter(s => s.endsWith('.sql') && fs.existsSync(s));
      } catch {
        return [];
      }
    }
  }

  static getGitStagedFiles() {
    try {
      const out = execSync('git diff --cached --name-only --diff-filter=AM', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return out.split(/\r?\n/).map(s => s.trim()).filter(s => s.endsWith('.sql') && fs.existsSync(s));
    } catch {
      return [];
    }
  }

  static applyAutoFix(filePath, defaultLockTimeout = '3s') {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      const ast = PgParser.parse(content);
      let changed = false;

      // Fix LG-008: Missing lock_timeout
      const hasDdl = ast.some(s => s.type === 'ALTER_TABLE' || s.type === 'CREATE_INDEX' || s.type === 'DROP_TABLE');
      const hasLockTimeout = ast.some(s => s.type === 'SET_VARIABLE' && s.variable === 'lock_timeout');
      const hasTransaction = ast.some(s => s.type === 'TRANSACTION_START');

      if (hasDdl && !hasLockTimeout) {
        const timeoutPrefix = `-- Auto-fixed by LockGuard: Prevent queue lockups\nSET lock_timeout = '${defaultLockTimeout}';\nSET statement_timeout = '30s';\n\n`;
        content = timeoutPrefix + content;
        if (!hasTransaction) {
          if (!content.endsWith('\n')) content += '\n';
          content += `\nRESET lock_timeout;\nRESET statement_timeout;\n`;
        }
        changed = true;
      }

      // Fix LG-002: Add CONCURRENTLY if no transaction block (preserving SQL comments)
      if (!hasTransaction) {
        let inBlockComment = false;
        const lines = content.split('\n');
        const newLines = lines.map(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return line;
          if (trimmed.startsWith('/*')) { inBlockComment = true; return line; }
          if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false;
            return line;
          }
          if (trimmed.startsWith('--')) return line;

          const commentIdx = line.indexOf('--');
          let codePart = commentIdx !== -1 ? line.slice(0, commentIdx) : line;
          const commentPart = commentIdx !== -1 ? line.slice(commentIdx) : '';

          const nonConcurrentRegex = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/gi;
          if (nonConcurrentRegex.test(codePart)) {
            codePart = codePart.replace(nonConcurrentRegex, (match, unique) => {
              changed = true;
              return unique ? 'CREATE UNIQUE INDEX CONCURRENTLY ' : 'CREATE INDEX CONCURRENTLY ';
            });
          }
          return codePart + commentPart;
        });

        if (changed) {
          content = newLines.join('\n');
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✔ [AUTO-FIX] Applied safe zero-downtime fixes to ${path.relative(process.cwd(), filePath)}`);
      }
    } catch (err) {
      console.warn(`⚠️ Warning: Auto-fix failed on ${filePath}: ${err.message}`);
    }
  }

  static handleCheckCommand(args, config = {}) {
    let sqlFiles = [];

    if (args.staged) {
      sqlFiles = this.getGitStagedFiles();
      if (sqlFiles.length === 0) {
        console.log('✔ No staged .sql files found.');
        return 0;
      }
    } else if (args.changed) {
      sqlFiles = this.getGitChangedFiles(args.changedBase || 'origin/main');
      if (sqlFiles.length === 0) {
        console.log('✔ No changed .sql files found.');
        return 0;
      }
    } else {
      if (args.files.length === 0) {
        args.files = ['migrations', 'fixtures', '.'];
      }

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
    }

    sqlFiles = Array.from(new Set(sqlFiles)).sort((a, b) => a.localeCompare(b));

    if (sqlFiles.length === 0) {
      console.warn(`No .sql migration files found in: ${args.files.join(', ')}`);
      return 0;
    }

    // Apply auto-fixes if requested
    if (args.fix) {
      for (const file of sqlFiles) {
        this.applyAutoFix(file, args.defaultLockTimeout);
      }
    }

    const engine = new RuleEngine();
    const results = [];
    const sharedState = args.isolated ? null : {
      createdTables: new Set(),
      createdIndexes: new Set(),
      validatedChecks: new Set(),
      candidateChecks: new Map()
    };

    let schemaStats = {};
    if (args.schemaStats || (args.context && process.env.DATABASE_URL)) {
      schemaStats = ContextAnalyzer.fetchSchemaStats({
        schemaStatsPath: args.schemaStats,
        useLiveDb: !!args.context,
        databaseUrl: process.env.DATABASE_URL
      });
    }

    for (const filePath of sqlFiles) {
      const relativeName = path.relative(process.cwd(), filePath);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      let analysis = engine.analyze(sqlContent, {
        filename: relativeName,
        failOnSeverity: args.failOn,
        ignoreRules: args.ignoreRules,
        sharedState
      });

      if (args.withContext || args.context || args.schemaStats) {
        analysis = ContextAnalyzer.enrich(analysis, { tables: schemaStats });
      }

      results.push(analysis);
    }

    let outputText = '';
    if (args.format === 'json') {
      outputText = JsonFormatter.format(results);
    } else if (args.format === 'sarif') {
      outputText = SarifFormatter.format(results);
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

    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        const summaryContent = (args.format === 'github-pr-comment' || args.format === 'markdown')
          ? outputText
          : GitHubPrFormatter.format(results);
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + summaryContent + '\n', 'utf8');
      } catch {
        // Continue silently if inaccessible
      }
    }

    // Severity Exit Code Determination:
    if (results.some(r => !r.passed)) {
      return 1;
    }

    if (results.some(r => r.violationsCount > 0) && (args.strict || args.failOnWarning)) {
      return 1;
    }

    return 0;
  }

  static handleSplitCommand(args) {
    const targetFile = args.files[0];
    if (!targetFile || !fs.existsSync(targetFile)) {
      console.error(`Please specify a valid migration file: lockguard split <file.sql> [--orm=sql|prisma|drizzle]`);
      return 1;
    }

    const sql = fs.readFileSync(targetFile, 'utf8');
    const engine = new RuleEngine();
    const analysis = engine.analyze(sql, { filename: targetFile });
    const plan = AutoSplitter.generatePlan(analysis, args.orm);

    console.log(`\n========================================================================`);
    console.log(`  🛡️  LockGuard Auto-Splitter: Multi-Phase Migration Plan (${args.orm.toUpperCase()})`);
    console.log(`========================================================================\n`);

    if (plan.isSafe) {
      console.log(`✔ ${plan.message}\n`);
      return 0;
    }

    console.log(`Generated ${plan.totalPhases} safe deployment phases to prevent table locking:\n`);

    for (const phase of plan.phases) {
      console.log(`------------------------------------------------------------------------`);
      console.log(`📦 [PHASE ${phase.phaseNumber}]: ${phase.title}`);
      console.log(`ℹ️  ${phase.description}`);
      console.log(`------------------------------------------------------------------------`);
      console.log(phase.sql + '\n');
    }

    if (args.write) {
      const writtenFiles = AutoSplitter.writePhasesToDisk(plan, targetFile, args.outDir);
      console.log(`\n💾 Written ${writtenFiles.length} split phase file(s) to disk:`);
      for (const f of writtenFiles) {
        console.log(`  ✔ Phase ${f.phase}: ${path.relative(process.cwd(), f.path)}`);
      }
    }

    return 0;
  }

  static handleInstallHookCommand() {
    try {
      const res = GitHookManager.installHook();
      console.log(res.message);
      return 0;
    } catch (err) {
      console.error('Failed to install hook:', err.message);
      return 1;
    }
  }

  static handleHookCommand(args) {
    return GitHookManager.runPreCommitAudit();
  }

  static handleWatchdogCommand(args) {
    console.log(`🛡️  LockGuard Post-Deploy Watchdog starting...`);
    const status = PostDeployWatchdog.inspectProduction();
    console.log(status.message);
    return status.hasBrokenIndexes ? 1 : 0;
  }

  static handleSimulateCommand(args) {
    const targetFile = args.files[0];
    if (!targetFile || !fs.existsSync(targetFile)) {
      console.error('Please specify a valid migration file: lockguard simulate <file.sql>');
      return 1;
    }

    const sql = fs.readFileSync(targetFile, 'utf8');
    const engine = new RuleEngine();
    const analysis = engine.analyze(sql, { filename: targetFile });

    const sim = ShadowReplaySimulator.simulate(analysis, { simulatedRows: 14200000, concurrentRps: 250 });

    console.log(`\n========================================================================`);
    console.log(`  🛡️  LockGuard Shadow Replay Simulation`);
    console.log(`========================================================================\n`);
    console.log(`Simulated Database Size: 14,200,000 rows (~8.4 GB)`);
    console.log(`Concurrent Traffic: 250 RPS\n`);
    console.log(`Total Lock Contention: ${(sim.totalLockWaitContentionMs / 1000).toFixed(2)} seconds`);
    console.log(`Estimated Blocked Queries: ~${sim.totalBlockedQueriesEstimated.toLocaleString()} requests`);
    console.log(`Outage Risk: ${sim.outageSeverity}\n`);

    return sim.outageSeverity === 'CATASTROPHIC' ? 1 : 0;
  }
}

module.exports = LockGuardCLI;
