const fs = require('node:fs');
const path = require('node:path');

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

console.log('Building standalone browser bundle for LockGuard Web Playground...');

const typesSrc = readFile('src/core/types.js');
const parserSrc = readFile('src/core/pg-parser.js');
const rule01 = readFile('src/core/rules/rule01-add-column-default.js');
const rule02 = readFile('src/core/rules/rule02-create-index-concurrently.js');
const rule03 = readFile('src/core/rules/rule03-foreign-key-not-valid.js');
const rule04 = readFile('src/core/rules/rule04-alter-column-type.js');
const rule05 = readFile('src/core/rules/rule05-unique-constraint.js');
const rule06 = readFile('src/core/rules/rule06-drop-column-table.js');
const rule07 = readFile('src/core/rules/rule07-vacuum-in-transaction.js');
const rule08 = readFile('src/core/rules/rule08-missing-lock-timeout.js');
const engineSrc = readFile('src/core/rule-engine.js');
const autoSplitterSrc = readFile('src/core/auto-splitter.js');
const contextSrc = readFile('src/core/context-analyzer.js');
const shadowSrc = readFile('src/core/shadow-replay.js');
const cascadeSrc = readFile('src/core/cascade-graph.js');

function stripRule(src) {
  return src
    .replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/module\.exports\s*=\s*/g, 'return ');
}

const browserBundle = `(function(window) {
  'use strict';

  // 1. Types & Constants
  ${typesSrc.replace(/module\.exports\s*=\s*\{[^}]*\};?/g, '')}

  // 2. Parser
  ${parserSrc.replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '').replace(/module\.exports\s*=\s*PgParser;?/g, '')}

  // 3. Rules
  const rule01 = (function() { ${stripRule(rule01)} })();
  const rule02 = (function() { ${stripRule(rule02)} })();
  const rule03 = (function() { ${stripRule(rule03)} })();
  const rule04 = (function() { ${stripRule(rule04)} })();
  const rule05 = (function() { ${stripRule(rule05)} })();
  const rule06 = (function() { ${stripRule(rule06)} })();
  const rule07 = (function() { ${stripRule(rule07)} })();
  const rule08 = (function() { ${stripRule(rule08)} })();

  // 4. Rule Engine
  ${engineSrc
    .replace(/const\s*PgParser\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/const\s*rule\d+\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/module\.exports\s*=\s*RuleEngine;?/g, '')}

  // 5. AutoSplitter
  ${autoSplitterSrc
    .replace(/const\s*PgParser\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/module\.exports\s*=\s*AutoSplitter;?/g, '')}

  // 6. Context Analyzer
  ${contextSrc
    .replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/module\.exports\s*=\s*ContextAnalyzer;?/g, '')}

  // 7. Shadow Replay
  ${shadowSrc
    .replace(/const\s*\{[^}]*\}\s*=\s*require\('[^']*'\);?/g, '')
    .replace(/module\.exports\s*=\s*ShadowReplaySimulator;?/g, '')}

  // 8. Cascade Graph
  ${cascadeSrc
    .replace(/module\.exports\s*=\s*CascadeGraph;?/g, '')}

  // Default instances
  const allRules = [rule01, rule02, rule03, rule04, rule05, rule06, rule07, rule08];
  const defaultEngine = new RuleEngine(allRules);

  window.LockGuard = {
    LockLevel,
    Severity,
    LockMatrix,
    PgParser,
    RuleEngine,
    AutoSplitter,
    ContextAnalyzer,
    ShadowReplaySimulator,
    CascadeGraph,
    rules: allRules,
    defaultEngine,
    analyze: function(sqlText, options) {
      return defaultEngine.analyze(sqlText, options);
    },
    generatePlan: function(analysis, orm) {
      return AutoSplitter.generatePlan(analysis, orm);
    },
    split: function(sqlText, orm) {
      const analysis = defaultEngine.analyze(sqlText);
      return AutoSplitter.generatePlan(analysis, orm);
    },
    simulate: function(analysis, options) {
      return ShadowReplaySimulator.simulate(analysis, options);
    },
    enrich: function(analysis, metadata) {
      return ContextAnalyzer.enrich(analysis, metadata);
    }
  };

  console.log('🛡️ LockGuard Browser Engine v1.1.0 loaded successfully.');
})(typeof window !== 'undefined' ? window : globalThis);
`;

const docsDir = path.join(__dirname, '..', 'docs');
fs.writeFileSync(path.join(docsDir, 'lockguard-engine.js'), browserBundle, 'utf8');
console.log('✅ Wrote docs/lockguard-engine.js successfully (' + (browserBundle.length / 1024).toFixed(1) + ' KB)');
