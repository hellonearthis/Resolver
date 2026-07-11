
import { describe, it, expect } from 'vitest';

describe('Math.sumPrecise', () => {
    it('should sum floating point numbers accurately', () => {
        const result = Math.sumPrecise([0.1, 0.2, 0.3, 0.4]);
        expect(result).toBe(1.0);
    });

    it('should handle large arrays', () => {
        const values = Array(100).fill(0.1);
        const result = Math.sumPrecise(values);
        expect(result).toBeCloseTo(10, 10);
    });

    it('should return 0 for an empty array', () => {
        expect(Math.sumPrecise([])).toBe(0);
    });
});
