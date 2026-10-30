/**
 * LockGuard Auto-Splitter
 * Deconstructs fatal monolithic migrations into safe, zero-downtime multi-phase releases.
 * Supports targets: Raw SQL, Prisma, Drizzle, Alembic, and Django.
 */

class AutoSplitter {
  /**
   * Generates a multi-step release plan for a migration AST / violations.
   * @param {object} analysis Analysis result from RuleEngine
   * @param {string} targetOrm 'sql' | 'prisma' | 'drizzle' | 'alembic' | 'django'
   */
  static generatePlan(analysis, targetOrm = 'sql') {
    const phases = [];
    const violations = analysis.violations || [];

    if (violations.length === 0) {
      return {
        isSafe: true,
        message: 'Migration is already zero-downtime safe. No splitting needed.',
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
          const col = v.column || 'new_column';
          const def = v.defaultValue || 'now()';
          phase1Statements.push(`-- Phase 1 (Deploy 1): Add column as nullable without default`);
          phase1Statements.push(`ALTER TABLE ${table} ADD COLUMN ${col} TIMESTAMP;`);
          phase1Statements.push(`ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${def};`);

          phase2Operations.push(`-- Phase 2 (Async Background Worker): Backfill historical rows in small batches`);
          phase2Operations.push(`-- Execute in chunks of 5000 rows to prevent table lock saturation:`);
          phase2Operations.push(`UPDATE ${table} SET ${col} = ${def} WHERE ${col} IS NULL;`);

          phase3Statements.push(`-- Phase 3 (Deploy 2): Enforce NOT NULL after backfill is complete`);
          phase3Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_${col}_not_null CHECK (${col} IS NOT NULL) NOT VALID;`);
          
          phase4Statements.push(`-- Phase 4 (Deploy 3): Validate constraint without blocking writes`);
          phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT chk_${table}_${col}_not_null;`);
          break;
        }

        // 2. CREATE INDEX without CONCURRENTLY
        case 'LG-002': {
          const idxName = v.indexName || `idx_${table}_col`;
          const cols = (v.columns && v.columns.length > 0) ? v.columns.join(', ') : 'column_name';
          phase1Statements.push(`-- Phase 1: Build index concurrently (must run outside multi-statement transaction)`);
          phase1Statements.push(`CREATE INDEX CONCURRENTLY ${idxName} ON ${table} (${cols});`);
          break;
        }

        // 3. Foreign Key without NOT VALID
        case 'LG-003': {
          const constraint = v.constraintName || `fk_${table}_ref`;
          const foreignTable = v.foreignTable || 'referenced_table';
          const cols = (v.columns && v.columns.length > 0) ? v.columns : ['foreign_id'];
          const colList = cols.join(', ');
          const colSlug = cols.join('_').replace(/[^a-zA-Z0-9_]/g, '');

          phase1Statements.push(`-- Phase 1: Create supporting index concurrently to prevent cascade locks`);
          phase1Statements.push(`CREATE INDEX CONCURRENTLY idx_${table}_${colSlug} ON ${table} (${colList});`);
          phase1Statements.push(`-- Phase 1 (Deploy 1): Attach FK with NOT VALID (instant catalog lock)`);
          phase1Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${colList}) REFERENCES ${foreignTable}(id) NOT VALID;`);

          phase4Statements.push(`-- Phase 4 (Deploy 2): Validate existing rows (weak lock SHARE UPDATE EXCLUSIVE)`);
          phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`);
          break;
        }

        // 4. ALTER COLUMN TYPE table rewrite
        case 'LG-004': {
          const col = v.column || 'column_name';
          const newType = v.newType || 'BIGINT';

          phase1Statements.push(`-- Phase 1 (Deploy 1): Add shadow column & Dual-Write Trigger`);
          phase1Statements.push(`ALTER TABLE ${table} ADD COLUMN ${col}_new ${newType};`);
          phase1Statements.push(`CREATE OR REPLACE FUNCTION trg_sync_${table}_${col}() RETURNS TRIGGER AS $$`);
          phase1Statements.push(`BEGIN`);
          phase1Statements.push(`  NEW.${col}_new = NEW.${col}::${newType};`);
          phase1Statements.push(`  RETURN NEW;`);
          phase1Statements.push(`END;`);
          phase1Statements.push(`$$ LANGUAGE plpgsql;`);
          phase1Statements.push(`CREATE TRIGGER trg_${table}_${col}_dual_write`);
          phase1Statements.push(`  BEFORE INSERT OR UPDATE ON ${table}`);
          phase1Statements.push(`  FOR EACH ROW EXECUTE FUNCTION trg_sync_${table}_${col}();`);

          phase2Operations.push(`-- Phase 2 (Async Worker): Backfill historical rows in chunks of 5000`);
          phase2Operations.push(`UPDATE ${table} SET ${col}_new = ${col}::${newType} WHERE ${col}_new IS NULL;`);

          phase3Statements.push(`-- Phase 3 (Deploy 2): Remove trigger and swap columns`);
          phase3Statements.push(`DROP TRIGGER IF EXISTS trg_${table}_${col}_dual_write ON ${table};`);
          phase3Statements.push(`DROP FUNCTION IF EXISTS trg_sync_${table}_${col}();`);
          phase3Statements.push(`ALTER TABLE ${table} RENAME COLUMN ${col} TO ${col}_deprecated;`);
          phase3Statements.push(`ALTER TABLE ${table} RENAME COLUMN ${col}_new TO ${col};`);

          phase4Statements.push(`-- Phase 4 (Cleanup): Drop deprecated column safely`);
          phase4Statements.push(`-- lockguard-ignore: LG-006`);
          phase4Statements.push(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col}_deprecated;`);
          break;
        }

        // 5. Direct UNIQUE constraint
        case 'LG-005': {
          const constraint = v.constraintName || `uq_${table}_key`;
          const indexName = `${constraint}_idx`;
          const cols = (v.columns && v.columns.length > 0) ? v.columns.join(', ') : 'key_col';

          phase1Statements.push(`-- Phase 1 (Deploy 1): Create unique index concurrently without blocking writes`);
          phase1Statements.push(`CREATE UNIQUE INDEX CONCURRENTLY ${indexName} ON ${table} (${cols});`);

          phase3Statements.push(`-- Phase 3 (Deploy 2): Attach constraint to pre-built index (instant operation)`);
          phase3Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} UNIQUE USING INDEX ${indexName};`);
          break;
        }

        // 6. Direct DROP TABLE / COLUMN
        case 'LG-006': {
          const col = v.column || 'col_to_drop';
          phase1Statements.push(`-- Phase 1 (Deploy 1): Remove column from ORM schema / mark as @ignore`);
          phase3Statements.push(`-- Phase 3 (Deploy 2 / Maintenance Window): Drop physically`);
          phase3Statements.push(`-- lockguard-ignore: LG-006`);
          phase3Statements.push(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col};`);
          break;
        }

        // 9. Unsafe SET NOT NULL
        case 'LG-009': {
          const col = v.column || 'column_name';
          phase3Statements.push(`-- Phase 3: Add NOT NULL via NOT VALID check constraint`);
          phase3Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_${col}_not_null CHECK (${col} IS NOT NULL) NOT VALID;`);
          phase4Statements.push(`-- Phase 4: Validate check constraint without blocking writes`);
          phase4Statements.push(`ALTER TABLE ${table} VALIDATE CONSTRAINT chk_${table}_${col}_not_null;`);
          break;
        }

        // 11. Unindexed Foreign Key
        case 'LG-011': {
          const cols = (v.columns && v.columns.length > 0) ? v.columns : ['foreign_id'];
          const colList = cols.join(', ');
          const colSlug = cols.join('_').replace(/[^a-zA-Z0-9_]/g, '');
          phase1Statements.push(`-- Phase 1: Create supporting index concurrently to prevent child table locks`);
          phase1Statements.push(`CREATE INDEX CONCURRENTLY idx_${table}_${colSlug} ON ${table} (${colList});`);
          break;
        }

        // 12. Truncate / Unconcurrent Matview
        case 'LG-012': {
          if (v.matview) {
            phase1Statements.push(`-- Phase 1: Concurrent Materialized View Refresh (requires unique index)`);
            phase1Statements.push(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v.matview};`);
          } else {
            phase2Operations.push(`-- Phase 2 (Async Batch): Purge data in small batches to avoid ACCESS EXCLUSIVE lock:`);
            phase2Operations.push(`DELETE FROM ${table} WHERE ctid = ANY (ARRAY(SELECT ctid FROM ${table} LIMIT 10000));`);
          }
          break;
        }

        default:
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
        "RESET lock_timeout;"
      ].join('\n');
    };

    if (phase1Statements.length > 0) {
      phases.push({
        phaseNumber: 1,
        title: 'Release 1: Non-Blocking Catalog & Index Setup',
        description: 'Safe catalog operations taking <1ms ACCESS EXCLUSIVE or background concurrent indexes.',
        sql: wrapDdlPhase(phase1Statements)
      });
    }

    if (phase2Operations.length > 0) {
      phases.push({
        phaseNumber: 2,
        title: 'Release 2: Asynchronous Batch Data Backfill',
        description: 'Run via background job, cron, or script in batches of 5000 rows to prevent table freeze.',
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
        title: 'Release 4: Non-Blocking Validation & Final Cleanup',
        description: 'Validate constraints under weak SHARE UPDATE EXCLUSIVE locks and drop deprecated shadow columns.',
        sql: wrapDdlPhase(phase4Statements)
      });
    }

    // Format for specific ORMs
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

      fs.writeFileSync(filePath, content + '\n', 'utf8');
      writtenFiles.push({
        phase: p.phaseNumber,
        path: filePath,
        content: content + '\n'
      });
    }

    return writtenFiles;
  }

  static formatPrisma(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `Run via: npx prisma db execute --stdin\nOr place in prisma/migrations/phase_${p.phaseNumber}/migration.sql`,
      code: p.sql
    }));
  }

  static formatDrizzle(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `Place in drizzle/000${p.phaseNumber}_phase.sql`,
      code: p.sql
    }));
  }

  static formatDjango(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `# Django Migration Phase ${p.phaseNumber} (migrations.RunSQL)`,
      code: `# Generated by LockGuard Auto-Splitter for Django (Safe Phase ${p.phaseNumber})\nfrom django.db import migrations\n\nclass Migration(migrations.Migration):\n    dependencies = []\n    operations = [\n        migrations.RunSQL(\n            sql="""${p.sql.replace(/"""/g, '\\"\\"\\"')}""",\n            reverse_sql=""\n        ),\n    ]`
    }));
  }

  static formatAlembic(phases) {
    return phases.map(p => ({
      phaseNumber: p.phaseNumber,
      title: p.title,
      instruction: `# Alembic / SQLAlchemy Phase ${p.phaseNumber} (op.execute)`,
      code: `"""Zero-downtime migration phase ${p.phaseNumber}"""\nfrom alembic import op\nimport sqlalchemy as sa\n\ndef upgrade():\n    op.execute("""${p.sql.replace(/"""/g, '\\"\\"\\"')}""")\n\ndef downgrade():\n    pass`
    }));
  }
}

module.exports = AutoSplitter;
