/**
 * LockGuard Auto-Splitter
 * Deconstructs fatal monolithic migrations into safe, zero-downtime multi-phase releases.
 * Supports targets: Raw SQL, Prisma, Drizzle, and Alembic.
 */

class AutoSplitter {
  /**
   * Generates a multi-step release plan for a migration AST / violations.
   * @param {object} analysis Analysis result from RuleEngine
   * @param {string} targetOrm 'sql' | 'prisma' | 'drizzle' | 'alembic'
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

    phase1Statements.push("SET lock_timeout = '3s';");
    phase1Statements.push("SET statement_timeout = '30s';");

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
          const cols = (v.columns && v.columns.length > 0) ? v.columns.join(', ') : 'foreign_id';

          phase1Statements.push(`-- Phase 1 (Deploy 1): Attach FK with NOT VALID (instant catalog lock)`);
          phase1Statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${cols}) REFERENCES ${foreignTable}(id) NOT VALID;`);

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

          phase4Statements.push(`-- Phase 4 (Cleanup): Drop deprecated column`);
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
          phase3Statements.push(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col};`);
          break;
        }

        default:
          break;
      }
    }

    if (phase1Statements.length > 2) {
      phases.push({
        phaseNumber: 1,
        title: 'Release 1: Non-Blocking Catalog & Index Setup',
        description: 'Safe catalog operations taking <1ms ACCESS EXCLUSIVE or background concurrent indexes.',
        sql: phase1Statements.join('\n')
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
        sql: phase3Statements.join('\n')
      });
    }

    if (phase4Statements.length > 0) {
      phases.push({
        phaseNumber: 4,
        title: 'Release 4: Non-Blocking Validation & Final Cleanup',
        description: 'Validate constraints under weak SHARE UPDATE EXCLUSIVE locks and drop deprecated shadow columns.',
        sql: phase4Statements.join('\n')
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
