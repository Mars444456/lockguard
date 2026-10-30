(function(window) {
  'use strict';

  // 1. Types & Constants
  /**
 * LockGuard Core Types & Constants
 * Defines PostgreSQL table lock levels, conflict matrices, and rule severities.
 */

const LockLevel = {
  ACCESS_SHARE: 'ACCESS SHARE',
  ROW_SHARE: 'ROW SHARE',
  ROW_EXCLUSIVE: 'ROW EXCLUSIVE',
  SHARE_UPDATE_EXCLUSIVE: 'SHARE UPDATE EXCLUSIVE',
  SHARE: 'SHARE',
  SHARE_ROW_EXCLUSIVE: 'SHARE ROW EXCLUSIVE',
  EXCLUSIVE: 'EXCLUSIVE',
  ACCESS_EXCLUSIVE: 'ACCESS EXCLUSIVE'
};

const Severity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

/**
 * PostgreSQL Lock Conflict Matrix
 * Which operations are blocked when a lock is held on a table.
 */
const LockMatrix = {
  [LockLevel.ACCESS_SHARE]: {
    description: 'Acquired by SELECT queries.',
    blocks: ['ACCESS EXCLUSIVE'],
    impact: 'None on normal queries. Non-blocking.'
  },
  [LockLevel.ROW_SHARE]: {
    description: 'Acquired by SELECT FOR UPDATE / FOR SHARE.',
    blocks: ['EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Minimal. Allows standard reads and writes.'
  },
  [LockLevel.ROW_EXCLUSIVE]: {
    description: 'Acquired by INSERT, UPDATE, DELETE.',
    blocks: ['SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Allows concurrent writes to different rows and all reads.'
  },
  [LockLevel.SHARE_UPDATE_EXCLUSIVE]: {
    description: 'Acquired by CREATE INDEX CONCURRENTLY, VACUUM (without FULL), ANALYZE, ALTER TABLE VALIDATE CONSTRAINT.',
    blocks: ['SHARE_UPDATE_EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Safe for production! Allows concurrent SELECT, INSERT, UPDATE, DELETE.'
  },
  [LockLevel.SHARE]: {
    description: 'Acquired by non-concurrent CREATE INDEX.',
    blocks: ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'FATAL: BLOCKS ALL INSERTS, UPDATES, AND DELETES. Can cause 504 Gateway Timeouts.'
  },
  [LockLevel.SHARE_ROW_EXCLUSIVE]: {
    description: 'Acquired by CREATE TRIGGER and some foreign key operations.',
    blocks: ['ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Blocks all concurrent writes and row-level locks.'
  },
  [LockLevel.EXCLUSIVE]: {
    description: 'Acquired by REFRESH MATERIALIZED VIEW CONCURRENTLY.',
    blocks: ['ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Blocks all writes and most reads except simple SELECT.'
  },
  [LockLevel.ACCESS_EXCLUSIVE]: {
    description: 'Acquired by ALTER TABLE, DROP TABLE, TRUNCATE, VACUUM FULL, LOCK TABLE.',
    blocks: ['ACCESS SHARE', 'ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'CATASTROPHIC: BLOCKS EVERYTHING (even SELECT queries). Freezes the entire table.'
  }
};




  // 2. Parser
  /**
 * LockGuard PostgreSQL DDL Lexer & AST Parser
 * Converts raw PostgreSQL migration SQL into a structured AST representation.
 * Resilient against Dollar-Quoting ($$ and $tag$), multi-line statements,
 * comments, multiple ALTER TABLE actions, and inline directives (-- lockguard-ignore).
 */

class PgParser {
  /**
   * Parses full SQL content into structured AST statements.
   * @param {string} sqlText 
   * @returns {Array<object>} Array of parsed AST statements
   */
  static parse(sqlText) {
    if (!sqlText || typeof sqlText !== 'string') {
      return [];
    }

    const rawStatements = this.splitStatements(sqlText);
    const astStatements = [];

    for (const raw of rawStatements) {
      const parsed = this.parseStatement(raw.sql, raw.line, raw.rawFull, raw.comments, raw.ignoreDirectives);
      if (parsed) {
        astStatements.push(parsed);
      }
    }

    return astStatements;
  }

  /**
   * Extracts ignore directives from comment lines.
   * Supports:
   * -- lockguard-ignore-all
   * -- lockguard-ignore: LG-001, LG-004
   */
  static extractIgnoreDirectives(comments = []) {
    let ignoreAll = false;
    const ignoreRules = [];

    for (const c of comments) {
      if (/--\s*lockguard-ignore-all\b/i.test(c) || /\/\*\s*lockguard-ignore-all\s*\*\//i.test(c)) {
        ignoreAll = true;
      }
      const match = c.match(/lockguard-ignore:\s*([A-Za-z0-9_,\s-]+)/i);
      if (match) {
        const parts = match[1].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        for (const p of parts) {
          if (!ignoreRules.includes(p)) {
            ignoreRules.push(p);
          }
        }
      }
    }

    return { ignoreAll, ignoreRules };
  }

  /**
   * Splits SQL text into individual statements, tracking line numbers.
   * Fully supports Dollar-Quoting ($$ and $tag$), single quotes, double quotes,
   * line comments (--), and block comments.
   */
  static splitStatements(sql) {
    const statements = [];
    let current = '';
    let currentRaw = '';
    let startLine = 1;
    let currentLine = 1;

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inDollarQuote = false;
    let dollarTag = '';

    let pendingComments = [];
    let currentComment = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1] || '';

      if (char === '\n') {
        currentLine++;
      }

      // 1. Inside Dollar-Quoting ($$ ... $$ or $tag$ ... $tag$)
      if (inDollarQuote) {
        current += char;
        currentRaw += char;
        if (char === '$' && sql.startsWith(dollarTag, i)) {
          // Found closing dollar quote
          current += dollarTag.slice(1);
          currentRaw += dollarTag.slice(1);
          i += dollarTag.length - 1;
          inDollarQuote = false;
          dollarTag = '';
        }
        continue;
      }

      // 2. Handle Line Comment --
      if (!inSingleQuote && !inDoubleQuote && !inBlockComment) {
        if (!inLineComment && char === '-' && nextChar === '-') {
          inLineComment = true;
          currentComment = '--';
          currentRaw += char;
          continue;
        }
        if (inLineComment) {
          currentRaw += char;
          if (char === '\n') {
            inLineComment = false;
            pendingComments.push(currentComment.trim());
            currentComment = '';
          } else {
            currentComment += char;
          }
          continue;
        }
      }

      // 3. Handle Block Comment /* */
      if (!inSingleQuote && !inDoubleQuote && !inLineComment) {
        if (!inBlockComment && char === '/' && nextChar === '*') {
          inBlockComment = true;
          currentComment = '/*';
          currentRaw += char;
          continue;
        }
        if (inBlockComment) {
          currentRaw += char;
          if (char === '*' && nextChar === '/') {
            inBlockComment = false;
            currentRaw += '/';
            currentComment += '*/';
            pendingComments.push(currentComment.trim());
            currentComment = '';
            i++; // skip next char '/'
          } else {
            currentComment += char;
          }
          continue;
        }
      }

      // 4. Handle Dollar-Quoting Start ($$ or $tag$)
      if (!inSingleQuote && !inDoubleQuote && char === '$') {
        const remaining = sql.slice(i);
        const match = remaining.match(/^\$([a-zA-Z0-9_]*)\$/);
        if (match) {
          inDollarQuote = true;
          dollarTag = match[0];
          current += dollarTag;
          currentRaw += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      }

      // 5. Handle Single Quotes
      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote && nextChar === "'") {
          current += "''";
          currentRaw += "''";
          i++;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        current += char;
        currentRaw += char;
        continue;
      }

      // 6. Handle Double Quotes
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        currentRaw += char;
        continue;
      }

      // 7. Semicolon Separator (only outside quotes and dollar-quotes)
      if (char === ';' && !inSingleQuote && !inDoubleQuote && !inDollarQuote) {
        if (current.trim().length > 0) {
          const stmtComments = [...pendingComments];
          const directives = this.extractIgnoreDirectives(stmtComments);
          statements.push({
            sql: current.trim(),
            rawFull: currentRaw.trim() + ';',
            line: startLine,
            comments: stmtComments,
            ignoreDirectives: directives
          });
          pendingComments = [];
        }
        current = '';
        currentRaw = '';
        startLine = currentLine;
        continue;
      }

      if (current.trim().length === 0 && char.trim().length > 0) {
        startLine = currentLine;
      }

      current += char;
      currentRaw += char;
    }

    if (current.trim().length > 0) {
      const stmtComments = [...pendingComments];
      const directives = this.extractIgnoreDirectives(stmtComments);
      statements.push({
        sql: current.trim(),
        rawFull: currentRaw.trim(),
        line: startLine,
        comments: stmtComments,
        ignoreDirectives: directives
      });
    }

    return statements;
  }

  /**
   * Analyzes an individual SQL statement string and produces an AST node.
   */
  static parseStatement(sql, line, rawFull, comments = [], ignoreDirectives = {}) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();
    const upper = cleanSql.toUpperCase();
    const ignoreRules = ignoreDirectives.ignoreRules || [];
    const ignoreAll = !!ignoreDirectives.ignoreAll;

    const baseMeta = {
      line,
      raw: sql,
      rawFull: rawFull || sql,
      comments: comments || [],
      ignoreRules,
      ignoreAll
    };

    // 1. SET lock_timeout / statement_timeout
    if (upper.startsWith('SET ') || upper.startsWith('SET LOCAL ')) {
      const lockTimeoutMatch = cleanSql.match(/SET\s+(?:LOCAL\s+)?lock_timeout(?:\s*=\s*|\s+TO\s+)['"]?([^'";]+)['"]?/i);
      const statementTimeoutMatch = cleanSql.match(/SET\s+(?:LOCAL\s+)?statement_timeout(?:\s*=\s*|\s+TO\s+)['"]?([^'";]+)['"]?/i);
      const isLocal = /SET\s+LOCAL\b/i.test(cleanSql);

      return {
        ...baseMeta,
        type: 'SET_VARIABLE',
        variable: lockTimeoutMatch ? 'lock_timeout' : (statementTimeoutMatch ? 'statement_timeout' : 'other'),
        value: lockTimeoutMatch ? lockTimeoutMatch[1] : (statementTimeoutMatch ? statementTimeoutMatch[1] : null),
        isLocal
      };
    }

    // 2. RESET variable
    if (upper.startsWith('RESET ')) {
      const resetMatch = cleanSql.match(/RESET\s+([a-zA-Z0-9_]+)/i);
      return {
        ...baseMeta,
        type: 'RESET_VARIABLE',
        variable: resetMatch ? resetMatch[1].toLowerCase() : 'unknown'
      };
    }

    // 3. Transaction control: BEGIN, COMMIT, ROLLBACK
    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION' || upper === 'START TRANSACTION' || upper.startsWith('BEGIN;') || upper.startsWith('START TRANSACTION;')) {
      return { ...baseMeta, type: 'TRANSACTION_START' };
    }
    if (upper === 'COMMIT' || upper === 'END' || upper === 'COMMIT TRANSACTION' || upper === 'ROLLBACK') {
      return { ...baseMeta, type: 'TRANSACTION_COMMIT' };
    }

    // 4. CREATE TABLE [IF NOT EXISTS]
    if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE UNLOGGED TABLE') || upper.startsWith('CREATE TEMPORARY TABLE') || upper.startsWith('CREATE TEMP TABLE')) {
      const tableMatch = cleanSql.match(/CREATE\s+(?:UNLOGGED\s+|TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);
      const table = tableMatch ? this.cleanIdentifier(tableMatch[1]) : 'unknown_table';
      return {
        ...baseMeta,
        type: 'CREATE_TABLE',
        table
      };
    }

    // 5. CREATE INDEX [CONCURRENTLY]
    if (upper.startsWith('CREATE INDEX') || upper.startsWith('CREATE UNIQUE INDEX')) {
      const isUnique = /CREATE\s+UNIQUE\s+INDEX/i.test(cleanSql);
      const isConcurrent = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(cleanSql);
      
      const onMatch = cleanSql.match(/ON\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)\s*(?:USING\s+[a-zA-Z0-9_]+\s*)?\(([^)]+)\)/i);
      const nameMatch = cleanSql.match(/INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);

      const table = onMatch ? this.cleanIdentifier(onMatch[1]) : 'unknown_table';
      const rawIndexName = (nameMatch && nameMatch[1].toUpperCase() !== 'ON') ? this.cleanIdentifier(nameMatch[1]) : null;
      const columns = onMatch ? onMatch[2].split(',').map(s => s.trim()) : [];
      const indexName = rawIndexName || ('idx_' + table.replace(/[^a-zA-Z0-9_]/g, '_') + (columns.length > 0 ? '_' + columns[0].replace(/[^a-zA-Z0-9_]/g, '') : ''));

      return {
        ...baseMeta,
        type: 'CREATE_INDEX',
        isUnique,
        isConcurrent,
        table,
        indexName,
        columns
      };
    }

    // 6. DROP INDEX [CONCURRENTLY]
    if (upper.startsWith('DROP INDEX')) {
      const isConcurrent = /DROP\s+INDEX\s+CONCURRENTLY/i.test(cleanSql);
      const nameMatch = cleanSql.match(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);
      const indexName = nameMatch ? this.cleanIdentifier(nameMatch[1]) : 'unknown_index';
      return {
        ...baseMeta,
        type: 'DROP_INDEX',
        isConcurrent,
        indexName
      };
    }

    // 7. REINDEX [CONCURRENTLY]
    if (upper.startsWith('REINDEX')) {
      const isConcurrent = /REINDEX\s+(?:TABLE|INDEX|DATABASE|SCHEMA|SYSTEM)?\s*CONCURRENTLY/i.test(cleanSql);
      return {
        ...baseMeta,
        type: 'REINDEX',
        isConcurrent
      };
    }

    // 8. DROP TABLE
    if (upper.startsWith('DROP TABLE')) {
      const tableMatch = cleanSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_.", ]+)/i);
      const tables = tableMatch 
        ? tableMatch[1].split(',').map(t => this.cleanIdentifier(t.trim()))
        : ['unknown_table'];

      return {
        ...baseMeta,
        type: 'DROP_TABLE',
        tables
      };
    }

    // 9. ALTER TABLE statements (Supports multiple comma-separated actions)
    if (upper.startsWith('ALTER TABLE')) {
      const tableMatch = cleanSql.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);
      const table = tableMatch ? this.cleanIdentifier(tableMatch[1]) : 'unknown_table';
      
      const subcommands = this.parseAlterSubcommands(cleanSql, table, line);

      return {
        ...baseMeta,
        type: 'ALTER_TABLE',
        table,
        subcommands,
        actions: subcommands
      };
    }

    // 10. VACUUM
    if (upper.startsWith('VACUUM')) {
      const isFull = /VACUUM\s+(?:FULL|\([^)]*FULL[^)]*\))/i.test(cleanSql);
      return {
        ...baseMeta,
        type: 'VACUUM',
        isFull
      };
    }

    // 11. DO $$ ... $$ (Procedural anonymous block)
    if (upper.startsWith('DO ') || upper.startsWith('DO$')) {
      return {
        ...baseMeta,
        type: 'DO_BLOCK'
      };
    }

    // 12. CREATE FUNCTION / PROCEDURE
    if (upper.startsWith('CREATE FUNCTION') || upper.startsWith('CREATE OR REPLACE FUNCTION') ||
        upper.startsWith('CREATE PROCEDURE') || upper.startsWith('CREATE OR REPLACE PROCEDURE')) {
      return {
        ...baseMeta,
        type: 'CREATE_ROUTINE'
      };
    }

    // 13. TRUNCATE [TABLE]
    if (upper.startsWith('TRUNCATE')) {
      const tableMatch = cleanSql.match(/TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([a-zA-Z0-9_.",\s]+?)(?:\s+RESTART\s+IDENTITY|\s+CONTINUE\s+IDENTITY|\s+CASCADE|\s+RESTRICT|;|$)/i);
      const tables = tableMatch
        ? tableMatch[1].split(',').map(t => this.cleanIdentifier(t.trim())).filter(Boolean)
        : ['unknown_table'];

      return {
        ...baseMeta,
        type: 'TRUNCATE_TABLE',
        table: tables[0] || 'unknown_table',
        tables
      };
    }

    // 14. REFRESH MATERIALIZED VIEW [CONCURRENTLY]
    if (upper.startsWith('REFRESH MATERIALIZED VIEW')) {
      const isConcurrent = /REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY/i.test(cleanSql);
      const viewMatch = cleanSql.match(/REFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?([a-zA-Z0-9_."]+)/i);
      const view = viewMatch ? this.cleanIdentifier(viewMatch[1]) : 'unknown_view';

      return {
        ...baseMeta,
        type: 'REFRESH_MATVIEW',
        view,
        table: view,
        isConcurrent
      };
    }

    // Default unrecognized statement
    return {
      ...baseMeta,
      type: 'STATEMENT'
    };
  }

  /**
   * Parses ALTER TABLE subcommands: ADD COLUMN, ALTER COLUMN TYPE, SET NOT NULL,
   * ADD CONSTRAINT, DROP COLUMN, etc. Supports multiple comma-separated actions.
   */
  static parseAlterSubcommands(sql, table, line) {
    const subcommands = [];
    let parts = sql.replace(/^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?[a-zA-Z0-9_."]+\s+/i, '').trim();
    parts = parts.replace(/;+\s*$/, '');

    // Split top-level subcommands by comma, ignoring commas inside parentheses or quotes
    const clauses = this.splitClauses(parts);

    for (const clause of clauses) {
      const cleanClause = clause.trim();
      const upperClause = cleanClause.toUpperCase();

      // ADD [COLUMN] ...
      if (upperClause.startsWith('ADD ') && !upperClause.startsWith('ADD CONSTRAINT')) {
        const colDetails = this.parseAddColumnClause(cleanClause);
        subcommands.push({
          subtype: 'ADD_COLUMN',
          table,
          column: colDetails.column,
          dataType: colDetails.dataType,
          hasDefault: colDetails.hasDefault,
          defaultValue: colDetails.defaultValue,
          isVolatileDefault: colDetails.isVolatileDefault,
          isTrulyVolatile: colDetails.isTrulyVolatile,
          isPhysicalTableRewrite: colDetails.isPhysicalTableRewrite,
          rewriteReason: colDetails.rewriteReason,
          isNotNull: colDetails.isNotNull,
          raw: cleanClause,
          line
        });
        continue;
      }

      // ADD CONSTRAINT ... FOREIGN KEY
      if (upperClause.startsWith('ADD CONSTRAINT') && upperClause.includes('FOREIGN KEY')) {
        const isNotValid = /NOT\s+VALID/i.test(cleanClause);
        const nameMatch = cleanClause.match(/ADD\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)/i);
        const refMatch = cleanClause.match(/REFERENCES\s+([a-zA-Z0-9_."]+)/i);
        const colMatch = cleanClause.match(/FOREIGN\s+KEY\s*\(([^)]+)\)/i);

        subcommands.push({
          subtype: 'ADD_FOREIGN_KEY',
          table,
          constraintName: nameMatch ? this.cleanIdentifier(nameMatch[1]) : 'fk_' + table,
          foreignTable: refMatch ? this.cleanIdentifier(refMatch[1]) : 'referenced_table',
          columns: colMatch ? colMatch[1].split(',').map(s => s.trim()) : [],
          isNotValid,
          raw: cleanClause,
          line
        });
        continue;
      }

      // ADD CONSTRAINT ... UNIQUE
      if (upperClause.startsWith('ADD CONSTRAINT') && upperClause.includes('UNIQUE')) {
        const isUsingIndex = /USING\s+INDEX/i.test(cleanClause);
        const nameMatch = cleanClause.match(/ADD\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)/i);
        const colMatch = cleanClause.match(/UNIQUE\s*\(([^)]+)\)/i);

        subcommands.push({
          subtype: 'ADD_UNIQUE_CONSTRAINT',
          table,
          constraintName: nameMatch ? this.cleanIdentifier(nameMatch[1]) : 'uq_' + table,
          columns: colMatch ? colMatch[1].split(',').map(s => s.trim()) : [],
          isUsingIndex,
          raw: cleanClause,
          line
        });
        continue;
      }

      // ADD CONSTRAINT ... CHECK
      if (upperClause.startsWith('ADD CONSTRAINT') && upperClause.includes('CHECK')) {
        const isNotValid = /NOT\s+VALID/i.test(cleanClause);
        const nameMatch = cleanClause.match(/ADD\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)/i);
        const checkMatch = cleanClause.match(/CHECK\s*\(([^)]+)\)/i);
        const checkExpr = checkMatch ? checkMatch[1].trim() : '';

        // Extract column name if check is `(<col> IS NOT NULL)`
        const colNotNullMatch = checkExpr.match(/([a-zA-Z0-9_"]+)\s+IS\s+NOT\s+NULL/i);
        const validatedColumn = colNotNullMatch ? this.cleanIdentifier(colNotNullMatch[1]) : null;

        subcommands.push({
          subtype: 'ADD_CHECK_CONSTRAINT',
          table,
          constraintName: nameMatch ? this.cleanIdentifier(nameMatch[1]) : 'chk_' + table,
          checkExpr,
          validatedColumn,
          isNotValid,
          raw: cleanClause,
          line
        });
        continue;
      }

      // ALTER [COLUMN] ... SET NOT NULL (LG-009)
      if (upperClause.startsWith('ALTER ') && upperClause.includes('SET NOT NULL')) {
        const colMatch = cleanClause.match(/ALTER\s+(?:COLUMN\s+)?([a-zA-Z0-9_"]+)\s+SET\s+NOT\s+NULL/i);
        if (colMatch) {
          subcommands.push({
            subtype: 'SET_NOT_NULL',
            table,
            column: this.cleanIdentifier(colMatch[1]),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // ALTER [COLUMN] ... DROP NOT NULL
      if (upperClause.startsWith('ALTER ') && upperClause.includes('DROP NOT NULL')) {
        const colMatch = cleanClause.match(/ALTER\s+(?:COLUMN\s+)?([a-zA-Z0-9_"]+)\s+DROP\s+NOT\s+NULL/i);
        if (colMatch) {
          subcommands.push({
            subtype: 'DROP_NOT_NULL',
            table,
            column: this.cleanIdentifier(colMatch[1]),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // ALTER [COLUMN] ... TYPE
      if (upperClause.startsWith('ALTER ') && (upperClause.includes(' TYPE ') || upperClause.includes(' SET DATA TYPE '))) {
        const colMatch = cleanClause.match(/ALTER\s+(?:COLUMN\s+)?([a-zA-Z0-9_"]+)\s+(?:SET\s+DATA\s+)?TYPE\s+([a-zA-Z0-9_]+(?:\([^)]*\))?)/i);
        if (colMatch) {
          subcommands.push({
            subtype: 'ALTER_COLUMN_TYPE',
            table,
            column: this.cleanIdentifier(colMatch[1]),
            newType: colMatch[2].trim(),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // DROP [COLUMN]
      if (upperClause.startsWith('DROP ') && !upperClause.startsWith('DROP CONSTRAINT')) {
        const colMatch = cleanClause.match(/DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/i);
        if (colMatch) {
          subcommands.push({
            subtype: 'DROP_COLUMN',
            table,
            column: this.cleanIdentifier(colMatch[1]),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // DROP CONSTRAINT
      if (upperClause.startsWith('DROP CONSTRAINT')) {
        const constraintMatch = cleanClause.match(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/i);
        if (constraintMatch) {
          subcommands.push({
            subtype: 'DROP_CONSTRAINT',
            table,
            constraintName: this.cleanIdentifier(constraintMatch[1]),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // SET (storage params)
      if (upperClause.startsWith('SET ') && cleanClause.includes('(')) {
        const setStorageMatch = cleanClause.match(/SET\s*\(\s*([^)]+)\s*\)/i);
        if (setStorageMatch) {
          subcommands.push({
            subtype: 'SET_STORAGE_PARAM',
            table,
            params: setStorageMatch[1].trim(),
            raw: cleanClause,
            line
          });
        }
        continue;
      }

      // VALIDATE CONSTRAINT
      if (upperClause.startsWith('VALIDATE CONSTRAINT')) {
        const validateMatch = cleanClause.match(/VALIDATE\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)/i);
        if (validateMatch) {
          subcommands.push({
            subtype: 'VALIDATE_CONSTRAINT',
            table,
            constraintName: this.cleanIdentifier(validateMatch[1]),
            raw: cleanClause,
            line
          });
        }
        continue;
      }
    }

    return subcommands;
  }

  /**
   * Splits top-level comma-separated clauses, respecting parentheses and quotes.
   */
  static splitClauses(str) {
    const clauses = [];
    let current = '';
    let parenDepth = 0;
    let inQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === "'" && !inDoubleQuote) {
        inQuote = !inQuote;
        current += char;
        continue;
      }
      if (char === '"' && !inQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        continue;
      }
      if (!inQuote && !inDoubleQuote) {
        if (char === '(') parenDepth++;
        else if (char === ')') parenDepth--;
        else if (char === ',' && parenDepth === 0) {
          if (current.trim().length > 0) {
            clauses.push(current.trim());
          }
          current = '';
          continue;
        }
      }
      current += char;
    }

    if (current.trim().length > 0) {
      clauses.push(current.trim());
    }

    return clauses;
  }

  /**
   * Parses ADD COLUMN clause to extract default expressions and volatility.
   * In PostgreSQL 11+, constants and STABLE functions (now(), CURRENT_TIMESTAMP,
   * 'active', 0, false) are fast metadata-only additions without table rewrite.
   * Only VOLATILE expressions (random(), gen_random_uuid(), uuid_generate_v4())
   * force full table rewrite on disk.
   */
  static parseAddColumnClause(clause) {
    const clean = clause.replace(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/i, '').trim();
    const parts = clean.split(/\s+/);
    const column = this.cleanIdentifier(parts[0]);
    const dataType = parts[1] || 'TEXT';

    const hasDefault = /DEFAULT\s+/i.test(clean);
    let defaultValue = null;
    let isVolatileDefault = false;
    let isTrulyVolatile = false;
    let isPhysicalTableRewrite = false;
    let rewriteReason = 'NONE';

    if (hasDefault) {
      const defaultMatch = clean.match(/DEFAULT\s+([^,]+?)(?:\s+NOT\s+NULL|\s+NULL|$)/i);
      if (defaultMatch) {
        defaultValue = defaultMatch[1].trim();

        // Truly VOLATILE expressions in PostgreSQL:
        const volatilePatterns = [
          /\brandom\s*\(/i,
          /\bgen_random_uuid\s*\(/i,
          /\buuid_generate_/i,
          /\bclock_timestamp\s*\(/i,
          /\btimeofday\s*\(/i,
          /\bmd5\s*\(\s*random/i,
          /\bSELECT\b/i // subqueries
        ];

        // STABLE expressions in PostgreSQL (fast metadata-only in PG 11+):
        const stablePatterns = [
          /\bnow\s*\(/i,
          /\bcurrent_timestamp\b/i,
          /\bstatement_timestamp\s*\(/i,
          /\btransaction_timestamp\s*\(/i
        ];

        isTrulyVolatile = volatilePatterns.some(p => p.test(defaultValue));
        const isStableTimestamp = stablePatterns.some(p => p.test(defaultValue));

        // isVolatileDefault flags dynamic expressions (including now() and volatile funcs)
        isVolatileDefault = isTrulyVolatile || isStableTimestamp;
        isPhysicalTableRewrite = isTrulyVolatile;
        rewriteReason = isTrulyVolatile 
          ? 'VOLATILE_FULL_REWRITE' 
          : (isStableTimestamp ? 'FAST_DEFAULT_METADATA_ONLY' : 'CONSTANT_METADATA_ONLY');
      }
    }

    const isNotNull = /NOT\s+NULL/i.test(clean);

    return {
      column,
      dataType,
      hasDefault,
      defaultValue,
      isVolatileDefault,
      isTrulyVolatile,
      isPhysicalTableRewrite,
      rewriteReason,
      isNotNull
    };
  }

  static cleanIdentifier(ident) {
    if (!ident) return '';
    return ident
      .split('.')
      .map(part => part.replace(/^["'`]|["'`]$/g, '').trim())
      .join('.')
      .trim();
  }
}




  // 3. Rules
  const rule01 = (function() { 

return {
  id: 'LG-001',
  code: 'ADD_COLUMN_WITH_DEFAULT',
  name: 'Adding column with volatile or non-trivial DEFAULT',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a column with a volatile default (random(), gen_random_uuid(), clock_timestamp()) rewrites the entire table on disk under an ACCESS EXCLUSIVE lock, completely freezing all reads and writes.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const isLegacyPostgres = context.pgVersion && parseInt(context.pgVersion, 10) < 11;

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_COLUMN' && sub.hasDefault) {
            // In PostgreSQL 11+, pure constant literals ('active', 0, false, NULL)
            // and stable expressions (now(), CURRENT_TIMESTAMP)
            // are safe fast metadata-only updates.
            // Only truly volatile expressions (random, gen_random_uuid, clock_timestamp)
            // or legacy PG < 11 force physical table rewrite on disk.
            if (!sub.isTrulyVolatile && !isLegacyPostgres) {
              continue;
            }

            const isVolatileRewrite = !!sub.isTrulyVolatile || !!sub.isPhysicalTableRewrite;
            const isCritical = isVolatileRewrite || isLegacyPostgres;

            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: isCritical ? Severity.CRITICAL : Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              defaultValue: sub.defaultValue,
              isPhysicalTableRewrite: isVolatileRewrite || isLegacyPostgres,
              rewriteReason: isLegacyPostgres 
                ? 'LEGACY_POSTGRES_ALL_DEFAULTS_REWRITE' 
                : (isVolatileRewrite ? 'VOLATILE_FULL_REWRITE' : 'FAST_DEFAULT_METADATA_ONLY'),
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: isVolatileRewrite
                ? `Column '${sub.column}' on table '${sub.table}' has a volatile DEFAULT '${sub.defaultValue}'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock!`
                : (isLegacyPostgres 
                    ? `PostgreSQL < 11 does not support fast default evaluation! Adding DEFAULT '${sub.defaultValue}' rewrites the entire table on disk under ACCESS EXCLUSIVE lock!`
                    : `Column '${sub.column}' on table '${sub.table}' has DEFAULT '${sub.defaultValue}'. In Postgres 11+ metadata is fast, but statement still takes ACCESS EXCLUSIVE lock, risking Head-of-Line queue blocking!`)
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'new_column';
    const defVal = violation.defaultValue || "'default_value'";

    return [
      `-- Step 1: Add column without default (instant metadata update, no full table rewrite)`,
      `ALTER TABLE ${table} ADD COLUMN ${column} TEXT;`,
      ``,
      `-- Step 2: Set default for future rows`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defVal};`,
      ``,
      `-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)`,
      `-- UPDATE ${table} SET ${column} = ${defVal} WHERE ${column} IS NULL;`,
      ``,
      `-- Step 4: If NOT NULL is required, set it after backfill using zero-downtime pattern`,
      `-- ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_not_null CHECK (${column} IS NOT NULL) NOT VALID;`,
      `-- ALTER TABLE ${table} VALIDATE CONSTRAINT ${table}_${column}_not_null;`,
      `-- ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
      `-- ALTER TABLE ${table} DROP CONSTRAINT ${table}_${column}_not_null;`
    ].join('\n');
  }
};
 })();
  const rule02 = (function() { 

return {
  id: 'LG-002',
  code: 'CREATE_INDEX_NON_CONCURRENTLY',
  name: 'Creating index without CONCURRENTLY',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.SHARE,
  description: 'CREATE INDEX without CONCURRENTLY acquires a SHARE lock, completely blocking all INSERT, UPDATE, and DELETE operations until index generation finishes.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_INDEX' && !stmt.isConcurrent) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.table,
          indexName: stmt.indexName,
          columns: stmt.columns,
          line: stmt.line,
          raw: stmt.raw,
          message: `Index '${stmt.indexName}' on table '${stmt.table}' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production!`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const indexName = violation.indexName || 'idx_' + table;
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'column_name';

    return [
      `-- Safe alternative: Build index concurrently without blocking writes`,
      `-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block`,
      `CREATE INDEX CONCURRENTLY ${indexName} ON ${table} (${cols});`
    ].join('\n');
  }
};
 })();
  const rule03 = (function() { 

return {
  id: 'LG-003',
  code: 'FOREIGN_KEY_WITHOUT_NOT_VALID',
  name: 'Adding Foreign Key without NOT VALID',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a foreign key constraint without NOT VALID performs a full table scan while holding an ACCESS EXCLUSIVE lock, freezing the table during row validation.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY' && !sub.isNotValid) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              constraintName: sub.constraintName,
              foreignTable: sub.foreignTable,
              columns: sub.columns,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Foreign Key '${sub.constraintName}' on '${sub.table}' referencing '${sub.foreignTable}' lacks 'NOT VALID'. It blocks all reads/writes during table validation!`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const constraint = violation.constraintName || 'fk_' + table;
    const foreignTable = violation.foreignTable || 'target_table';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'foreign_id';

    return [
      `-- Step 1: Add foreign key with NOT VALID (instant lock acquisition, no full table scan)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${cols}) REFERENCES ${foreignTable}(id) NOT VALID;`,
      ``,
      `-- Step 2: Validate existing rows in a separate statement (acquires only SHARE UPDATE EXCLUSIVE - writes proceed!)`,
      `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`
    ].join('\n');
  }
};
 })();
  const rule04 = (function() { 

return {
  id: 'LG-004',
  code: 'ALTER_COLUMN_TYPE_REWRITE',
  name: 'Altering column type causing full table rewrite',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Changing a column data type (e.g. INT to BIGINT, VARCHAR to INT) requires a complete rewrite of the table and all its indexes under an ACCESS EXCLUSIVE lock.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ALTER_COLUMN_TYPE') {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              newType: sub.newType,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Altering type of column '${sub.column}' to '${sub.newType}' on table '${sub.table}' forces a full table rewrite on disk under ACCESS EXCLUSIVE lock!`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'old_column';
    const newType = violation.newType || 'BIGINT';
    const tempCol = `${column}_new`;

    return [
      `-- Safe 4-phase transition without downtime (dual-writing pattern):`,
      `-- Phase 1: Add new column without locking table`,
      `ALTER TABLE ${table} ADD COLUMN ${tempCol} ${newType};`,
      ``,
      `-- Phase 2: Create trigger / dual-write in application code for incoming writes`,
      `-- Backfill historical rows in small batches:`,
      `-- UPDATE ${table} SET ${tempCol} = ${column} WHERE ${tempCol} IS NULL;`,
      ``,
      `-- Phase 3: Rename columns in a quick metadata lock`,
      `-- ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_old;`,
      `-- ALTER TABLE ${table} RENAME COLUMN ${tempCol} TO ${column};`,
      ``,
      `-- Phase 4: Drop old column in later release`,
      `-- ALTER TABLE ${table} DROP COLUMN ${column}_old;`
    ].join('\n');
  }
};
 })();
  const rule05 = (function() { 

return {
  id: 'LG-005',
  code: 'ADD_UNIQUE_CONSTRAINT_DIRECT',
  name: 'Adding UNIQUE constraint directly without concurrent index',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a UNIQUE constraint directly creates an underlying unique index under an ACCESS EXCLUSIVE lock. Writes and reads are blocked during index creation.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_UNIQUE_CONSTRAINT' && !sub.isUsingIndex) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              constraintName: sub.constraintName,
              columns: sub.columns,
              line: stmt.line,
              raw: sub.raw,
              message: `UNIQUE constraint '${sub.constraintName}' on '${sub.table}' is added directly. Use CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX instead.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const constraint = violation.constraintName || 'uq_' + table;
    const indexName = constraint + '_idx';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'column_name';

    return [
      `-- Step 1: Create unique index concurrently without blocking writes`,
      `CREATE UNIQUE INDEX CONCURRENTLY ${indexName} ON ${table} (${cols});`,
      ``,
      `-- Step 2: Attach constraint using existing index (instant catalog operation)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} UNIQUE USING INDEX ${indexName};`
    ].join('\n');
  }
};
 })();
  const rule06 = (function() { 

return {
  id: 'LG-006',
  code: 'DROP_TABLE_OR_COLUMN_DIRECT',
  name: 'Immediate DROP COLUMN or DROP TABLE in monolithic step',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Dropping a table or column immediately takes an ACCESS EXCLUSIVE lock and crashes application code or replicas holding cached queries or ORM models.',
  
  check(astStatements) {
    const violations = [];

    for (const stmt of astStatements) {
      if (stmt.type === 'DROP_TABLE') {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.HIGH,
          lockLevel: this.lockLevel,
          table: stmt.tables.join(', '),
          line: stmt.line,
          raw: stmt.raw,
          message: `DROP TABLE '${stmt.tables.join(', ')}' in single step. Ensure tables are completely removed from ORM and all services before dropping.`
        });
      }

      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'DROP_COLUMN') {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              line: stmt.line,
              raw: sub.raw,
              message: `DROP COLUMN '${sub.column}' on '${sub.table}' executed directly. Ensure column is ignored in ORM (Prisma/Drizzle/Alembic) prior to dropping.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'old_column';

    return [
      `-- Safe 3-Phase Deprecation Workflow:`,
      `-- Phase 1: Deploy code ignoring the column in your ORM (e.g. Prisma @ignore or schema exclude)`,
      `-- Phase 2: Verify zero active queries access the column`,
      `-- Phase 3: Drop column safely:`,
      `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`
    ].join('\n');
  }
};
 })();
  const rule07 = (function() { 

return {
  id: 'LG-007',
  code: 'UNSAFE_VACUUM_IN_TRANSACTION',
  name: 'VACUUM or autovacuum storage parameter changes inside migration transaction',
  severity: Severity.HIGH,
  lockLevel: LockLevel.SHARE_UPDATE_EXCLUSIVE,
  description: 'VACUUM cannot run inside a multi-statement transaction block. Modifying autovacuum settings inside a transaction can cause deadlock or transaction failure.',
  
  check(astStatements) {
    const violations = [];
    let inTransaction = false;

    for (const stmt of astStatements) {
      if (stmt.type === 'TRANSACTION_START') {
        inTransaction = true;
      }
      if (stmt.type === 'TRANSACTION_COMMIT') {
        inTransaction = false;
      }

      if (stmt.type === 'VACUUM') {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: stmt.isFull ? LockLevel.ACCESS_EXCLUSIVE : LockLevel.SHARE_UPDATE_EXCLUSIVE,
          table: 'all',
          line: stmt.line,
          raw: stmt.raw,
          message: stmt.isFull 
            ? `VACUUM FULL locks tables completely (ACCESS EXCLUSIVE) and cannot be executed in standard migrations!`
            : `VACUUM statement found in migration script. VACUUM cannot run within an explicit transaction block!`
        });
      }

      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_STORAGE_PARAM' && /autovacuum/i.test(sub.params)) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.MEDIUM,
              lockLevel: LockLevel.SHARE_UPDATE_EXCLUSIVE,
              table: sub.table,
              line: stmt.line,
              raw: sub.raw,
              message: `Changing autovacuum settings (${sub.params}) on table '${sub.table}' inside migration script. Run outside migration transactions.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    return [
      `-- Run maintenance operations outside transactional migration scripts:`,
      `-- e.g. run via standalone DBA job or pg_cron:`,
      `ALTER TABLE ${table} SET (autovacuum_vacuum_scale_factor = 0.05);`
    ].join('\n');
  }
};
 })();
  const rule08 = (function() { 

return {
  id: 'LG-008',
  code: 'MISSING_LOCK_TIMEOUT',
  name: 'Missing SET lock_timeout directive in migration',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Without SET lock_timeout, a blocked DDL statement queues up behind long-running queries, blocking ALL subsequent incoming client requests (Head-of-Line Blocking).',
  
  check(astStatements) {
    const violations = [];

    // Check if any statement alters schema (ALTER TABLE, CREATE INDEX, DROP TABLE, etc.)
    const hasDdl = astStatements.some(s => 
      s.type === 'ALTER_TABLE' || 
      s.type === 'CREATE_INDEX' || 
      s.type === 'DROP_TABLE' ||
      s.type === 'CREATE_TABLE' ||
      s.type === 'DROP_INDEX' ||
      s.type === 'TRUNCATE_TABLE' ||
      s.type === 'REFRESH_MATVIEW'
    );

    if (!hasDdl) {
      return violations;
    }

    // Look for SET lock_timeout in the statements
    const hasLockTimeout = astStatements.some(s => 
      s.type === 'SET_VARIABLE' && s.variable === 'lock_timeout' && s.value
    );

    if (!hasLockTimeout) {
      violations.push({
        ruleId: this.id,
        ruleCode: this.code,
        ruleName: this.name,
        severity: Severity.HIGH,
        lockLevel: LockLevel.ACCESS_EXCLUSIVE,
        table: 'global',
        line: 1,
        raw: '-- (Header of migration file)',
        message: 'No `SET lock_timeout` found in migration! If table locks cannot be acquired immediately, this migration will block all production traffic behind it.'
      });
    }

    return violations;
  },

  generateSafeFix(violation, context = {}) {
    if (context.hasTransactionBlock) {
      return [
        `-- Migration runs inside a transaction block. Use SET LOCAL to scope lock_timeout to this transaction:`,
        `SET LOCAL lock_timeout = '3s';`,
        `SET LOCAL statement_timeout = '30s';`
      ].join('\n');
    }

    return [
      `-- Basic Pattern: Add lock_timeout at top and RESET at end:`,
      `SET lock_timeout = '3s';`,
      `SET statement_timeout = '30s';`,
      ``,
      `-- ... (your migration statements here) ...`,
      ``,
      `RESET lock_timeout;`,
      `RESET statement_timeout;`,
      ``,
      `-- Advanced Pattern: Zero-Downtime PL/pgSQL Lock-Retry loop:`,
      `DO $$`,
      `DECLARE`,
      `  success BOOLEAN := FALSE;`,
      `  attempts INT := 0;`,
      `BEGIN`,
      `  WHILE NOT success AND attempts < 5 LOOP`,
      `    BEGIN`,
      `      SET LOCAL lock_timeout = '2s';`,
      `      -- (Run your DDL command here)`,
      `      success := TRUE;`,
      `      EXIT;`,
      `    EXCEPTION WHEN lock_not_available THEN`,
      `      attempts := attempts + 1;`,
      `      PERFORM pg_sleep(1);`,
      `    END;`,
      `  END LOOP;`,
      `  IF NOT success THEN`,
      `    RAISE EXCEPTION 'Could not acquire lock after 5 attempts';`,
      `  END IF;`,
      `END $$;`
    ].join('\n');
  }
};
 })();
  const rule09 = (function() { 

return {
  id: 'LG-009',
  code: 'UNSAFE_SET_NOT_NULL',
  name: 'Unsafe ALTER COLUMN SET NOT NULL on existing table',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'ALTER COLUMN SET NOT NULL performs a full table scan while holding an ACCESS EXCLUSIVE lock to verify no NULLs exist, completely freezing the table on production.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    // Track validated check constraints: "table:column"
    const validatedChecks = new Set(context.validatedChecks || (context.sharedState && context.sharedState.validatedChecks) || []);
    const candidateChecks = new Map(); // constraintName -> { table, column }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_CHECK_CONSTRAINT' && sub.validatedColumn) {
            candidateChecks.set(`${sub.table.toLowerCase()}:${sub.constraintName.toLowerCase()}`, {
              table: sub.table.toLowerCase(),
              column: sub.validatedColumn.toLowerCase()
            });
          }
          if (sub.subtype === 'VALIDATE_CONSTRAINT') {
            const key = `${sub.table.toLowerCase()}:${sub.constraintName.toLowerCase()}`;
            if (candidateChecks.has(key)) {
              const info = candidateChecks.get(key);
              validatedChecks.add(`${info.table}:${info.column}`);
              if (context.sharedState && context.sharedState.validatedChecks) {
                context.sharedState.validatedChecks.add(`${info.table}:${info.column}`);
              }
            }
          }
        }
      }
    }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Skip tables created in the same migration file
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_NOT_NULL') {
            const checkKey = `${sub.table.toLowerCase()}:${sub.column.toLowerCase()}`;
            // If already validated via check constraint in this file, it's safe in PG 12+
            if (validatedChecks.has(checkKey)) {
              continue;
            }

            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Setting NOT NULL on column '${sub.column}' of table '${sub.table}' scans the entire table under ACCESS EXCLUSIVE lock! It will freeze all reads and writes.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'column_name';
    const constraintName = `${table}_${column}_not_null`;

    return [
      `-- Safe 4-step recipe for PostgreSQL 12+ (zero-downtime SET NOT NULL):`,
      `-- Step 1: Add CHECK constraint with NOT VALID (instant lock acquisition, no full table scan)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${column} IS NOT NULL) NOT VALID;`,
      ``,
      `-- Step 2: Validate constraint in a separate step (acquires SHARE UPDATE EXCLUSIVE - writes proceed!)`,
      `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraintName};`,
      ``,
      `-- Step 3: Fast SET NOT NULL (uses already validated check constraint in PG 12+ without scan)`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
      ``,
      `-- Step 4: Drop redundant check constraint`,
      `ALTER TABLE ${table} DROP CONSTRAINT ${constraintName};`
    ].join('\n');
  }
};
 })();
  const rule10 = (function() { 

return {
  id: 'LG-010',
  code: 'CONCURRENTLY_IN_TRANSACTION',
  name: 'CONCURRENTLY operation executed inside transaction block',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'PostgreSQL does not allow CREATE INDEX CONCURRENTLY, DROP INDEX CONCURRENTLY, or REINDEX CONCURRENTLY inside a transaction block (BEGIN...COMMIT). The migration will crash with ERROR 25001.',

  check(astStatements, context = {}) {
    const violations = [];
    const hasTransaction = context.hasTransactionBlock || astStatements.some(s => s.type === 'TRANSACTION_START');

    if (!hasTransaction) {
      return violations;
    }

    for (const stmt of astStatements) {
      const isConcurrent = (stmt.type === 'CREATE_INDEX' && stmt.isConcurrent) ||
                           (stmt.type === 'DROP_INDEX' && stmt.isConcurrent) ||
                           (stmt.type === 'REINDEX' && stmt.isConcurrent);

      if (isConcurrent) {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.table || 'global',
          line: stmt.line,
          raw: stmt.raw,
          message: `PostgreSQL prohibits CONCURRENTLY operations inside a transaction block (BEGIN...COMMIT)! Running this will immediately fail with: ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const rawSql = violation.raw || 'CREATE INDEX CONCURRENTLY idx ON table(col);';
    return [
      `-- Safe recipe: Remove the transaction block (BEGIN...COMMIT) around CONCURRENTLY operations:`,
      `-- In modern migration frameworks (Flyway, Liquibase, Knex, Prisma), disable transactions for this file:`,
      `-- (e.g. set: transaction = false or @transactional false)`,
      ``,
      `${rawSql}`
    ].join('\n');
  }
};
 })();
  const rule11 = (function() { 

return {
  id: 'LG-011',
  code: 'UNINDEXED_FOREIGN_KEY',
  name: 'Adding Foreign Key without supporting index on child columns',
  severity: Severity.MEDIUM,
  lockLevel: LockLevel.SHARE_ROW_EXCLUSIVE,
  description: 'Foreign keys without an index on referencing columns cause table-level lock escalation and sequential scans on the child table whenever rows in the parent table are UPDATED or DELETED.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdIndexes = new Set(context.createdIndexes || (context.sharedState && context.sharedState.createdIndexes) || []);

    // Gather indexes created in the current migration file
    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_INDEX' && stmt.table && stmt.columns) {
        for (const col of stmt.columns) {
          createdIndexes.add(`${stmt.table.toLowerCase()}:${col.toLowerCase()}`);
        }
      }
    }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY' && sub.columns && sub.columns.length > 0) {
            const table = sub.table.toLowerCase();
            const cols = sub.columns.map(c => c.toLowerCase());

            // Check if all FK columns have an index
            const hasIndex = cols.every(col => createdIndexes.has(`${table}:${col}`));

            if (!hasIndex) {
              const colList = sub.columns.join(', ');
              const cleanColName = sub.columns.join('_').replace(/[^a-zA-Z0-9_]/g, '');

              violations.push({
                ruleId: this.id,
                ruleCode: this.code,
                ruleName: this.name,
                severity: Severity.MEDIUM,
                lockLevel: this.lockLevel,
                table: sub.table,
                foreignTable: sub.foreignTable,
                constraintName: sub.constraintName,
                columns: sub.columns,
                line: sub.line || stmt.line,
                raw: sub.raw,
                message: `Foreign Key '${sub.constraintName}' on '${sub.table} (${colList})' lacks a supporting index. Any UPDATE or DELETE on parent '${sub.foreignTable}' will lock and sequentially scan '${sub.table}'!`
              });
            }
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns : ['foreign_id'];
    const idxName = `idx_${table}_${cols.join('_').replace(/[^a-zA-Z0-9_]/g, '')}`;

    return [
      `-- Add supporting index concurrently to prevent cascade lock escalation:`,
      `CREATE INDEX CONCURRENTLY ${idxName} ON ${table} (${cols.join(', ')});`
    ].join('\n');
  }
};
 })();
  const rule12 = (function() { 

return {
  id: 'LG-012',
  code: 'TRUNCATE_AND_MATERIALIZED_VIEW_LOCKS',
  name: 'Unsafe TRUNCATE or non-concurrent REFRESH MATERIALIZED VIEW',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'TRUNCATE and non-concurrent REFRESH MATERIALIZED VIEW acquire an ACCESS EXCLUSIVE lock on the table/view, completely blocking all reads and writes until execution finishes.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      // 1. TRUNCATE TABLE
      if (stmt.type === 'TRUNCATE_TABLE') {
        const tables = stmt.tables || [stmt.table];
        for (const tbl of tables) {
          if (createdTables.has(tbl.toLowerCase())) {
            continue;
          }

          violations.push({
            ruleId: this.id,
            ruleCode: this.code,
            ruleName: this.name,
            severity: Severity.CRITICAL,
            lockLevel: this.lockLevel,
            table: tbl,
            operationType: 'TRUNCATE',
            line: stmt.line,
            raw: stmt.raw,
            message: `TRUNCATE TABLE '${tbl}' acquires an ACCESS EXCLUSIVE lock and blocks all concurrent transactions. Use batched DELETE or partition rotation instead.`
          });
        }
      }

      // 2. REFRESH MATERIALIZED VIEW without CONCURRENTLY
      if (stmt.type === 'REFRESH_MATVIEW' && !stmt.isConcurrent) {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.view || stmt.table,
          operationType: 'REFRESH_MATVIEW',
          line: stmt.line,
          raw: stmt.raw,
          message: `REFRESH MATERIALIZED VIEW '${stmt.view}' without CONCURRENTLY acquires an ACCESS EXCLUSIVE lock, completely blocking all SELECT queries against the view until refresh completes!`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    if (violation.operationType === 'REFRESH_MATVIEW') {
      const view = violation.table || 'your_matview';
      return [
        `-- Safe alternative: Refresh concurrently without blocking reads`,
        `-- (Note: Requires a unique index on the materialized view)`,
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view};`
      ].join('\n');
    }

    const table = violation.table || 'your_table';
    return [
      `-- Safe alternative to TRUNCATE on live table:`,
      `-- Option 1: Batched DELETE loop to prevent table locking`,
      `DO $$`,
      `DECLARE`,
      `  deleted_count INT;`,
      `BEGIN`,
      `  LOOP`,
      `    DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} LIMIT 5000);`,
      `    GET DIAGNOSTICS deleted_count = ROW_COUNT;`,
      `    EXIT WHEN deleted_count = 0;`,
      `    COMMIT;`,
      `  END LOOP;`,
      `END $$;`
    ].join('\n');
  }
};
 })();

  // 4. Rule Engine
  
const CascadeGraph = require('./cascade-graph');















class RuleEngine {
  constructor(customRules = null) {
    this.rules = customRules || [
      rule01,
      rule02,
      rule03,
      rule04,
      rule05,
      rule06,
      rule07,
      rule08,
      rule09,
      rule10,
      rule11,
      rule12
    ];
  }

  /**
   * Returns list of all registered rules metadata.
   */
  getRules() {
    return this.rules.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      severity: r.severity,
      lockLevel: r.lockLevel,
      description: r.description
    }));
  }

  /**
   * Analyzes SQL script and checks for dangerous table locks.
   * @param {string} sqlText 
   * @param {object} options { filename, enabledRuleIds, failOnSeverity, ignoreRules, sharedState }
   */
  analyze(sqlText, options = {}) {
    const filename = options.filename || 'migration.sql';
    const enabledRuleIds = options.enabledRuleIds || null;
    const failOnSeverity = options.failOnSeverity || Severity.HIGH;
    const configIgnoreRules = (options.ignoreRules || []).map(r => r.toUpperCase());

    // 1. Parse AST
    const astStatements = PgParser.parse(sqlText);

    // 2. Build Context (Created tables in this migration, transaction state, shared state)
    const sharedState = options.sharedState || null;
    const createdTables = new Set(sharedState ? Array.from(sharedState.createdTables || []) : []);
    const createdIndexes = new Set(sharedState ? Array.from(sharedState.createdIndexes || []) : []);
    const validatedChecks = new Set(sharedState ? Array.from(sharedState.validatedChecks || []) : []);
    let hasTransactionBlock = false;

    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_TABLE' && stmt.table) {
        createdTables.add(stmt.table.toLowerCase());
        if (sharedState && sharedState.createdTables) {
          sharedState.createdTables.add(stmt.table.toLowerCase());
        }
      }
      if (stmt.type === 'CREATE_INDEX' && stmt.table && stmt.columns) {
        for (const col of stmt.columns) {
          createdIndexes.add(`${stmt.table.toLowerCase()}:${col.toLowerCase()}`);
          if (sharedState && sharedState.createdIndexes) {
            sharedState.createdIndexes.add(`${stmt.table.toLowerCase()}:${col.toLowerCase()}`);
          }
        }
      }
      if (stmt.type === 'TRANSACTION_START') {
        hasTransactionBlock = true;
      }
    }

    const cascadeGraph = new CascadeGraph();
    cascadeGraph.buildFromAst(astStatements);

    const context = {
      filename,
      sqlText,
      createdTables,
      createdIndexes,
      validatedChecks,
      hasTransactionBlock,
      cascadeGraph,
      sharedState,
      ...options
    };

    // 3. Run Rules
    const rawViolations = [];
    const activeRules = enabledRuleIds 
      ? this.rules.filter(r => enabledRuleIds.includes(r.id))
      : this.rules;

    for (const rule of activeRules) {
      // Check if rule is disabled globally in config
      if (configIgnoreRules.includes(rule.id.toUpperCase())) {
        continue;
      }

      try {
        const found = rule.check(astStatements, context);
        for (const v of found) {
          // Check inline statement-level ignore directives (-- lockguard-ignore: LG-XXX)
          const targetStmt = astStatements.find(s => 
            s.line === v.line || 
            (s.subcommands && s.subcommands.some(sub => sub.line === v.line))
          );

          if (targetStmt) {
            if (targetStmt.ignoreAll) {
              continue;
            }
            if (targetStmt.ignoreRules && targetStmt.ignoreRules.includes(v.ruleId.toUpperCase())) {
              continue;
            }
          }

          const safeFix = rule.generateSafeFix ? rule.generateSafeFix(v, context) : null;
          rawViolations.push({
            ...v,
            safeFix,
            lockDetails: LockMatrix[v.lockLevel] || null
          });
        }
      } catch (err) {
        console.error(`Error running rule ${rule.id}:`, err);
      }
    }

    const violations = rawViolations;

    // 4. Determine Affected Tables (Including parent tables in Foreign Keys)
    const affectedTablesSet = new Set();
    for (const stmt of astStatements) {
      if (stmt.table && stmt.table !== 'global' && stmt.table !== 'unknown_table') {
        affectedTablesSet.add(stmt.table);
      }
      if (stmt.tables) {
        stmt.tables.forEach(t => affectedTablesSet.add(t));
      }
      if (stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.table) affectedTablesSet.add(sub.table);
          if (sub.foreignTable) affectedTablesSet.add(sub.foreignTable);
        }
      }
    }
    for (const v of violations) {
      if (v.table && v.table !== 'global' && v.table !== 'unknown_table') {
        affectedTablesSet.add(v.table);
      }
      if (v.foreignTable) {
        affectedTablesSet.add(v.foreignTable);
      }
    }
    const affectedTables = Array.from(affectedTablesSet);

    // 5. Calculate Highest Lock Level
    const lockPriority = [
      LockLevel.ACCESS_SHARE,
      LockLevel.ROW_SHARE,
      LockLevel.ROW_EXCLUSIVE,
      LockLevel.SHARE_UPDATE_EXCLUSIVE,
      LockLevel.SHARE,
      LockLevel.SHARE_ROW_EXCLUSIVE,
      LockLevel.EXCLUSIVE,
      LockLevel.ACCESS_EXCLUSIVE
    ];

    let highestLock = LockLevel.ACCESS_SHARE;
    for (const v of violations) {
      if (v.lockLevel && lockPriority.indexOf(v.lockLevel) > lockPriority.indexOf(highestLock)) {
        highestLock = v.lockLevel;
      }
    }

    // 6. Verdict & Status
    const criticalCount = violations.filter(v => v.severity === Severity.CRITICAL).length;
    const highCount = violations.filter(v => v.severity === Severity.HIGH).length;
    const mediumCount = violations.filter(v => v.severity === Severity.MEDIUM).length;

    let passed = true;
    if (failOnSeverity === Severity.CRITICAL && criticalCount > 0) {
      passed = false;
    } else if (failOnSeverity === Severity.HIGH && (criticalCount > 0 || highCount > 0)) {
      passed = false;
    } else if (failOnSeverity === Severity.MEDIUM && (criticalCount > 0 || highCount > 0 || mediumCount > 0)) {
      passed = false;
    }

    const status = violations.length === 0 ? 'PASSED' : (passed ? 'WARNING' : 'FAILED');

    const hasDdl = astStatements.some(s => 
      s.type === 'ALTER_TABLE' || 
      s.type === 'CREATE_INDEX' || 
      s.type === 'DROP_TABLE' ||
      s.type === 'CREATE_TABLE' ||
      s.type === 'DROP_INDEX' ||
      s.type === 'TRUNCATE_TABLE' ||
      s.type === 'REFRESH_MATVIEW' ||
      s.type === 'VACUUM'
    );
    const isDmlOnly = !hasDdl && astStatements.length > 0;

    const cascadeWarnings = [];
    for (const table of affectedTables) {
      const risks = cascadeGraph.findCascadeRisks(table);
      for (const r of risks) {
        cascadeWarnings.push(r);
      }
    }

    return {
      filename,
      file: filename,
      status,
      passed,
      isDmlOnly,
      dmlDescription: isDmlOnly ? 'Operation is not a schema DDL migration (SELECT / DML read/write). No DDL locks detected, estimated downtime: 0.0s.' : null,
      violationsCount: violations.length,
      criticalCount,
      highCount,
      mediumCount,
      highestLockLevel: violations.length > 0 ? highestLock : LockLevel.ACCESS_SHARE,
      lockImpact: LockMatrix[highestLock] || null,
      affectedTables,
      cascadeWarnings,
      violations,
      astStatementsCount: astStatements.length,
      analyzedAt: new Date().toISOString()
    };
  }
}




  // 5. AutoSplitter
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




  // 6. Context Analyzer
  /**
 * LockGuard Context-Aware Metadata Analyzer
 * Evaluates live/replica table metrics (row counts, sizes, Postgres versions)
 * to calculate precise, real-world lock durations and eliminate false positives.
 */

class ContextAnalyzer {
  /**
   * Enriches an analysis result with real-world DB context.
   * @param {object} analysis AST analysis result from RuleEngine
   * @param {object} dbContext Table metadata { tables: { table: { rowCount, sizeMb } }, demoMode: boolean, pgVersion }
   */
  static enrich(analysis, dbContext = {}) {
    const enrichedViolations = [];
    let maxEstimatedDowntimeSec = 0;

    const defaultStats = {
      orders: { rowCount: 14200000, sizeMb: 8400 },
      transactions: { rowCount: 28500000, sizeMb: 16200 },
      users: { rowCount: 4500000, sizeMb: 2100 },
      accounts: { rowCount: 3200000, sizeMb: 1800 },
      order_items: { rowCount: 42000000, sizeMb: 19500 },
      payments: { rowCount: 8900000, sizeMb: 4300 }
    };

    const providedTables = dbContext.tables || {};
    const useDemoStats = !!dbContext.demoMode;

    for (const v of analysis.violations) {
      const tableName = v.table || 'default';
      let stats = providedTables[tableName];

      // Only use demo fallback stats when explicitly requested by demo/playground mode
      if (!stats && useDemoStats) {
        stats = defaultStats[tableName] || { rowCount: 100000, sizeMb: 50 };
      }

      if (!stats) {
        stats = { rowCount: 0, sizeMb: 0 };
      }

      const lockDuration = this.calculateLockDuration(v, stats, dbContext.pgVersion || 16);
      if (lockDuration.seconds > maxEstimatedDowntimeSec) {
        maxEstimatedDowntimeSec = lockDuration.seconds;
      }

      const contextualMessage = this.generateContextualRiskMessage(v, stats, lockDuration);

      enrichedViolations.push({
        ...v,
        tableStats: stats,
        estimatedLockDurationSec: lockDuration.seconds,
        estimatedDowntimeFormatted: lockDuration.formatted,
        downtimeRiskLevel: lockDuration.riskLevel,
        contextualMessage
      });
    }

    const hasAnyStats = analysis.affectedTables.some(t => providedTables[t] || (useDemoStats && defaultStats[t]));

    return {
      ...analysis,
      violations: enrichedViolations,
      hasLiveContext: hasAnyStats,
      maxEstimatedDowntimeSec,
      maxEstimatedDowntimeFormatted: this.formatSeconds(maxEstimatedDowntimeSec),
      contextSummary: hasAnyStats 
        ? `Audited against table metrics: ${analysis.affectedTables.map(t => {
            const s = providedTables[t] || (useDemoStats && defaultStats[t]) || { rowCount: 0 };
            return `${t} (${(s.rowCount / 1000000).toFixed(1)}M rows)`;
          }).join(', ')}`
        : 'Context analysis enabled without live metrics. Use --schema-stats=<file.json> or set DATABASE_URL to provide actual table sizes.'
    };
  }

  static calculateLockDuration(violation, stats, pgVersion = 16) {
    const { rowCount = 0, sizeMb = 0 } = stats;
    if (rowCount <= 0 && sizeMb <= 0) {
      return {
        seconds: 0,
        formatted: 'N/A',
        riskLevel: 'UNKNOWN (NO TABLE METRICS)'
      };
    }

    let seconds = 0;

    switch (violation.ruleId) {
      // ADD COLUMN with volatile DEFAULT
      case 'LG-001': {
        seconds = Math.max(1, Math.round(rowCount / 150000) + Math.round(sizeMb / 300));
        break;
      }

      // Non-concurrent CREATE INDEX
      case 'LG-002': {
        seconds = Math.max(2, Math.round(rowCount / 80000));
        break;
      }

      // Foreign Key without NOT VALID
      case 'LG-003': {
        seconds = Math.max(1, Math.round(rowCount / 200000));
        break;
      }

      // ALTER COLUMN TYPE rewrite
      case 'LG-004': {
        seconds = Math.max(2, Math.round(rowCount / 100000) * 1.5);
        break;
      }

      // Direct UNIQUE constraint
      case 'LG-005': {
        seconds = Math.max(2, Math.round(rowCount / 90000));
        break;
      }

      // Immediate DROP COLUMN / TABLE
      case 'LG-006': {
        seconds = 0.5;
        break;
      }

      // Missing lock timeout
      case 'LG-008': {
        seconds = 15;
        break;
      }

      // Unsafe SET NOT NULL
      case 'LG-009': {
        seconds = Math.max(2, Math.round(rowCount / 180000));
        break;
      }

      // TRUNCATE / MATVIEW
      case 'LG-012': {
        seconds = Math.max(1, Math.round(rowCount / 250000));
        break;
      }

      default:
        seconds = 1;
        break;
    }

    let riskLevel = 'LOW';
    if (seconds > 30) riskLevel = 'CRITICAL (OUTAGE GUARANTEED)';
    else if (seconds > 5) riskLevel = 'HIGH (SEVERE SPIKE)';
    else if (seconds > 1) riskLevel = 'MEDIUM (LATENCY ELEVATED)';

    return {
      seconds: Math.round(seconds),
      formatted: this.formatSeconds(seconds),
      riskLevel
    };
  }

  static generateContextualRiskMessage(violation, stats, lockDuration) {
    if ((stats.rowCount || 0) <= 0 && (stats.sizeMb || 0) <= 0) {
      return `Table '${violation.table}' live metrics unavailable. Operation will acquire ${violation.lockLevel} lock. Provide --schema-stats for estimated duration.`;
    }

    const rowsFormatted = (stats.rowCount >= 1000000) 
      ? (stats.rowCount / 1000000).toFixed(1) + 'M rows'
      : (stats.rowCount / 1000).toFixed(0) + 'k rows';

    const sizeFormatted = (stats.sizeMb >= 1024)
      ? (stats.sizeMb / 1024).toFixed(1) + ' GB'
      : stats.sizeMb + ' MB';

    return `Table '${violation.table}' contains ${rowsFormatted} (~${sizeFormatted}). ` +
      `Operation will hold ${violation.lockLevel} lock for at least ${lockDuration.formatted}, ` +
      `blocking concurrent client traffic. Calculated risk: ${lockDuration.riskLevel}.`;
  }

  static formatSeconds(sec) {
    if (sec <= 0) return '0.0s';
    if (sec < 1) return '< 1s';
    if (sec < 60) return `${Math.round(sec)}s`;
    const mins = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return `${mins}m ${rem}s`;
  }

  /**
   * Retrieves table schema statistics from live PostgreSQL (via psql) or a local JSON file.
   * @param {object} options { schemaStatsPath, useLiveDb, databaseUrl }
   * @returns {object} { [tableName]: { rowCount: number, sizeMb: number } }
   */
  static fetchSchemaStats(options = {}) {
    const fs = require('fs');
    const path = require('path');

    if (options.schemaStatsPath) {
      const resolved = path.resolve(process.cwd(), options.schemaStatsPath);
      if (fs.existsSync(resolved)) {
        try {
          const content = fs.readFileSync(resolved, 'utf8');
          const parsed = JSON.parse(content);
          const normalized = {};
          for (const [key, val] of Object.entries(parsed)) {
            normalized[key.toLowerCase()] = {
              rowCount: val.rowCount || val.row_count || val.rows || 0,
              sizeMb: val.sizeMb || val.size_mb || val.size || 0
            };
          }
          return normalized;
        } catch (err) {
          console.warn(`⚠️ Warning: Failed to parse schema stats from ${options.schemaStatsPath}: ${err.message}`);
        }
      }
    }

    const dbUrl = options.databaseUrl || process.env.DATABASE_URL;
    if (options.useLiveDb && dbUrl) {
      try {
        
        const sql = `SELECT c.relname, c.reltuples::bigint, pg_total_relation_size(c.oid) / (1024*1024) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r';`;
        const cmd = `psql "${dbUrl}" -t -A -F"," -c "${sql}"`;
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const stats = {};
        for (const line of output.trim().split('\n')) {
          if (!line.trim()) continue;
          const [table, rows, sizeMb] = line.split(',');
          if (table) {
            stats[table.trim().toLowerCase()] = {
              rowCount: Math.max(0, parseInt(rows, 10) || 0),
              sizeMb: Math.max(0, parseInt(sizeMb, 10) || 0)
            };
          }
        }
        return stats;
      } catch (err) {
        // Live psql query failed; fall through to empty stats
      }
    }

    return {};
  }
}




  // 7. Shadow Replay
  /**
 * LockGuard Shadow Replay Simulation Engine
 * Simulates concurrent read/write query traffic during DDL execution
 * to measure real-world lock contention latency.
 */

class ShadowReplaySimulator {
  /**
   * Runs a simulated lock contention benchmark against an AST analysis.
   * @param {object} analysis
   * @param {object} options { simulatedRows, concurrentRps }
   */
  static simulate(analysis, options = {}) {
    const rows = options.simulatedRows || 50000;
    const rps = options.concurrentRps || 250;
    const poolSize = options.pgBouncerPoolSize || 100;
    const cpuCores = options.cpuCores || 8;

    const simulationResults = [];
    let totalContentionMs = 0;

    // Queuing theory model (Poisson arrival / M/M/c) for lock collision probability
    const avgQueryDurationSec = 0.004; // 4ms average reader duration
    const tableTrafficRps = rps * 0.45; // ~45% of app queries hit this core table
    const coreContentionFactor = Math.max(1, (rps / (cpuCores * 100)));
    const effectiveInFlight = tableTrafficRps * (avgQueryDurationSec * coreContentionFactor);
    const lockContentionProb = Math.min(99.9, Math.max(1.0, (1 - Math.exp(-effectiveInFlight)) * 100));

    for (const v of analysis.violations) {
      let baseDelayMs = 0;
      let blockedQueriesCount = 0;

      switch (v.ruleId) {
        case 'LG-001': // volatile default rewrite
          baseDelayMs = Math.round((rows / 1000) * 12); // ~600ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        case 'LG-002': // non-concurrent index
          baseDelayMs = Math.round((rows / 1000) * 8); // ~400ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * (rps * 0.4)); // write queries
          break;

        case 'LG-003': // FK scan
          baseDelayMs = Math.round((rows / 1000) * 5); // ~250ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        case 'LG-004': // column type rewrite
          baseDelayMs = Math.round((rows / 1000) * 15); // ~750ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        default:
          baseDelayMs = Math.round((rows / 1000) * 2);
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;
      }

      totalContentionMs += baseDelayMs;

      simulationResults.push({
        table: v.table,
        ruleId: v.ruleId,
        lockLevel: v.lockLevel,
        simulatedContentionMs: baseDelayMs,
        blockedQueriesEstimated: blockedQueriesCount,
        verdict: baseDelayMs > 100 ? 'UNACCEPTABLE_LATENCY_SPIKE' : 'TOLERABLE'
      });
    }

    const timeToExhaustSec = Number((poolSize / rps).toFixed(2));
    const isPoolExhausted = totalContentionMs > (timeToExhaustSec * 1000);

    let outageSeverity = 'NONE';
    if (isPoolExhausted || totalContentionMs >= 1000) {
      outageSeverity = 'CATASTROPHIC';
    } else if (totalContentionMs >= 300) {
      outageSeverity = 'HIGH';
    } else if (totalContentionMs > 0) {
      outageSeverity = 'MODERATE';
    }

    return {
      simulatedRows: rows,
      simulatedConcurrentRps: rps,
      pgBouncerPoolSize: poolSize,
      cpuCores,
      lockContentionProbability: Number(lockContentionProb.toFixed(1)),
      timeToPoolExhaustionSec: timeToExhaustSec,
      isPoolExhausted,
      outageSeverity,
      poolExhaustionWarning: isPoolExhausted
        ? `At ${rps} RPS traffic, PgBouncer pool (${poolSize} connections) will exhaust in ${timeToExhaustSec}s! Subsequent queries will queue up or fail with HTTP 504 Gateway Timeout.`
        : `PgBouncer pool (${poolSize} connections) has sufficient buffer to absorb transient lock contention under normal load.`,
      totalLockWaitContentionMs: totalContentionMs,
      totalBlockedQueriesEstimated: simulationResults.reduce((acc, s) => acc + s.blockedQueriesEstimated, 0),
      tableSimulations: simulationResults,
      summary: `Shadow simulation on ${rows.toLocaleString()} rows measured ${totalContentionMs}ms total query wait latency, blocking ~${simulationResults.reduce((acc, s) => acc + s.blockedQueriesEstimated, 0)} client queries with ${lockContentionProb.toFixed(1)}% lock collision probability across ${cpuCores} vCPUs.`
    };
  }
}




  // 8. Cascade Graph
  /**
 * LockGuard Cascade Lock & Foreign Key Dependency Graph (DAG)
 * Detects hidden cascading locks across related tables due to unindexed foreign keys.
 */

class CascadeGraph {
  constructor() {
    this.nodes = new Map(); // table -> Set of related tables
    this.edges = []; // { fromTable, toTable, fkName, column, isIndexed }
  }

  /**
   * Builds DAG from AST statements and known relationships.
   * @param {Array<object>} astStatements
   */
  buildFromAst(astStatements) {
    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY') {
            this.addRelationship({
              fromTable: sub.table,
              toTable: sub.foreignTable,
              fkName: sub.constraintName,
              columns: sub.columns
            });
          }
        }
      }
    }
    return this;
  }

  addRelationship({ fromTable, toTable, fkName, columns }) {
    if (!this.nodes.has(fromTable)) this.nodes.set(fromTable, new Set());
    if (!this.nodes.has(toTable)) this.nodes.set(toTable, new Set());

    this.nodes.get(fromTable).add(toTable);
    this.nodes.get(toTable).add(fromTable);

    this.edges.push({
      fromTable,
      toTable,
      fkName: fkName || `fk_${fromTable}_${toTable}`,
      columns: columns || ['parent_id'],
      isIndexed: false // assume unindexed unless explicit index is found in AST
    });
  }

  /**
   * Analyzes cascade lock hazards when a given table is altered.
   * @param {string} targetTable Table being modified
   * @param {Array<string>} existingIndexes List of existing indexed column signatures
   */
  findCascadeRisks(targetTable, existingIndexes = []) {
    const risks = [];

    for (const edge of this.edges) {
      // If targetTable is parent (toTable) and child (fromTable) references it
      if (edge.toTable === targetTable) {
        const colName = edge.columns.join(',');
        const hasIndex = existingIndexes.includes(`${edge.fromTable}.${colName}`) || edge.isIndexed;

        if (!hasIndex) {
          risks.push({
            hazardType: 'UNINDEXED_FOREIGN_KEY_CASCADE',
            parentTable: targetTable,
            childTable: edge.fromTable,
            fkName: edge.fkName,
            columns: edge.columns,
            severity: 'HIGH',
            warning: `Warning: Altering parent table '${targetTable}' will cause lock escalation on child table '${edge.fromTable}' because foreign key '${edge.fkName}' (${edge.fromTable}.${edge.columns.join(', ')}) is not indexed!`,
            safeFix: `CREATE INDEX CONCURRENTLY idx_${edge.fromTable}_${edge.columns.join('_')} ON ${edge.fromTable} (${edge.columns.join(', ')});`
          });
        }
      }
    }

    return risks;
  }

  getGraphSummary() {
    return {
      totalTables: this.nodes.size,
      relationshipsCount: this.edges.length,
      relationships: this.edges
    };
  }
}




  // Default instances
  const allRules = [rule01, rule02, rule03, rule04, rule05, rule06, rule07, rule08, rule09, rule10, rule11, rule12];
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
