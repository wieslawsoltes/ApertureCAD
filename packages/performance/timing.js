/** Timestamp values are nanoseconds, NOT a duration until both endpoints are validated.
 * Never turn an unwritten (zero) endpoint into uptime, clamp an invalid duration, or
 * substitute CPU wall time. Subtract in uint64/BigInt space before converting.
 */
export function decodeGpuInterval(begin, end, { wallUpperBoundMs = Infinity, maxDurationMs = 60000 } = {}) {
    const invalid = reason => ({ gpuMs: null, gpuTimingStatus: reason });
    if (typeof begin !== 'bigint' || typeof end !== 'bigint' || begin < 0n || end < 0n || begin > 0xffffffffffffffffn || end > 0xffffffffffffffffn) return invalid('invalid-endpoint');
    if (begin === 0n || end === 0n) return invalid('unwritten-timestamp');
    if (end < begin) return invalid('nonmonotonic-timestamp');
    if (!(maxDurationMs > 0) || !Number.isFinite(maxDurationMs)) return invalid('invalid-bound');
    const delta = end - begin;
    if (delta > BigInt(Math.floor(maxDurationMs * 1e6))) return invalid('implausible-interval');
    const gpuMs = Number(delta) / 1e6;
    // CPU submission-to-map time is only an upper-bound sanity check, never the metric.
    // Permit clock quantization / scheduling uncertainty without accepting GPU uptime.
    if (Number.isFinite(wallUpperBoundMs) && gpuMs > Math.max(0, wallUpperBoundMs) + 250) return invalid('inconsistent-clock');
    return { gpuMs, gpuTimingStatus: delta === 0n ? 'below-resolution' : 'valid' };
}
export function formatGpuTiming(metrics) {
    const value = metrics?.gpuMs;
    if (!Number.isFinite(value) || value < 0 || !['valid','below-resolution'].includes(metrics?.gpuTimingStatus)) return '—';
    return value < .01 ? '<0.01' : value.toFixed(2);
}
