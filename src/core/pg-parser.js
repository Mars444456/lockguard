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

module.exports = PgParser;
