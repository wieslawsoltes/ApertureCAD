import { EDIT_BINDINGS } from '../packages/gpu/edit-tools.js';
/** Static contracts only: this is not a WGSL compiler or a GPU execution test. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleShaders } from './shader-sources.mjs';
import { lintLogicalMixing } from './wgsl-lint.mjs';
import { SHADERS, SHADER_MAPS, SHADER_HASHES } from '../packages/gpu/shaders.js';
import { SCENE_BINDINGS, PIXEL_BINDINGS, INDEX_BINDINGS } from '../packages/gpu/index.js';
const root = path.resolve(import.meta.dirname, '..');
const errors = [], passed = [];
const fail = s => errors.push(s), ok = s => passed.push(s);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
for (const file of walk(path.join(root, 'packages')).filter(f => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status)
        fail(r.stderr);
}
ok('All package JavaScript files pass Node syntax checks');
const gpu = fs.readFileSync(path.join(root, 'packages/gpu/index.js'), 'utf8');
for (const forbidden of ['createRenderPipeline', 'createRenderPipelineAsync', 'beginRenderPass', 'drawIndexed(', 'draw(', 'getContext(\'2d\'', 'getContext("2d"', 'getContext(\'webgl'])
    if (gpu.includes(forbidden))
        fail('Forbidden render path: ' + forbidden);
ok('CAD engine contains no render-pipeline, render-pass, WebGL or Canvas2D calls');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"<>]+)"/g)].map(m => m[1]);
if (ids.length !== new Set(ids).size)
    fail('Duplicate HTML IDs');
else
    ok('HTML IDs are unique');
const contracts = { scene: SCENE_BINDINGS, pixels: PIXEL_BINDINGS, index: INDEX_BINDINGS, font: { bake: [0, 1, 2] }, stroke: { compileStroke: [0, 1, 2] },edit:EDIT_BINDINGS };
const reserved = new Set('NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debug decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared handle highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield'.split(' '));
const assembled = assembleShaders(root);
if (JSON.stringify(assembled.sources) !== JSON.stringify(SHADERS) || JSON.stringify(assembled.maps) !== JSON.stringify(SHADER_MAPS) || JSON.stringify(assembled.hashes) !== JSON.stringify(SHADER_HASHES))
    fail('Stale generated WGSL bundle. Run npm run build.');
else ok('Generated shader sources, original-file maps and SHA-256 hashes match every WGSL source');
for (const file of ['dist/app.js', 'dist/index.html', 'dist/aperture-cad-preview.html']) {
    if (!fs.readFileSync(path.join(root, file), 'utf8').includes('const SHADERS=' + JSON.stringify(SHADERS)))
        fail('Stale distributed shader source: ' + file);
}
for (const [name, source] of Object.entries(SHADERS)) {
    for (const error of lintLogicalMixing(source)) fail(`${name}:${error.line}:${error.column} ${error.message}`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const stack = [];
    for (const c of code) {
        if ('({['.includes(c))
            stack.push(c);
        else if (')}]'.includes(c)) {
            const a = stack.pop();
            if (!a || '({['.indexOf(a) !== ')}]'.indexOf(c)) {
                fail(name + ' unbalanced delimiters');
                break;
            }
        }
    }
    if (stack.length)
        fail(name + ' unclosed delimiters');
    for (const token of code.match(/\b[A-Za-z_]\w*\b/g) || [])
        if (reserved.has(token))
            fail(name + ' contains reserved WGSL identifier ' + token);
    const bindings = new Map([...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+(\w+)/g)].map(m => [m[3], { binding: +m[1], storage: m[2]?.startsWith('storage') }]));
    const functions = new Map();
    for (const m of code.matchAll(/\bfn\s+(\w+)\s*\(/g)) {
        let start = code.indexOf('{', m.index), end = start + 1, depth = 1;
        for (; depth && end < code.length; end++) {
            if (code[end] === '{')
                depth++;
            if (code[end] === '}')
                depth--;
        }
        functions.set(m[1], code.slice(start + 1, end - 1));
    }
    for (const [entry, expected] of Object.entries(contracts[name])) {
        const used = new Set(), visited = new Set();
        function visit(fn) { if (visited.has(fn))
            return; visited.add(fn); const text = functions.get(fn); if (text === undefined) {
            fail(name + ' missing entry ' + fn);
            return;
        } for (const [key, b] of bindings)
            if (new RegExp('(?<![.\\w])' + key + '\\b').test(text))
                used.add(b.binding); for (const [key] of functions)
            if (new RegExp('\\b' + key + '\\s*\\(').test(text))
                visit(key); }
        visit(entry);
        if ([...used].sort((a, b) => a - b).join(',') !== expected.join(','))
            fail(`${name}.${entry} resource contract mismatch: actual ${[...used].sort((a, b) => a - b)} expected ${expected}`);
        const storage = [...bindings.values()].filter(b => used.has(b.binding) && b.storage).length;
        if (storage > 8)
            fail(`${name}.${entry} uses ${storage} storage bindings (>8 baseline)`);
    }
    ok(`${name}: balanced source, reserved identifiers, entry points, transitive resource bindings, baseline storage limits`);
}
if (!/dispatchWorkgroupsIndirect\(p\.indirect,\s*0\)/.test(gpu))
    fail('Indirect dispatch must use a dedicated non-raster binding');
const result = { kind: 'static-contract-checks', gpuCompilation: false, passed, errors };
fs.writeFileSync(path.join(root, 'artifacts/static-checks.json'), JSON.stringify(result, null, 2) + '\n');
for (const p of passed)
    console.log('CHECK', p);
for (const e of errors)
    console.error('FAIL', e);
process.exitCode = errors.length ? 1 : 0;
