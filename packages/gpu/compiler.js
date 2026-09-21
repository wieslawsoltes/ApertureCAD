/** Actual WebGPU compiler validation shared by browser startup and native CI. */
export class ShaderBuildError extends Error {
    constructor(message, details, report) {
        super(message); this.name = 'ShaderBuildError'; this.details = details; this.report = report;
    }
}
export function sourceLocation(map, generatedLine, column = 1) {
    const range = map?.find(r => generatedLine >= r.generatedLine && generatedLine < r.generatedLine + r.count);
    return range ? { file: range.file, line: range.sourceLine + generatedLine - range.generatedLine, column }
        : { file: null, line: generatedLine, column };
}
export function formatShaderMessage(name, code, map, message) {
    const loc = sourceLocation(map, message.lineNum || 0, message.linePos || 1);
    const header = `${loc.file || name}:${loc.line}:${loc.column} ${message.message}`;
    if (!message.lineNum) return header;
    const lines = code.split('\n'), start = Math.max(0, message.lineNum - 2), end = Math.min(lines.length, message.lineNum + 1);
    const excerpt = [];
    for (let i = start; i < end; i++) {
        excerpt.push(`${i + 1 === message.lineNum ? '>' : ' '} ${String(i + 1).padStart(4)} | ${lines[i]}`);
        if (i + 1 === message.lineNum) excerpt.push('       | ' + ' '.repeat(Math.min(500, Math.max(0, (message.linePos || 1) - 1))) + '^');
    }
    return `${header}\nAssembled module ${name}:${message.lineNum}:${message.linePos}\n${excerpt.join('\n')}`;
}
async function mapConcurrent(items, concurrency, callback) {
    let next = 0; const output = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) { const index = next++; output[index] = await callback(items[index], index); }
    }));
    return output;
}
export async function compileKernels(device, sources, maps, contracts, { concurrency = 4 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new RangeError('Compiler concurrency must be 1–32.');
    const report = { kind: 'webgpu-compiler', modules: [], pipelines: [], status: 'running', elapsedMs: 0 };
    const start = performance.now(), modules = {}, pipelines = {};
    // Scopes are pushed and popped before yielding: concurrent async compilation cannot
    // accidentally consume a sibling module's validation scope.
    const pending = Object.entries(sources).map(([name, code]) => {
        device.pushErrorScope('validation');
        let module, thrown;
        try { module = device.createShaderModule({ label: 'Aperture / ' + name, code }); }
        catch (error) { thrown = error; }
        const scope = device.popErrorScope();
        return { name, code, module, thrown, scope };
    });
    const moduleFailures = [];
    for (const { name, code, module, thrown, scope } of pending) {
        const validation = await scope;
        let info;
        try { info = module ? await module.getCompilationInfo() : { messages: [] }; }
        catch (error) { info = { messages: [{ type: 'error', message: error.message }] }; }
        const messages = info.messages.map(m => ({ type: m.type, message: m.message,
            lineNum: m.lineNum || 0, linePos: m.linePos || 0, offset: m.offset || 0, length: m.length || 0 }));
        if ((thrown || validation) && !messages.some(m => m.type === 'error'))
            messages.push({ type: 'error', message: (thrown || validation).message, lineNum: 0, linePos: 0 });
        const errors = messages.filter(m => m.type === 'error');
        report.modules.push({ name, status: errors.length ? 'failed' : 'passed', messages });
        if (errors.length) moduleFailures.push(...errors.map(m => formatShaderMessage(name, code, maps?.[name], m)));
        else modules[name] = module;
    }
    if (moduleFailures.length) {
        report.status = 'failed'; report.elapsedMs = performance.now() - start;
        throw new ShaderBuildError('WGSL compilation failed: ' + report.modules.filter(m => m.status === 'failed').map(m => m.name).join(', '), moduleFailures.join('\n\n'), report);
    }
    const jobs = Object.entries(contracts).flatMap(([name, entries]) => Object.keys(entries).map(entryPoint => ({ name, entryPoint })));
    const results = await mapConcurrent(jobs, concurrency, async ({ name, entryPoint }) => {
        const began = performance.now();
        try {
            if (!modules[name]) throw new Error('Missing shader module ' + name);
            const pipeline = await device.createComputePipelineAsync({ label: `${name}.${entryPoint}`, layout: 'auto', compute: { module: modules[name], entryPoint } });
            pipelines[entryPoint] = pipeline;
            return { module: name, entryPoint, status: 'passed', elapsedMs: performance.now() - began };
        } catch (error) { return { module: name, entryPoint, status: 'failed', error: error.message, elapsedMs: performance.now() - began }; }
    });
    report.pipelines = results; report.elapsedMs = performance.now() - start;
    const failures = results.filter(r => r.status === 'failed'); report.status = failures.length ? 'failed' : 'passed';
    if (failures.length) throw new ShaderBuildError('WebGPU pipeline creation failed', failures.map(f => `${f.module}.${f.entryPoint}: ${f.error}`).join('\n\n'), report);
    return { modules, pipelines, report };
}
