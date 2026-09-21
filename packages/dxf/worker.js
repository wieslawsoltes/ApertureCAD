import { parseDxf } from './index.js';
import { transferList } from '../model/index.js';
self.onmessage = event => { const { id, buffer, font, name, options = {} } = event.data; try {
    const model = parseDxf(buffer, font, { ...options, name, onProgress: progress => self.postMessage({ id, progress }) });
    self.postMessage({ id, model }, transferList(model));
}
catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message, line: error.line || 0 } });
} };
