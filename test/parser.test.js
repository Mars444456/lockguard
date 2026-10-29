const test = require('node:test');
const assert = require('node:assert/strict');
const PgParser = require('../src/core/pg-parser');

test('PgParser - correctly splits statements with quotes and comments', () => {
  const sql = `
    -- Line comment with ; semicolon
    SET lock_timeout = '3s';
    /* Block comment with ; semicolon */
    ALTER TABLE users ADD COLUMN bio TEXT;
    INSERT INTO audit (msg) VALUES ('quoted ; value');
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 3);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[0].variable, 'lock_timeout');
  assert.equal(ast[0].value, '3s');
  assert.equal(ast[1].type, 'ALTER_TABLE');
  assert.equal(ast[1].table, 'users');
});

test('PgParser - extracts CREATE INDEX and concurrency flag', () => {
  const blockingSql = 'CREATE INDEX idx_orders_user ON orders (user_id);';
  const concurrentSql = 'CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);';

  const ast1 = PgParser.parse(blockingSql);
  assert.equal(ast1[0].isConcurrent, false);
  assert.equal(ast1[0].table, 'orders');
  assert.equal(ast1[0].indexName, 'idx_orders_user');

  const ast2 = PgParser.parse(concurrentSql);
  assert.equal(ast2[0].isConcurrent, true);
});

test('PgParser - detects volatile expressions in ADD COLUMN DEFAULT', () => {
  const sql1 = "ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT now();";
  const sql2 = "ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';";

  const ast1 = PgParser.parse(sql1);
  assert.equal(ast1[0].subcommands[0].isVolatileDefault, true);

  const ast2 = PgParser.parse(sql2);
  assert.equal(ast2[0].subcommands[0].isVolatileDefault, false);
});

test('PgParser - handles Foreign Key NOT VALID flag', () => {
  const invalidFk = 'ALTER TABLE items ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;';
  const blockingFk = 'ALTER TABLE items ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);';

  const ast1 = PgParser.parse(invalidFk);
  assert.equal(ast1[0].subcommands[0].isNotValid, true);

  const ast2 = PgParser.parse(blockingFk);
  assert.equal(ast2[0].subcommands[0].isNotValid, false);
});
