/**
 * LockGuard PostgreSQL DDL Lexer & AST Parser
 * Converts raw PostgreSQL migration SQL into a structured AST representation.
 * Resilient against comments, multi-line statements, quoted strings, and dialect variations.
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
      const parsed = this.parseStatement(raw.sql, raw.line, raw.rawFull);
      if (parsed) {
        astStatements.push(parsed);
      }
    }

    return astStatements;
  }

  /**
   * Splits SQL text into individual statements, tracking line numbers.
   * Preserves strings and correctly ignores semicolons inside quotes or comments.
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

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1] || '';

      if (char === '\n') {
        currentLine++;
      }

      // Handle Line Comment --
      if (!inSingleQuote && !inDoubleQuote && !inBlockComment) {
        if (!inLineComment && char === '-' && nextChar === '-') {
          inLineComment = true;
          currentRaw += char;
          continue;
        }
        if (inLineComment && char === '\n') {
          inLineComment = false;
          currentRaw += char;
          continue;
        }
      }

      // Handle Block Comment /* */
      if (!inSingleQuote && !inDoubleQuote && !inLineComment) {
        if (!inBlockComment && char === '/' && nextChar === '*') {
          inBlockComment = true;
          currentRaw += char;
          continue;
        }
        if (inBlockComment && char === '*' && nextChar === '/') {
          inBlockComment = false;
          currentRaw += '*/';
          i++; // skip next char
          continue;
        }
      }

      if (inLineComment || inBlockComment) {
        currentRaw += char;
        continue;
      }

      // Handle Quotes
      if (char === "'" && !inDoubleQuote) {
        // Escaped single quote in SQL: ''
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

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        currentRaw += char;
        continue;
      }

      // Semicolon separator
      if (char === ';' && !inSingleQuote && !inDoubleQuote) {
        if (current.trim().length > 0) {
          statements.push({
            sql: current.trim(),
            rawFull: currentRaw.trim() + ';',
            line: startLine
          });
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
      statements.push({
        sql: current.trim(),
        rawFull: currentRaw.trim(),
        line: startLine
      });
    }

    return statements;
  }

  /**
   * Analyzes an individual SQL statement string and produces an AST node.
   */
  static parseStatement(sql, line, rawFull) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();
    const upper = cleanSql.toUpperCase();

    // 1. SET lock_timeout / statement_timeout
    if (upper.startsWith('SET ')) {
      const lockTimeoutMatch = cleanSql.match(/SET\s+(?:LOCAL\s+)?lock_timeout\s*=\s*['"]?([^'";]+)['"]?/i);
      const statementTimeoutMatch = cleanSql.match(/SET\s+(?:LOCAL\s+)?statement_timeout\s*=\s*['"]?([^'";]+)['"]?/i);
      
      return {
        type: 'SET_VARIABLE',
        variable: lockTimeoutMatch ? 'lock_timeout' : (statementTimeoutMatch ? 'statement_timeout' : 'other'),
        value: lockTimeoutMatch ? lockTimeoutMatch[1] : (statementTimeoutMatch ? statementTimeoutMatch[1] : null),
        line,
        raw: sql,
        rawFull: rawFull || sql
      };
    }

    // 2. Transaction control: BEGIN, COMMIT, ROLLBACK
    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION' || upper === 'START TRANSACTION') {
      return { type: 'TRANSACTION_START', line, raw: sql, rawFull: rawFull || sql };
    }
    if (upper === 'COMMIT' || upper === 'END' || upper === 'COMMIT TRANSACTION') {
      return { type: 'TRANSACTION_COMMIT', line, raw: sql, rawFull: rawFull || sql };
    }

    // 3. CREATE INDEX
    if (upper.startsWith('CREATE INDEX') || upper.startsWith('CREATE UNIQUE INDEX')) {
      const isUnique = /CREATE\s+UNIQUE\s+INDEX/i.test(cleanSql);
      const isConcurrent = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(cleanSql);
      
      const onMatch = cleanSql.match(/ON\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)\s*(?:USING\s+[a-zA-Z0-9_]+\s*)?\(([^)]+)\)/i);
      const nameMatch = cleanSql.match(/INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);

      const table = onMatch ? this.cleanIdentifier(onMatch[1]) : 'unknown_table';
      const indexName = nameMatch ? this.cleanIdentifier(nameMatch[1]) : 'idx_' + table;
      const columns = onMatch ? onMatch[2].split(',').map(s => s.trim()) : [];

      return {
        type: 'CREATE_INDEX',
        isUnique,
        isConcurrent,
        table,
        indexName,
        columns,
        line,
        raw: sql,
        rawFull: rawFull || sql
      };
    }

    // 4. DROP TABLE
    if (upper.startsWith('DROP TABLE')) {
      const tableMatch = cleanSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_.", ]+)/i);
      const tables = tableMatch 
        ? tableMatch[1].split(',').map(t => this.cleanIdentifier(t.trim()))
        : ['unknown_table'];

      return {
        type: 'DROP_TABLE',
        tables,
        line,
        raw: sql,
        rawFull: rawFull || sql
      };
    }

    // 5. ALTER TABLE statements
    if (upper.startsWith('ALTER TABLE')) {
      const tableMatch = cleanSql.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i);
      const table = tableMatch ? this.cleanIdentifier(tableMatch[1]) : 'unknown_table';
      
      // Parse subcommands
      const subcommands = this.parseAlterSubcommands(cleanSql, table, line);

      return {
        type: 'ALTER_TABLE',
        table,
        subcommands,
        line,
        raw: sql,
        rawFull: rawFull || sql
      };
    }

    // 6. VACUUM
    if (upper.startsWith('VACUUM')) {
      const isFull = /VACUUM\s+(?:FULL|\([^)]*FULL[^)]*\))/i.test(cleanSql);
      return {
        type: 'VACUUM',
        isFull,
        line,
        raw: sql,
        rawFull: rawFull || sql
      };
    }

    // Default unrecognized statement
    return {
      type: 'STATEMENT',
      line,
      raw: sql,
      rawFull: rawFull || sql
    };
  }

  /**
   * Parses ALTER TABLE subcommands: ADD COLUMN, ALTER COLUMN TYPE, ADD CONSTRAINT, DROP COLUMN, etc.
   */
  static parseAlterSubcommands(sql, table, line) {
    const subcommands = [];
    const parts = sql.replace(/^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?[a-zA-Z0-9_."]+\s+/i, '').trim();

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
          isNotNull: colDetails.isNotNull,
          raw: cleanClause
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
          raw: cleanClause
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
          raw: cleanClause
        });
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
            raw: cleanClause
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
            raw: cleanClause
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
            raw: cleanClause
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
            raw: cleanClause
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

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === "'") {
        inQuote = !inQuote;
        current += char;
        continue;
      }
      if (!inQuote) {
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
   */
  static parseAddColumnClause(clause) {
    const clean = clause.replace(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/i, '').trim();
    const parts = clean.split(/\s+/);
    const column = this.cleanIdentifier(parts[0]);
    const dataType = parts[1] || 'TEXT';

    const hasDefault = /DEFAULT\s+/i.test(clean);
    let defaultValue = null;
    let isVolatileDefault = false;

    if (hasDefault) {
      const defaultMatch = clean.match(/DEFAULT\s+([^,]+?)(?:\s+NOT\s+NULL|\s+NULL|$)/i);
      if (defaultMatch) {
        defaultValue = defaultMatch[1].trim();
        // Check volatility
        // Volatile functions in Postgres: now(), current_timestamp, clock_timestamp(), random(), uuid_generate_v4(), gen_random_uuid(), etc.
        const volatilePatterns = [
          /\bnow\s*\(/i,
          /\bclock_timestamp\s*\(/i,
          /\bcurrent_timestamp\b/i,
          /\brandom\s*\(/i,
          /\buuid_generate_/i,
          /\bgen_random_uuid\s*\(/i,
          /\btimeofday\s*\(/i,
          /\bstatement_timestamp\s*\(/i,
          /\btransaction_timestamp\s*\(/i,
          /\bSELECT\b/i // subqueries
        ];

        isVolatileDefault = volatilePatterns.some(pattern => pattern.test(defaultValue));
      }
    }

    const isNotNull = /NOT\s+NULL/i.test(clean);

    return {
      column,
      dataType,
      hasDefault,
      defaultValue,
      isVolatileDefault,
      isNotNull
    };
  }

  static cleanIdentifier(ident) {
    if (!ident) return '';
    return ident.replace(/^["'`]|["'`]$/g, '').trim();
  }
}

module.exports = PgParser;
