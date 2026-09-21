/** Bounded, reusable MAP_READ buffers. Buffers are never reused while mapped or in flight. */
export class ReadbackPool {
    constructor(create, { maxEntries = 4, maxBytes = 65536 } = {}) {
        if (typeof create !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 16)
            throw new TypeError('Invalid readback pool configuration.');
        this.create = create; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
        this.entries = []; this.bytes = 0; this.allocations = 0; this.reuses = 0; this.disposed = false;
    }
    acquire(size) {
        if (this.disposed) throw new Error('Readback pool is disposed.');
        if (!Number.isSafeInteger(size) || size < 4 || size % 4) throw new RangeError('Readback size must be a positive multiple of four.');
        const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, size)));
        if (capacity > this.maxBytes) throw new RangeError('Readback exceeds the bounded pool budget.');
        let entry = this.entries.filter(e => !e.busy && e.buffer.size >= capacity).sort((a,b) => a.buffer.size - b.buffer.size)[0];
        if (entry) this.reuses++;
        else {
            // Evict only idle slots, never a pending map/copy owned by another caller.
            while (this.entries.length >= this.maxEntries || this.bytes + capacity > this.maxBytes) {
                const index = this.entries.findIndex(e => !e.busy);
                if (index < 0) throw new Error('All bounded readback slots are busy.');
                const [old] = this.entries.splice(index, 1); this.bytes -= old.buffer.size; old.buffer.destroy();
            }
            const buffer = this.create(capacity); entry = { buffer, busy: false };
            this.entries.push(entry); this.bytes += buffer.size; this.allocations++;
        }
        entry.busy = true; let released = false;
        return { buffer: entry.buffer, release: () => {
            if (released) return; released = true;
            if (!this.disposed && entry.buffer.mapState === 'mapped') entry.buffer.unmap();
            entry.busy = false;
        }};
    }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        for (const entry of this.entries) entry.buffer.destroy();
        this.entries.length = 0; this.bytes = 0;
    }
}
