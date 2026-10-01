declare global {
    interface Math {
        sumPrecise(iterable: Iterable<number>): number;
    }
}

// WHAT: Polyfill for the ECMAScript Math.sumPrecise() standard library addition.
// WHY: Standard IEEE 754 floating point addition accumulates round-off error when summing
// long sequences of fractional numbers (such as timeline pixel offsets or audio sample lengths).
// Kahan compensated summation preserves the low-order bits that would otherwise be discarded.
if (typeof Math.sumPrecise !== 'function') {
    (Math as unknown as { sumPrecise: (iterable: Iterable<number>) => number }).sumPrecise = function(
        number_collection_iterable: Iterable<number>
    ): number {
        // WHAT: Convert the arbitrary iterable into a contiguous array of numbers.
        // WHY: Ensures indexed iteration and fast sequential processing.
        const input_numbers_array = Array.from(number_collection_iterable);
        
        let accumulated_sum = 0.0;
        // WHAT: Running error compensation accumulator for lost low-order precision bits.
        // WHY: Holds the small fractional difference between what was added and what was preserved.
        let lost_low_order_bits_compensation = 0.0;
        
        for (const current_iteration_number of input_numbers_array) {
            // WHAT: Subtract the previous round-off compensation from the incoming number.
            // WHY: Recovers the lost precision from the previous addition step.
            const compensated_current_number = current_iteration_number - lost_low_order_bits_compensation;
            
            // WHAT: Tentatively add the compensated number to our running sum.
            // WHY: High-order bits are preserved in accumulated_sum, but low-order bits may truncate.
            const tentative_accumulated_sum = accumulated_sum + compensated_current_number;
            
            // WHAT: Calculate the precision delta that was truncated during the addition.
            // WHY: (tentative_accumulated_sum - accumulated_sum) retrieves the high-order part of compensated_current_number.
            // Subtracting compensated_current_number leaves the exact truncated remainder (negated).
            lost_low_order_bits_compensation = (tentative_accumulated_sum - accumulated_sum) - compensated_current_number;
            
            accumulated_sum = tentative_accumulated_sum;
        }
        
        return accumulated_sum;
    };
}

export {};
