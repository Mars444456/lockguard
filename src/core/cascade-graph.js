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

module.exports = CascadeGraph;
