const { generatedName }=require('./sql-identifiers');
const foreignKeyIndexes = require('./foreign-key-indexes');

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
   * @param {object} context Optional schemaCatalog and precomputed FK index coverage
   */
  buildFromAst(astStatements, context = {}) {
    for (const { foreignKey: sub, indexedAtEnd } of context.fkIndexCoverage || foreignKeyIndexes(astStatements, context)) {
      this.addRelationship({
        fromTable: sub.table,
        toTable: sub.foreignTable,
        fkName: sub.constraintName,
        columns: sub.columns,
        isIndexed: indexedAtEnd
      });
    }
    return this;
  }

  addRelationship({ fromTable, toTable, fkName, columns, isIndexed = false }) {
    if (!this.nodes.has(fromTable)) this.nodes.set(fromTable, new Set());
    if (!this.nodes.has(toTable)) this.nodes.set(toTable, new Set());

    this.nodes.get(fromTable).add(toTable);
    this.nodes.get(toTable).add(fromTable);

    this.edges.push({
      fromTable,
      toTable,
      fkName: fkName || `fk_${fromTable}_${toTable}`,
      columns: columns || ['parent_id'],
      isIndexed
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
            warning: `Warning: Updating referenced keys or deleting rows in '${targetTable}' may require sequential scans of child table '${edge.fromTable}' because foreign key '${edge.fkName}' (${edge.fromTable}.${edge.columns.join(', ')}) is not indexed!`,
            safeFix: `CREATE INDEX CONCURRENTLY ${generatedName('idx',edge.fromTable,...edge.columns)} ON ${edge.fromTable} (${edge.columns.join(', ')});`
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
