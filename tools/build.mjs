import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { assembleShaders, shaderBundle } from './shader-sources.mjs';
const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const assembled = assembleShaders(root);
fs.writeFileSync(path.join(root, 'packages/gpu/shaders.js'), shaderBundle(assembled));
fs.mkdirSync(path.join(root, 'artifacts/wgsl'), { recursive: true });
for (const [name, code] of Object.entries(assembled.sources))
    fs.writeFileSync(path.join(root, `artifacts/wgsl/${name}.wgsl`), code);
fs.writeFileSync(path.join(root, 'artifacts/shader-manifest.json'), JSON.stringify({ hashes: assembled.hashes, maps: assembled.maps }, null, 2) + '\n');
/** Deterministic named-export ESM bundler for this dependency-free workspace. */
function bundle(entry) {
    const mods = new Map();
    function visit(file) { file = file.replaceAll('\\', '/'); if (mods.has(file))
        return; let src = read(file); mods.set(file, ''); const exports = []; src = src.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, names, spec) => { if (!spec.startsWith('.'))
        throw Error('External dependency ' + spec); const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)); visit(target); return `const {${names.replace(/\s+as\s+/g, ':')}}=require(${JSON.stringify(target)});`; }); src = src.replace(/export\s+((?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+))/g, (_, decl, name) => { exports.push(name); return decl; }); src += '\nObject.assign(exports,{' + exports.join(',') + '});'; mods.set(file, src); }
    visit(entry);
    return '(function(){"use strict";const factories={' + [...mods].map(([id, src]) => JSON.stringify(id) + ':function(module,exports,require){\n' + src + '\n}').join(',\n') + '};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,require);return module.exports;}require(' + JSON.stringify(entry) + ');})();\n';
}
const worker = bundle('packages/dxf/worker.js');
fs.writeFileSync(path.join(root, 'packages/dxf/worker-source.js'), '// Generated worker bundle.\nexport const WORKER_SOURCE=' + JSON.stringify(worker) + ';\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
if (fs.existsSync(path.join(root, 'packages/app/index.js'))) {
    const app = bundle('packages/app/index.js');
    const css = read('packages/app/styles.css');
    const template = read('public/index.html');
    const html = template.replace('<!-- APP_CSS -->', () => `<style>${css}</style>`).replace('<!-- APP_JS -->', () => '<script>' + app.replaceAll('</script', '<\\/script') + '</script>');
    fs.writeFileSync(path.join(root, 'dist/index.html'), html);
    fs.writeFileSync(path.join(root, 'dist/aperture-cad-preview.html'), html);
    fs.writeFileSync(path.join(root, 'dist/app.js'), app);
    fs.writeFileSync(path.join(root, 'dist/styles.css'), css);
    fs.writeFileSync(path.join(root, 'dist/index.modular.html'), template.replace('<!-- APP_CSS -->', '<link rel="stylesheet" href="styles.css">').replace('<!-- APP_JS -->', '<script src="app.js"></script>'));
    const compressed = zlib.gzipSync(Buffer.from(html), { level: 9 }).toString('base64');
    fs.writeFileSync(path.join(root, 'artifacts/preview.gzip.base64'), compressed);
    console.log(`Built ${Buffer.byteLength(html).toLocaleString()} bytes standalone HTML; ${compressed.length.toLocaleString()} characters gzipped base64.`);
}
else
    console.log('Generated shaders and DXF worker.');
