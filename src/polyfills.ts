
/**
 * Polyfill for Math.sumPrecise() (ES2026)
 * Based on the proposal to provide more accurate floating-point summation.
 */
if (typeof Math.sumPrecise !== 'function') {
    (Math as any).sumPrecise = function(iterable: Iterable<number>): number {
        const values = Array.from(iterable);
        
        // Use Kahan summation for better precision than a simple reduce
        let sum = 0.0;
        let c = 0.0; // A running compensation for lost low-order bits.
        
        for (const x of values) {
            const y = x - c;
            const t = sum + y;
            c = (t - sum) - y;
            sum = t;
        }
        
        return sum;
    };
    console.log('[Polyfill] Math.sumPrecise initialized.');
}
