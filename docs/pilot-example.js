window.LockGuardPilotExample = {
  "version": "1.3.0",
  "synthetic": true,
  "schemaSql": "-- Synthetic structure snapshot. No customer data or database connection.\nCREATE TABLE accounts (id bigint PRIMARY KEY);\nCREATE TABLE orders (\n  id bigint PRIMARY KEY,\n  account_id bigint,\n  created_at timestamptz\n);\nCREATE INDEX idx_orders_account_id ON orders (account_id);\n",
  "beforeSql": "-- Review against an existing orders table, outside an explicit transaction.\nSET lock_timeout = '3s';\nCREATE INDEX idx_orders_created_at ON orders (created_at);\nALTER TABLE orders ADD CONSTRAINT orders_account_fk\n  FOREIGN KEY (account_id) REFERENCES accounts (id) NOT VALID;\n",
  "afterSql": "-- Draft for review, outside a transaction. Test before applying.\n-- NOT VALID does not validate existing rows: plan VALIDATE CONSTRAINT separately.\nSET lock_timeout = '3s';\nCREATE INDEX CONCURRENTLY idx_orders_created_at ON orders (created_at);\nALTER TABLE orders ADD CONSTRAINT orders_account_fk\n  FOREIGN KEY (account_id) REFERENCES accounts (id) NOT VALID;\n",
  "withoutSchema": {
    "analysisComplete": true,
    "passed": false,
    "findings": [
      {
        "ruleId": "LG-002",
        "severity": "CRITICAL",
        "table": "orders",
        "message": "Index 'idx_orders_created_at' on table 'orders' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production!",
        "line": 3
      },
      {
        "ruleId": "LG-011",
        "severity": "MEDIUM",
        "table": "orders",
        "message": "Foreign Key 'orders_account_fk' on 'orders (account_id)' lacks a supporting index. Any UPDATE or DELETE on parent 'accounts' will lock and sequentially scan 'orders'!",
        "line": 4
      }
    ]
  },
  "before": {
    "analysisComplete": true,
    "passed": false,
    "findings": [
      {
        "ruleId": "LG-002",
        "severity": "CRITICAL",
        "table": "orders",
        "message": "Index 'idx_orders_created_at' on table 'orders' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production!",
        "line": 3
      }
    ]
  },
  "after": {
    "analysisComplete": true,
    "passed": true,
    "findings": []
  },
  "comparison": {
    "resolved": [
      "LG-002"
    ],
    "introduced": [],
    "persisting": [],
    "contextChanged": false
  }
};
