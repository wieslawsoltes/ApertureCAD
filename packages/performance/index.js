/** Camera-only invalidation. No entity inspection, CPU culling, or geometry readback. */
export class FramePlanner {
    constructor({ guardBand = 0.25, cache = true, batch = true } = {}) {
        if (!Number.isFinite(guardBand) || guardBand < 0 || guardBand > 1) throw new RangeError('guardBand must be between 0 and 1.');
        this.guardBand = guardBand; this.cache = cache; this.batch = batch;
        this.revision = 0; this.windows = new WeakMap(); this.baseKey = ''; this.overlayKey = '';
    }
    invalidate() { this.revision++; this.baseKey = ''; this.overlayKey = ''; this.windows = new WeakMap(); }
    invalidatePages(pages) { this.baseKey = ''; this.overlayKey = ''; for (const page of pages) this.windows.delete(page); }
    key(frame) {
        const { camera: c, width, height, settings: s, flags, ratio, fontRevision = 0 } = frame;
        return [this.revision, c.x, c.y, c.zoom, c.angle || 0, width, height, ratio, s.textLOD, s.curveTolerance,
            s.strokeWidth, flags & 2, fontRevision, this.batch].join('|');
    }
    plan(frame, { overlayRevision = 0, exact = false } = {}) {
        const baseKey = this.key(frame), overlayKey = baseKey + ':' + overlayRevision;
        const base = exact || !this.cache || baseKey !== this.baseKey;
        const overlay = exact || !this.cache || overlayKey !== this.overlayKey;
        return { base, overlay, baseKey, overlayKey, exact };
    }
    commit(plan) { this.baseKey = plan.baseKey; this.overlayKey = plan.overlayKey; }
    visibility(page, frame) {
        const { camera: c, width, height, ratio } = frame;
        const x = width / (2 * c.zoom * ratio), y = height / (2 * c.zoom * ratio), co = Math.abs(Math.cos(c.angle || 0)), si = Math.abs(Math.sin(c.angle || 0));
        const hx = co*x+si*y, hy = si*x+co*y;
        const old = this.windows.get(page);
        const stroke = frame.settings.strokeWidth, textLOD = frame.settings.textLOD, textMode = frame.flags & 2, font = frame.fontRevision || 0;
        // Queue classification is view dependent: changed zoom always rebuilds both queues.
        if (this.cache && old && old.revision === this.revision && old.zoom === c.zoom && old.angle === (c.angle || 0) && old.ratio === ratio &&
            old.stroke === stroke && old.textLOD === textLOD && old.textMode === textMode && old.font === font && old.batch === this.batch &&
            c.x - hx >= old.x0 && c.x + hx <= old.x1 && c.y - hy >= old.y0 && c.y + hy <= old.y1)
            return false;
        const guard = 1 + 2 * this.guardBand;
        this.windows.set(page, { x0: c.x - hx * guard, x1: c.x + hx * guard,
            y0: c.y - hy * guard, y1: c.y + hy * guard, zoom: c.zoom, angle: c.angle || 0, revision: this.revision, ratio, stroke, textLOD, textMode, font, batch: this.batch });
        return true;
    }
}
/** Wall time is not GPU time. Report each sample series with its own definition. */
export function summarizeSamples(values) {
    if (!Array.isArray(values) || values.some(v => !Number.isFinite(v) || v < 0))
        throw new TypeError('Timing samples must be finite non-negative numbers.');
    if (!values.length) return { count: 0, min: null, median: null, p95: null, p99: null, max: null, mean: null };
    const a = [...values].sort((x, y) => x - y), percentile = p => a[Math.max(0, Math.ceil(p * a.length) - 1)];
    return { count: a.length, min: a[0], median: percentile(.5), p95: percentile(.95), p99: percentile(.99),
        max: a.at(-1), mean: a.reduce((s, v) => s + v, 0) / a.length };
}
/** Opt-in governor; never conflates adaptive-resolution samples with exact-quality samples. */
export class ResolutionGovernor {
    constructor({ targetMs = 12, minScale = .5, maxScale = 1, interval = 24 } = {}) {
        if (![targetMs, minScale, maxScale].every(Number.isFinite) || !(targetMs > 0) || !(minScale > 0) || minScale > maxScale || maxScale > 1 || !Number.isInteger(interval) || interval < 1)
            throw new RangeError('Invalid resolution governor options.');
        this.targetMs = targetMs; this.minScale = minScale; this.maxScale = maxScale;
        this.interval = interval; this.scale = maxScale; this.samples = []; this.cooldown = 0;
    }
    sample(gpuMs) {
        if (!(gpuMs > 0) || !Number.isFinite(gpuMs)) return null;
        this.samples.push(gpuMs); if (this.samples.length < this.interval) return null;
        const { p95 } = summarizeSamples(this.samples); this.samples.length = 0;
        if (this.cooldown-- > 0) return null;
        const factor = Math.sqrt(this.targetMs / p95);
        if (factor >= .94 && factor <= 1.12) return null;
        const next = Math.max(this.minScale, Math.min(this.maxScale, this.scale * Math.max(.8, Math.min(1.1, factor))));
        if (Math.abs(next - this.scale) < .025) return null;
        this.scale = Math.round(next * 100) / 100; this.cooldown = 1; return this.scale;
    }
}
