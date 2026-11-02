// Structural type metadata. An imported snapshot is evidence, not a live catalog.
function fromAst(type) {
  if (!type) return null;
  const names = (type.names || []).map(n => n.String.sval);
  const modifiers = (type.typmods || []).map(m => m.A_Const?.ival?.ival);
  if (!names.length || modifiers.some(n => !Number.isInteger(n))) return null;
  return { schema: names.length === 2 ? names[0] : null, name: names.at(-1), modifiers,
    arrayDimensions: type.arrayBounds?.length || 0 };
}
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !['schema', 'name', 'modifiers', 'arrayDimensions'].includes(k)) ||
      !(value.schema === null || typeof value.schema === 'string' && value.schema.length <= 63 && !/\0/.test(value.schema)) ||
      typeof value.name !== 'string' || !value.name || value.name.length > 63 || /\0/.test(value.name) ||
      !Array.isArray(value.modifiers) || value.modifiers.length > 4 || value.modifiers.some(n => !Number.isInteger(n) || n < -1000 || n > 1e7) ||
      !Number.isInteger(value.arrayDimensions) || value.arrayDimensions < 0 || value.arrayDimensions > 6) {
    throw Object.assign(new Error('Invalid structural column type metadata'), { statusCode: 400 });
  }
  return { schema:value.schema, name:value.name, modifiers:[...value.modifiers], arrayDimensions:value.arrayDimensions };
}
function classify(source, target, { version, using, collation, versionMismatch } = {}) {
  if (versionMismatch || !source || !target || using || collation || version < 14 || version > 18 ||
      source.schema !== 'pg_catalog' || target.schema !== 'pg_catalog' || source.arrayDimensions || target.arrayDimensions) return 'unknown';
  if (source.name === 'varchar' && target.name === 'varchar' && source.modifiers.length <= 1 && target.modifiers.length <= 1 &&
      [...source.modifiers,...target.modifiers].every(n=>n>=1&&n<=10485760) &&
      (target.modifiers.length === 0 || source.modifiers.length === 1 && target.modifiers[0] >= source.modifiers[0])) return 'not-required';
  const integers = ['int2','int4','int8'];
  if (integers.includes(source.name) && integers.includes(target.name) && source.name !== target.name) return 'required';
  return 'unknown';
}
module.exports = { fromAst, validate, classify };
