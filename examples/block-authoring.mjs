/** Dependency-free semantic authoring example.
 * node examples/block-authoring.mjs /absolute/path/valve-array.dxf
 * File writing here is an explicit CLI action; the browser uses a local download.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BlockDrawing } from '../packages/blocks/document.js';
import { engineeringLibrary } from '../packages/blocks/library.js';

const output = path.resolve(process.argv[2] || 'valve-array.dxf');
const drawing = new BlockDrawing(null, { name: path.basename(output) });
drawing.transaction('Create valve array', () => {
  drawing.importLibrary(engineeringLibrary(), { conflict: 'rename' });
  drawing.addAttribute('VALVE_GATE', {
    tag: 'SERVICE', prompt: 'Service', value: 'STEAM',
    x: -5, y: -10, height: 2.5,
  });
  drawing.insert('VALVE_GATE', {
    position: [100, 200, 0], scale: [-2, 3, 1], rotation: 30,
    rows: 2, columns: 3, rowSpacing: 60, columnSpacing: 80,
    layer: '0', space: 'model', attributes: { TAG: 'V-204', SERVICE: 'AIR' },
  });
});
await fs.writeFile(output, drawing.write(), { encoding: 'utf8', flag: 'wx' });
console.log(`Created ${output}. Open it in Aperture CAD. Existing files are never overwritten.`);
