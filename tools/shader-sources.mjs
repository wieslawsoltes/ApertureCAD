/** Deterministic WGSL assembly with original-file locations. No shader syntax rewriting. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const SHADER_NAMES = Object.freeze(['font', 'scene', 'pixels', 'index', 'stroke', 'edit']);
export function assembleShaders(root) {
    const sources = {}, maps = {}, hashes = {};
    function expand(file, ancestors = []) {
        if (ancestors.includes(file)) throw new Error('Recursive WGSL include: ' + [...ancestors, file].join(' -> '));
        const lines = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n').split('\n');
        const output = [], locations = [];
        lines.forEach((line, index) => {
            const match = /^\s*\/\/\s*@([\w-]+)\s*$/.exec(line);
            if (match) {
                if (!['font-common', 'layout-common', 'hatch-common', 'dimension-common'].includes(match[1]))
                    throw new Error(`Unknown WGSL include ${match[1]} in ${file}:${index + 1}`);
                const included = expand(`packages/gpu/shaders/${match[1]}.wgsl`, [...ancestors, file]);
                output.push(...included.output); locations.push(...included.locations);
            } else { output.push(line); locations.push({ file, line: index + 1 }); }
        });
        return { output, locations };
    }
    for (const name of SHADER_NAMES) {
        const { output, locations } = expand(`packages/gpu/shaders/${name}.wgsl`);
        sources[name] = output.join('\n'); maps[name] = [];
        locations.forEach((loc, index) => {
            const previous = maps[name].at(-1);
            if (previous && previous.file === loc.file && previous.sourceLine + previous.count === loc.line)
                previous.count++;
            else maps[name].push({ generatedLine: index + 1, sourceLine: loc.line, count: 1, file: loc.file });
        });
        hashes[name] = createHash('sha256').update(sources[name]).digest('hex');
    }
    return { sources, maps, hashes };
}
export function shaderBundle({ sources, maps, hashes }) {
    return '// Generated; edit shaders/*.wgsl and run npm run build.\n' +
        `export const SHADERS=${JSON.stringify(sources)};\n` +
        `export const SHADER_MAPS=${JSON.stringify(maps)};\n` +
        `export const SHADER_HASHES=${JSON.stringify(hashes)};\n`;
}
