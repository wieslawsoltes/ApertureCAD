/** The optional paper cache stores no duplicate geometry and has a hard byte budget. */
export function paperQueueBytes(count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 0x00ff0000) throw new RangeError('Invalid paper queue entity count.');
    return count * 4 + 64 + 48;
}
// Fields consumed by coverage kernels: camera, local extent/scale/DPR, quality,
// text mode, batching, view rotation. Destination origin and global canvas dimensions
// are deliberately excluded: copyViewport applies those AFTER exact cached coverage.
const COVERAGE_WORDS = new Uint8Array([0,1,2,3,4,5,6,7,8,9,10,11,13,21,24,25]);
export class PaperRasterState {
    constructor() { this.words = new Uint32Array(32); this.valid = false; this.revision = -1; }
    matches(words, revision) {
        if (!this.valid || this.revision !== revision) return false;
        for (const i of COVERAGE_WORDS) if (this.words[i] !== words[i]) return false;
        return true;
    }
    commit(words, revision) { this.words.set(words); this.revision = revision; this.valid = true; }
    invalidate() { this.valid = false; }
}
