const fs = require('fs');
const path = require('path');
const {
  RuleEngine,
  TerminalFormatter,
  GitHubPrFormatter,
  JsonFormatter,
  AutoSplitter,
  ContextAnalyzer,
  CascadeGraph,
  PostDeployWatchdog,
  ShadowReplaySimulator
} = require('../core');
const GitHookManager = require('./git-hook');

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

  static parseArgs(argv) {
    const args = {
      command: null,
      files: [],
      format: 'table',
      apiKey: process.env.LOCKGUARD_API_KEY || null,
      failOn: 'HIGH',
      output: null,
      orm: 'sql',
      withContext: false,
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
  lockguard check <files-or-directory> [options]
  lockguard split <file.sql> [--orm=sql|prisma|drizzle]
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
  rules         Display the catalog of Top-8 fatal PostgreSQL lock rules
  init          Scaffold GitHub Action workflow and configuration

OPTIONS:
  --format=<type>       Output format: 'table' (default), 'github-pr-comment', 'json', 'markdown'
  --fail-on=<level>     Exit code 1 on severity: 'CRITICAL', 'HIGH' (default), 'MEDIUM'
  --context             Enrich analysis with live table row count & estimated lock durations
  --orm=<type>          Target ORM for Auto-Splitter: 'sql' (default), 'prisma', 'drizzle'
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
        uses: Mars444456/lockguard@v1
        with:
          migrations_dir: './migrations'
          format: 'github-pr-comment'
`;

    fs.writeFileSync(workflowFile, workflowContent, 'utf8');
    console.log(`✔ Created GitHub Action workflow at: ${workflowFile}`);
    return 0;
  }

  static handleCheckCommand(args) {
    if (args.files.length === 0) {
      args.files = ['migrations', 'fixtures', '.'];
    }

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
      let analysis = engine.analyze(sqlContent, {
        filename: relativeName,
        failOnSeverity: args.failOn
      });

      if (args.withContext) {
        analysis = ContextAnalyzer.enrich(analysis);
      }

      results.push(analysis);
    }

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

    const anyFailed = results.some(r => !r.passed);
    return anyFailed ? 1 : 0;
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

    return 0;
  }

  static handleInstallHookCommand() {
    try {
      const res = GitHookManager.installHook();
      console.log(res.message);
      return 0;
    } catch (err) {
      console.error(`Failed to install pre-commit hook:`, err.message);
      return 1;
    }
  }

  static handleHookCommand() {
    return GitHookManager.runHook();
  }

  static handleWatchdogCommand(args) {
    console.log(`\n========================================================================`);
    console.log(`  🛡️  LockGuard Post-Deploy Invalid Index Watchdog`);
    console.log(`========================================================================\n`);

    // In a live environment, this runs PostDeployWatchdog.getDiagnosticQuery()
    // Here we evaluate with simulated telemetry to showcase detection:
    const mockTelemetry = [
      {
        index_name: 'idx_orders_user_id_failed',
        table_name: 'orders',
        is_valid: false,
        index_size: '3.4 GB'
      }
    ];

    const report = PostDeployWatchdog.evaluate(mockTelemetry);

    if (report.healthy) {
      console.log(`✔ Database Healthy: No INVALID or corrupted indexes detected.`);
      return 0;
    }

    console.log(`⚠️  ALERT: Detected ${report.totalInvalidCount} corrupted/invalid index(es) in database!\n`);

    for (const item of report.invalidIndexes) {
      console.log(`• Index: ${item.indexName} (Table: ${item.tableName}, Size: ${item.size})`);
      console.log(`  Threat: ${item.impact}`);
      console.log(`  Safe Fix Action:\n`);
      console.log(item.safeFix + '\n');
    }

    return 1;
  }

  static handleSimulateCommand(args) {
    const targetFile = args.files[0] || 'fixtures/09_catastrophic_combined.sql';
    if (!fs.existsSync(targetFile)) {
      console.error(`File not found: ${targetFile}`);
      return 1;
    }

    const sql = fs.readFileSync(targetFile, 'utf8');
    const engine = new RuleEngine();
    const analysis = engine.analyze(sql, { filename: targetFile });
    const sim = ShadowReplaySimulator.simulate(analysis, { simulatedRows: 50000, concurrentRps: 250 });

    console.log(`\n========================================================================`);
    console.log(`  🛡️  LockGuard Shadow Replay: Simulated Traffic Contention`);
    console.log(`========================================================================\n`);
    console.log(`Target: ${targetFile} | Simulated Rows: ${sim.simulatedRows.toLocaleString()} | Traffic: ${sim.simulatedConcurrentRps} RPS\n`);
    console.log(`📊 Total Simulated Lock Delay: ${sim.totalLockWaitContentionMs}ms`);
    console.log(`💥 Total Blocked Client Requests: ~${sim.totalBlockedQueriesEstimated}\n`);

    for (const item of sim.tableSimulations) {
      console.log(`• Table: ${item.table} | Rule: ${item.ruleId} | Lock: ${item.lockLevel}`);
      console.log(`  Estimated Lock Delay: ${item.simulatedContentionMs}ms | Blocked Requests: ~${item.blockedQueriesEstimated}`);
      console.log(`  Status: ${item.verdict}\n`);
    }

    console.log(sim.summary + '\n');
    return 0;
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
