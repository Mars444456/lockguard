/**
 * LockGuard Auto-Splitter
 * Drafts multi-phase migrations for manual review and isolated testing.
 * Supports targets: Raw SQL, Prisma, Drizzle, Alembic, and Django.
 */

const rewrite = require('./sql-rewrite');
const PgParser=require('./pg-parser');
const { generatedName } = require('./sql-identifiers');
class AutoSplitter {
  /**
   * Generates a multi-step release plan for a migration AST / violations.
   * @param {object} analysis Analysis result from RuleEngine
   * @param {string} targetOrm 'sql' | 'prisma' | 'drizzle' | 'alembic' | 'django'
   */
  static generatePlan(analysis, targetOrm = 'sql') {
    if(!['sql','prisma','drizzle','alembic','django'].includes(targetOrm))throw Object.assign(new Error('Unsupported migration format.'),{statusCode:400});
    const phases = [];
    const manualSteps = [];
    const violations = analysis.violations || [];
    if (analysis.analysisComplete === false || analysis.coverageComplete === false) {
      throw Object.assign(new Error('Cannot generate migration phases from incomplete SQL analysis or excluded checks.'),{statusCode:422});
    }

    if (violations.length === 0) {
      return {
        isSafe: true,
        requiresReview: true,
        manualSteps: [],
        originalSql: analysis.originalSql,
        message: 'No configured rule findings. Runtime locks, data compatibility and downtime still require review.',
        phases: []
      };
    }

    // Phase 1: Pre-deployment non-blocking schema modifications
    const phase1Statements = [];
    // Phase 2: Asynchronous data backfill (worker/script)
    const phase2Operations = [];
    // Phase 3: Constraint enforcement & index finalization
    const phase3Statements = [];
    // Phase 4: Validation & Cleanup
    const phase4Statements = [];

    for (const v of violations) {
      const table = v.table || 'your_table';

      switch (v.ruleId) {
        // 1. ADD COLUMN with volatile DEFAULT
        case 'LG-001': {
          if(v.rewriteReason==='DEFAULT_VOLATILITY_UNKNOWN'){
            manualSteps.push({ruleId:v.ruleId,table,column:v.column,checks:['Inspect function and cast volatility, column type constraints and historical default semantics in the target database. No equivalent staged rewrite is established.']});
            break;
          }
          const col = v.column || 'new_column';
          const check = generatedName('chk', table, col, 'not_null');
          const def = v.defaultValue || 'now()';
          phase1Statements.push(`-- Phase 1 (Deploy 1): Add column as nullable without default`);
          phase1Statements.push(`ALTER TABLE ${table} ADD COLUMN ${col} ${v.dataType || 'TEXT'}${v.collation ? ' COLLATE '+v.collation : ''};`);
          phase1Statements.push(`ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${def};`);

          phase2Operations.push(`-- Phase 2 (Async Background Worker): Backfill historical rows in small batches`);
          phase2Operations.push(`-- Run one bounded batch per transaction. Inspect progress and repeat only after review.`);
          phase2Operations.push(`-- SKIP LOCKED may leave rows behind; a zero-row batch does not prove completion.`);
          phase2Operations.push(`WITH lg_batch AS (SELECT tableoid, ctid FROM ${table} WHERE ${col} IS NULL LIMIT 5000 FOR UPDATE SKIP LOCKED)`);
          phase2Operations.push(`UPDATE ${table} AS lg_target SET ${col} = ${def} FROM lg_batch WHERE lg_target.tableoid = lg_batch.tableoid AND lg_target.ctid = lg_batch.ctid;`);
          manualSteps.push({ ruleId:v.ruleId, table, column:col, kind:'backfill_verification',
            checks:['Confirm that recalculating the default for historical rows is intended.', 'Check for remaining NULLs without SKIP LOCKED before validation; investigate functions that can return NULL.', 'Review replication lag and transaction duration between batches.'],
            verificationSql:`SELECT count(*) AS remaining FROM ${table} WHERE ${col} IS NULL;` });

          if (v.isNotNull && (analysis.pgVersion ?? 17)<12) {
            manualSteps.push({ruleId:v.ruleId,table,column:col,kind:'not_null_version_review',checks:['PostgreSQL 10–11 cannot use a validated CHECK to skip the SET NOT NULL validation scan. Plan and verify constraint enforcement and lock acquisition manually after backfill.']});
          } else if (v.isNotNull) {
            phase3Statements.push(`-- Phase 3 (Deploy 2): Enforce NOT NULL after backfill is complete`);
            phase3Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${check} CHECK (${col} IS NOT NULL) NOT VALID;`);
            phase4Statements.push(`-- Phase 4 (Deploy 3): Validate constraint without blocking writes`);
            phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${check};`);
            phase4Statements.push(`ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL;`);
            phase4Statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${check};`);
          }
          break;
        }

        // 2. CREATE INDEX without CONCURRENTLY
        case 'LG-002': {
          const sql=v.raw ? rewrite.concurrentIndex(v.raw) : null;
          if(sql)phase1Statements.push(sql);
          else manualSteps.push({ruleId:v.ruleId,table,checks:['Review the original index definition; no equivalent rewrite was established.']});
          break;
        }

        // 3. Foreign Key without NOT VALID
        case 'LG-003': {
          const sql=rewrite.foreignKey(v.raw,table);
          if(sql && v.constraintName) {
            phase1Statements.push(sql);
            phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${v.constraintName};`);
          } else manualSteps.push({ruleId:v.ruleId,table,checks:['Review the exact foreign-key definition and its generated constraint name before separating validation.']});
          break;
        }

        // 4. ALTER COLUMN TYPE table rewrite
        case 'LG-004': {
          manualSteps.push({ruleId:v.ruleId,table,column:v.column,kind:'type_change_review',rewrite:v.rewrite || 'unknown',
            checks:['Verify source and target types, USING and collation.', 'Inventory indexes, defaults, constraints, views, triggers, privileges and application dependencies.',
              'Design and test dual-write, bounded backfill, cutover and recovery if a rewrite is necessary. No column swap or cleanup is generated automatically.']});
          break;
        }

        // 5. Direct UNIQUE constraint
        case 'LG-005': {
          const sql=rewrite.unique(v);
          if(sql) {phase1Statements.push(sql.create);phase3Statements.push(sql.attach);}
          else manualSteps.push({ruleId:v.ruleId,table,checks:['Review unique index options; an equivalent concurrent rewrite could not be established.']});
          break;
        }

        // 6. Direct DROP TABLE / COLUMN
        case 'LG-006': {
          manualSteps.push({ruleId:v.ruleId,table,kind:'destructive_change_review',checks:['Review the original DROP after all deployed application versions stop using the object.', 'Inventory dependencies and CASCADE effects; verify backups and recovery. No destructive SQL is generated.']});
          break;
        }

        // 9. Unsafe SET NOT NULL
        case 'LG-009': {
          const col = v.column || 'column_name';
          if((analysis.pgVersion ?? 17)<12){
            manualSteps.push({ruleId:v.ruleId,table,column:col,kind:'not_null_version_review',checks:['PostgreSQL 10–11 cannot use a validated CHECK to skip the SET NOT NULL validation scan. Verify constraint enforcement and lock acquisition on the target database; no scan-free phased rewrite is established.']});
            break;
          }
          const check = generatedName('chk', table, col, 'not_null');
          phase3Statements.push(`-- Phase 3: Add NOT NULL via NOT VALID check constraint`);
          phase3Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${check} CHECK (${col} IS NOT NULL) NOT VALID;`);
          phase4Statements.push(`-- Phase 4: Validate check constraint without blocking writes`);
          phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${check};`);
          phase4Statements.push(`ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL;`);
          phase4Statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${check};`);
          break;
        }

        // 11. Unindexed Foreign Key
        case 'LG-011': {
          const cols = (v.columns && v.columns.length > 0) ? v.columns : ['foreign_id'];
          const colList = cols.join(', ');
          const colSlug = cols.join('_').replace(/[^a-zA-Z0-9_]/g, '');
          phase1Statements.push(`-- Phase 1: Review a supporting child index to reduce scans; lock waits remain possible`);
          phase1Statements.push(`CREATE INDEX CONCURRENTLY ${generatedName('idx',table,...cols)} ON ${table} (${colList});`);
          break;
        }

        // 12. Truncate / Unconcurrent Matview
        case 'LG-012': {
          if(v.operationType==='REFRESH_MATVIEW' && !v.withNoData) {
            phase1Statements.push(`-- Verify that the view is populated and has an eligible UNIQUE index before execution.
REFRESH MATERIALIZED VIEW CONCURRENTLY ${table};`);
            manualSteps.push({ruleId:v.ruleId,table,checks:['Verify a populated view and a valid UNIQUE index on plain columns covering all rows.']});
          } else manualSteps.push({ruleId:v.ruleId,table,kind:'data_removal_review',checks:[v.withNoData?'WITH NO DATA intentionally leaves the view unpopulated and cannot be combined with CONCURRENTLY. Review dependencies.':'Review the original TRUNCATE, triggers, foreign keys, CASCADE, identity and recovery. DELETE is not an equivalent replacement.']});
          break;
        }

        default:
          manualSteps.push({ruleId:v.ruleId,table,kind:'execution_review',checks:[v.ruleId==='LG-010'?'Execute CONCURRENTLY outside an explicit or runner-created transaction, one statement per request on the same connection.':v.ruleId==='LG-008'?'Choose effective positive lock_timeout and statement_timeout before DDL. Review SET LOCAL, RESET and transaction boundaries in the complete original script.':'Review the original maintenance operation, runtime context and transaction boundaries.']});
          break;
      }
    }

    const wrapDdlPhase = (statements) => {
      return [
        "SET lock_timeout = '3s';",
        "SET statement_timeout = '30s';",
        "",
        ...statements,
        "",
        "RESET lock_timeout;",
        "RESET statement_timeout;"
      ].join('\n');
    };

    if (phase1Statements.length > 0) {
      phases.push({
        phaseNumber: 1,
        title: 'Release 1: Catalog & Index Setup',
        description: 'Review DDL locks and dependencies. Concurrent indexes must run outside a transaction block.',
        sql: wrapDdlPhase(phase1Statements)
      });
    }

    if (phase2Operations.length > 0) {
      phases.push({
        phaseNumber: 2,
        title: 'Release 2: Asynchronous Batch Data Backfill',
        description: 'Run and inspect one batch at a time; verify completion separately before continuing.',
        sql: phase2Operations.join('\n')
      });
    }

    if (phase3Statements.length > 0) {
      phases.push({
        phaseNumber: 3,
        title: 'Release 3: Schema Swaps & Constraint Attaching',
        description: 'Attach constraints using indexes or activate check constraints after data consistency is established.',
        sql: wrapDdlPhase(phase3Statements)
      });
    }

    if (phase4Statements.length > 0) {
      phases.push({
        phaseNumber: 4,
        title: 'Release 4: Validation & Final Cleanup',
        description: 'Validate constraints and review the locks needed by final catalog changes.',
        sql: wrapDdlPhase(phase4Statements)
      });
    }

    // Format for specific ORMs
    for (const phase of phases) {
      phase.requiresReview = true;
      phase.executionMode = 'one_statement_per_request_same_connection';
      phase.mustRunOutsideTransaction = /\bCONCURRENTLY\b/.test(phase.sql);
      phase.dependsOn = phases.filter(p => p.phaseNumber < phase.phaseNumber).map(p => p.phaseNumber);
      phase.preconditions = phase.phaseNumber > 2
        ? ['Confirm backfill completion, data consistency and application compatibility before continuing.']
        : ['Review the SQL and dependencies; test against an isolated representative database.'];
    }
    let ormSnippets = null;
    if (targetOrm === 'prisma') {
      ormSnippets = this.formatPrisma(phases);
    } else if (targetOrm === 'drizzle') {
      ormSnippets = this.formatDrizzle(phases);
    } else if (targetOrm === 'django') {
      ormSnippets = this.formatDjango(phases);
    } else if (targetOrm === 'alembic') {
      ormSnippets = this.formatAlembic(phases);
    }

    return {
      isSafe: false,
      requiresReview: true,
      manualSteps,
      originalSql: analysis.originalSql,
      warning: 'Draft plan. Compare with originalSql: unflagged operations are not copied into phases. Verify types, constraints, backfill and transaction boundaries before execution.',
      targetOrm,
      totalPhases: phases.length,
      phases,
      ormSnippets
    };
  }

  /**
   * Writes multi-phase migration files to disk.
   * @param {object} plan Generated plan from generatePlan()
   * @param {string} targetFile Source migration file path
   * @param {string} [outDir] Destination directory
   * @returns {Array<{ phase: number, path: string, content: string }>}
   */
  static writePhasesToDisk(plan, targetFile, outDir = null) {
    const fs = require('fs');
    const path = require('path');

    const baseName = path.basename(targetFile, path.extname(targetFile));
    const targetDir = outDir
      ? path.resolve(process.cwd(), outDir)
      : path.dirname(path.resolve(process.cwd(), targetFile));

    fs.mkdirSync(targetDir, { recursive: true });

    const writtenFiles = [];
    const phaseSlugs = {
      1: 'phase1_pre_deploy',
      2: 'phase2_backfill',
      3: 'phase3_enforce',
      4: 'phase4_cleanup'
    };

    const targetOrm = plan.targetOrm || 'sql';

    for (const p of plan.phases) {
      let filePath;
      let content;

      if (targetOrm === 'prisma') {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const phaseDir = path.join(targetDir, `${timestamp}_phase_${p.phaseNumber}`);
        fs.mkdirSync(phaseDir, { recursive: true });
        filePath = path.join(phaseDir, 'migration.sql');
        content = p.sql;
      } else if (targetOrm === 'django' || targetOrm === 'alembic') {
        const snippet = plan.ormSnippets && plan.ormSnippets.find(s => s.phaseNumber === p.phaseNumber);
        filePath = path.join(targetDir, `${baseName}_phase${p.phaseNumber}.py`);
        content = snippet ? snippet.code : p.sql;
      } else {
        // sql or drizzle
        const slug = phaseSlugs[p.phaseNumber] || `phase${p.phaseNumber}`;
        filePath = path.join(targetDir, `${baseName}_${slug}.sql`);
        content = p.sql;
      }

      content = (targetOrm === 'django' || targetOrm === 'alembic' ? '# DRAFT: manual review required\n' : '-- DRAFT: manual review required; compare against original migration\n') + content;
      fs.writeFileSync(filePath, content + '\n', { encoding: 'utf8', flag: 'wx' });
      writtenFiles.push({
        phase: p.phaseNumber,
        path: filePath,
        content: content + '\n'
      });
    }

    if(plan.manualSteps?.length) {
      const filePath=path.join(targetDir,baseName+'_manual_review.md');
      const content='# Manual review required\n\n'+plan.manualSteps.map(step=>'## '+step.ruleId+' '+step.table+'\n\n'+step.checks.map(check=>'- '+check).join('\n')+'\n').join('\n');
      fs.writeFileSync(filePath,content,{encoding:'utf8',flag:'wx'});
      writtenFiles.push({phase:'manual',path:filePath,content});
    }
    return writtenFiles;
  }

  static formatPrisma(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: 'Review migration ordering. Execute concurrent DDL one statement per request on the same connection without a transaction wrapper; verify the Prisma runner behavior before deployment.',
      code: p.sql
    }));
  }

  static formatDrizzle(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: 'Integrate into your migration chain after review. Concurrent DDL requires a non-transactional runner and one statement per request on the same connection.',
      code: p.sql
    }));
  }

  static formatDjango(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `# Django Migration Phase ${p.phaseNumber} (migrations.RunSQL)`,
      code: '# Review dependencies and add this class to your migration chain. No reverse operation is inferred.\nfrom django.db import migrations\n\nclass Migration(migrations.Migration):\n    atomic = '+(p.mustRunOutsideTransaction?'False':'True')+'\n    dependencies = []\n    operations = [\n'+PgParser.parse(p.sql).map(stmt=>'        migrations.RunSQL('+JSON.stringify(stmt.raw+';')+'),').join('\n')+'\n    ]'
    }));
  }

  static formatAlembic(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `# Alembic / SQLAlchemy Phase ${p.phaseNumber} (op.execute)`,
      code: '# Integrate into the reviewed Alembic revision chain. Autocommit commits any previous transaction.\nfrom alembic import op\n\ndef upgrade():\n'+(p.mustRunOutsideTransaction?'    with op.get_context().autocommit_block():\n':'')+PgParser.parse(p.sql).map(stmt=>(p.mustRunOutsideTransaction?'        ':'    ')+'op.execute('+JSON.stringify(stmt.raw+';')+')').join('\n')+'\n\ndef downgrade():\n    raise NotImplementedError("No automatic reversal; follow the reviewed recovery plan.")'
    }));
  }
}

module.exports = AutoSplitter;
