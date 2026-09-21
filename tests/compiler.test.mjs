import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assembleShaders } from '../tools/shader-sources.mjs';
import { lintLogicalMixing } from '../tools/wgsl-lint.mjs';
import { SHADERS, SHADER_MAPS, SHADER_HASHES } from '../packages/gpu/shaders.js';
import { sourceLocation, formatShaderMessage, compileKernels, ShaderBuildError } from '../packages/gpu/compiler.js';
const root = path.resolve(import.meta.dirname, '..');
for (const source of ['a || b && c', 'a && b || c', 'a ||\n b /* nested /* comment */ end */ && c'])
    test('Lexical guard rejects ungrouped logical mix: ' + source, () => assert.equal(lintLogicalMixing(source).length, 1));
for (const source of ['a || (b && c)', '(a && b) || c', 'select(a || b, c && d, true)', 'a || b; c && d;', 'a && /* || */ b', 'a || b // && c\n;', 'if a || b { if c && d {} }'])
    test('Lexical guard permits independent logical groups: ' + source, () => assert.equal(lintLogicalMixing(source).length, 0));
test('All assembled sources and provenance hashes are fresh', () => {
    const a = assembleShaders(root); assert.deepEqual(a.sources, SHADERS); assert.deepEqual(a.maps, SHADER_MAPS); assert.deepEqual(a.hashes, SHADER_HASHES);
    for (const [name, source] of Object.entries(SHADERS)) assert.deepEqual(lintLogicalMixing(source), [], name);
});
test('Compiler diagnostics map include lines and fallback locations', () => {
    const n = SHADERS.scene.split('\n').findIndex(l => l.includes('fn glyphDistance(')) + 1;
    const loc = sourceLocation(SHADER_MAPS.scene, n, 7); assert.equal(loc.file, 'packages/gpu/shaders/font-common.wgsl'); assert.ok(loc.line > 0); assert.equal(loc.column, 7);
    assert.deepEqual(sourceLocation([], 3, 4), { file: null, line: 3, column: 4 });
    const message = formatShaderMessage('scene', SHADERS.scene, SHADER_MAPS.scene, { lineNum: n, linePos: 7, message: 'fixture failure' });
    assert.match(message, /font-common\.wgsl:/); assert.match(message, /Assembled module scene:/); assert.match(message, /\^/);
});
test('Compiler rejects invalid concurrency before device access', async () => {
    for (const concurrency of [0, -1, 33, 1.5, NaN]) await assert.rejects(compileKernels({}, {}, {}, {}, { concurrency }), RangeError);
});
// Unit doubles below test orchestration only. The native suite compiles real WGSL.
test('Compiler aggregates source errors and never attempts invalid pipelines', async () => {
    let depth = 0;
    const device = { pushErrorScope() { depth++; }, popErrorScope() { depth--; return Promise.resolve(null); },
        createShaderModule() { return { getCompilationInfo: async () => ({ messages: [{ type: 'error', message: 'fixture', lineNum: 1, linePos: 2 }] }) }; },
        createComputePipelineAsync() { assert.fail('Must not create a pipeline for an invalid module'); } };
    await assert.rejects(compileKernels(device, { bad: '???' }, {}, {}), error => error instanceof ShaderBuildError && error.report.status === 'failed' && /fixture/.test(error.details));
    assert.equal(depth, 0);
});
test('Compiler pipeline concurrency is bounded and failures retain entry names', async () => {
    let active = 0, peak = 0;
    const device = { pushErrorScope() {}, popErrorScope: async () => null,
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        async createComputePipelineAsync({ compute }) { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
            if (compute.entryPoint === 'bad') throw new Error('fixture pipeline failure'); return {}; } };
    await assert.rejects(compileKernels(device, { a: '' }, {}, { a: { one: [], two: [], bad: [], four: [] } }, { concurrency: 2 }), error => {
        assert.equal(error.report.pipelines.length, 4); assert.match(error.details, /a.bad: fixture/); return true;
    }); assert.equal(peak, 2);
});
