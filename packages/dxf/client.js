import { WORKER_SOURCE } from './worker-source.js';
/** Each request owns its worker. Packed ArrayBuffers transfer once; cancellation terminates work. */
export class DxfWorkerClient {
    constructor() { this.id = 0; this.worker = null; this.pending = null; }
    cancel() {
        const pending = this.pending;
        if (pending) pending.finish(new DOMException('DXF import cancelled', 'AbortError'));
        else if (this.worker) { this.worker.terminate(); this.worker = null; }
    }
    parse(buffer, font, { name = 'Drawing.dxf', onProgress = () => {}, preserveSource = false,
        regenerateDimensions = true, space = 'model', document = false, editMap = false, pageSize = 65536, maxEntities = 16000000 } = {}) {
        this.cancel();
        if (!(buffer instanceof ArrayBuffer)) return Promise.reject(new TypeError('DXF input must be an ArrayBuffer.'));
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            let worker, settled = false;
            const finish = (error, model) => {
                if (settled) return; settled = true;
                if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
                if (this.worker === worker) { this.worker = null; this.pending = null; }
                if (error) reject(error); else resolve(model);
            };
            try {
                const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
                try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
                this.worker = worker; this.pending = { finish };
                worker.onmessage = event => {
                    if (settled || this.worker !== worker || event.data.id !== id) return;
                    try {
                        if (event.data.progress) { onProgress(event.data.progress); return; }
                        if (event.data.error) finish(Object.assign(new Error(event.data.error.message), event.data.error));
                        else finish(null, event.data.model);
                    } catch (error) { finish(error); }
                };
                worker.onerror = event => finish(new Error(event.message || 'DXF worker failed.'));
                worker.postMessage({ id, buffer, font: { map: font.map }, name,
                    options: { preserveSource, regenerateDimensions, space, document, editMap, pageSize, maxEntities } }, [buffer]);
            } catch (error) { finish(error); }
        });
    }
}
