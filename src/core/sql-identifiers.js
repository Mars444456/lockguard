// PostgreSQL identifiers are limited to 63 bytes. Generated names use ASCII and
// a stable suffix when quoting/schema names would otherwise change their meaning.
function generatedName(...parts) {
  const source = parts.join('_');
  const safe = source.replace(/[^a-zA-Z0-9_]/g, '_');
  if (safe === source && safe.length <= 63) return safe;
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return safe.slice(0, 50) + '_' + hash.toString(16);
}
module.exports = { generatedName };
