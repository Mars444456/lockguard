const { LockLevel: L } = require('./types');
// Inferred table locks, never a measurement of duration or a guarantee of availability.
module.exports = function statementLock(stmt) {
  if(stmt.type==='CREATE_INDEX' || stmt.type==='DROP_INDEX')return stmt.isConcurrent?L.SHARE_UPDATE_EXCLUSIVE:(stmt.type==='CREATE_INDEX'?L.SHARE:L.ACCESS_EXCLUSIVE);
  if(stmt.type==='ALTER_TABLE') {
    if(stmt.subcommands?.every(sub=>sub.subtype==='VALIDATE_CONSTRAINT'))return L.SHARE_UPDATE_EXCLUSIVE;
    if(stmt.subcommands?.every(sub=>['ADD_FOREIGN_KEY','VALIDATE_CONSTRAINT'].includes(sub.subtype)))return L.SHARE_ROW_EXCLUSIVE;
    return L.ACCESS_EXCLUSIVE;
  }
  if(['CREATE_TABLE','DROP_TABLE','TRUNCATE_TABLE'].includes(stmt.type))return L.ACCESS_EXCLUSIVE;
  if(stmt.type==='REFRESH_MATVIEW')return stmt.isConcurrent?L.EXCLUSIVE:L.ACCESS_EXCLUSIVE;
  if(stmt.type==='VACUUM')return stmt.isFull?L.ACCESS_EXCLUSIVE:L.SHARE_UPDATE_EXCLUSIVE;
  if(['InsertStmt','UpdateStmt','DeleteStmt','MergeStmt','CopyStmt'].includes(stmt.pgKind))return L.ROW_EXCLUSIVE;
  if(stmt.pgKind==='SelectStmt' && stmt.pgAst?.lockingClause?.length)return L.ROW_SHARE;
  return L.ACCESS_SHARE;
};
