export function zeros(rows: number, cols: number): number[][] {
	return Array.from({ length: rows }, () => Array(cols).fill(0));
}

export function clamp(x: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, x));
}
