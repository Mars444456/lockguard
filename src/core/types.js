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
    blocks: ['SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Compatible with normal SELECT, INSERT, UPDATE and DELETE table locks; other lock waits may still occur.'
  },
  [LockLevel.SHARE]: {
    description: 'Acquired by non-concurrent CREATE INDEX.',
    blocks: ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'FATAL: BLOCKS ALL INSERTS, UPDATES, AND DELETES. Can cause 504 Gateway Timeouts.'
  },
  [LockLevel.SHARE_ROW_EXCLUSIVE]: {
    description: 'Acquired by CREATE TRIGGER and some foreign key operations.',
    blocks: ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    impact: 'Conflicts with concurrent writes and schema changes; compatible with ROW SHARE.'
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

module.exports = {
  LockLevel,
  Severity,
  LockMatrix
};
