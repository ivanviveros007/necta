/**
 * Transformador de Jest para los paquetes ESM de NestJS 12 en Node 22.
 * Jest (30) solo soporta require(esm) nativo desde Node 24.9; aquí se transpila a CommonJS
 * con TypeScript. `import.meta.url` se reemplaza por su equivalente CommonJS.
 */
const ts = require('typescript');
const crypto = require('node:crypto');

module.exports = {
  getCacheKey(source, path) {
    return crypto.createHash('sha1').update(source).update(path).update('v1').digest('hex');
  },
  process(source, path) {
    const patched = source.replace(/import\.meta\.url/g, "require('url').pathToFileURL(__filename).href");
    const out = ts.transpileModule(patched, {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
        sourceMap: false,
      },
    });
    return { code: out.outputText };
  },
};
