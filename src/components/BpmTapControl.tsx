/**
 * src/components/BpmTapControl.tsx
 * 
 * WHAT:
 *   Manual BPM adjustment and Tap Tempo calculator component.
 * 
 * WHY:
 *   Provides intuitive tempo controls for manual tempo overrides,
 *   tap tempo calibration, octave scaling (half-time/double-time),
 *   and rhythmic beat grid recalculation across project timelines.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface BpmTapControlProps {
    initialBpm?: number;
    currentBpm?: number;
    onBpmChange: (updated_tempo_beats_per_minute: number) => void;
    onApplyGrid: (target_tempo_beats_per_minute: number) => void;
    disabled?: boolean;
}

export const BpmTapControl: React.FC<BpmTapControlProps> = ({
    initialBpm,
    currentBpm = 120,
    onBpmChange,
    onApplyGrid,
    disabled = false
}) => {
    const effective_initial_bpm = initialBpm ?? currentBpm;
    const [tempo_beats_per_minute, setTempoBeatsPerMinute] = useState<number>(effective_initial_bpm);
    const [is_tap_pulse_active, setIsTapPulseActive] = useState<boolean>(false);
    const [tap_counter_display_text, setTapCounterDisplayText] = useState<string>('');
    const tap_timestamps_history_ref = useRef<number[]>([]);
    const reset_timeout_timer_ref = useRef<NodeJS.Timeout | null>(null);

    // Synchronize when initialBpm or currentBpm changes externally (e.g., after Essentia analysis)
    useEffect(() => {
        const external_bpm = initialBpm ?? currentBpm;
        if (external_bpm && external_bpm > 0 && Math.abs(external_bpm - tempo_beats_per_minute) > 0.05) {
            setTempoBeatsPerMinute(Number(external_bpm.toFixed(1)));
        }
    }, [initialBpm, currentBpm]);

    // WHAT: Handles interactive tempo tapping and calculates running delta average.
    // WHY: Converts physical tap rhythm into precise beats-per-minute tempo value.
    const handleTapTempoInteraction = useCallback(() => {
        if (disabled) return;

        const current_tap_timestamp_milliseconds = performance.now();
        setIsTapPulseActive(true);
        setTimeout(() => setIsTapPulseActive(false), 120);

        // Reset previous inactivity timer
        if (reset_timeout_timer_ref.current) {
            clearTimeout(reset_timeout_timer_ref.current);
        }

        // Set reset timer: resets tap history after 2.5 seconds of inactivity
        reset_timeout_timer_ref.current = setTimeout(() => {
            tap_timestamps_history_ref.current = [];
            setTapCounterDisplayText('');
        }, 2500);

        tap_timestamps_history_ref.current.push(current_tap_timestamp_milliseconds);
        const trimmed_timestamps_collection = tap_timestamps_history_ref.current.slice(-8);
        tap_timestamps_history_ref.current = trimmed_timestamps_collection;

        if (trimmed_timestamps_collection.length >= 2) {
            const interval_durations_collection: number[] = [];
            for (let index = 1; index < trimmed_timestamps_collection.length; index++) {
                interval_durations_collection.push(
                    trimmed_timestamps_collection[index] - trimmed_timestamps_collection[index - 1]
                );
            }

            const sum_of_intervals_milliseconds = interval_durations_collection.reduce(
                (total_accumulator, current_interval) => total_accumulator + current_interval,
                0
            );
            const average_interval_milliseconds = sum_of_intervals_milliseconds / interval_durations_collection.length;

            if (average_interval_milliseconds > 100 && average_interval_milliseconds < 3000) {
                const calculated_tempo_beats_per_minute = Number((60000 / average_interval_milliseconds).toFixed(1));
                setTempoBeatsPerMinute(calculated_tempo_beats_per_minute);
                onBpmChange(calculated_tempo_beats_per_minute);
                setTapCounterDisplayText(`Tap ${trimmed_timestamps_collection.length} (${calculated_tempo_beats_per_minute} BPM)`);
            }
        } else {
            setTapCounterDisplayText('First tap... keep tapping!');
        }
    }, [disabled, onBpmChange]);

    // WHAT: Fine-tunes tempo by adding or subtracting an arbitrary delta value.
    // WHY: Enables micro adjustments (±0.1) or integer adjustments (±1.0).
    const adjustTempoByDelta = (delta_amount: number) => {
        if (disabled) return;
        const new_tempo_value = Math.max(20, Math.min(300, Number((tempo_beats_per_minute + delta_amount).toFixed(1))));
        setTempoBeatsPerMinute(new_tempo_value);
        onBpmChange(new_tempo_value);
    };

    // WHAT: Scales tempo by an octave factor (0.5x for half-time, 2.0x for double-time).
    // WHY: Rapidly resolves octave ambiguities in automatic beat tracking.
    const scaleTempoByMultiplier = (multiplier_factor: number) => {
        if (disabled) return;
        const scaled_tempo_value = Math.max(20, Math.min(300, Number((tempo_beats_per_minute * multiplier_factor).toFixed(1))));
        setTempoBeatsPerMinute(scaled_tempo_value);
        onBpmChange(scaled_tempo_value);
    };

    // WHAT: Handles manual text entry in the BPM numeric input box.
    // WHY: Allows typing precise target tempos directly.
    const handleManualInputChange = (change_event: React.ChangeEvent<HTMLInputElement>) => {
        const raw_input_string = change_event.target.value;
        const parsed_float_value = parseFloat(raw_input_string);
        if (!isNaN(parsed_float_value)) {
            setTempoBeatsPerMinute(parsed_float_value);
            onBpmChange(parsed_float_value);
        } else if (raw_input_string === '') {
            setTempoBeatsPerMinute(0);
        }
    };

    return (
        <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
                    <span>⏱️</span> Tempo &amp; Beat Grid
                </span>
                {tap_counter_display_text && (
                    <span className="text-xs text-indigo-400 font-mono animate-fade-in">
                        {tap_counter_display_text}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                {/* Numeric Input & Steppers */}
                <div className="flex items-center bg-[#0d0d10] border border-gray-800 rounded-lg p-1">
                    <button
                        type="button"
                        onClick={() => adjustTempoByDelta(-1)}
                        disabled={disabled || tempo_beats_per_minute <= 20}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-40"
                        title="Decrease BPM by 1.0"
                    >
                        -1
                    </button>
                    <button
                        type="button"
                        onClick={() => adjustTempoByDelta(-0.1)}
                        disabled={disabled || tempo_beats_per_minute <= 20}
                        className="px-1.5 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-40"
                        title="Decrease BPM by 0.1"
                    >
                        -0.1
                    </button>

                    <div className="flex items-baseline px-2">
                        <input
                            type="number"
                            step="0.1"
                            min="20"
                            max="300"
                            value={tempo_beats_per_minute || ''}
                            onChange={handleManualInputChange}
                            disabled={disabled}
                            className="w-16 bg-transparent text-center font-mono font-bold text-base text-white focus:outline-none"
                        />
                        <span className="text-[11px] text-gray-500 font-mono">BPM</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => adjustTempoByDelta(0.1)}
                        disabled={disabled || tempo_beats_per_minute >= 300}
                        className="px-1.5 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-40"
                        title="Increase BPM by 0.1"
                    >
                        +0.1
                    </button>
                    <button
                        type="button"
                        onClick={() => adjustTempoByDelta(1)}
                        disabled={disabled || tempo_beats_per_minute >= 300}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-40"
                        title="Increase BPM by 1.0"
                    >
                        +1
                    </button>
                </div>

                {/* Octave Halving / Doubling Buttons */}
                <div className="flex items-center gap-1 bg-[#0d0d10] border border-gray-800 rounded-lg p-1">
                    <button
                        type="button"
                        onClick={() => scaleTempoByMultiplier(0.5)}
                        disabled={disabled || tempo_beats_per_minute <= 40}
                        className="px-2.5 py-1 text-xs text-indigo-300 hover:text-white hover:bg-indigo-950/50 rounded transition-colors disabled:opacity-40 font-mono"
                        title="Half-Time (÷2)"
                    >
                        ½×
                    </button>
                    <button
                        type="button"
                        onClick={() => scaleTempoByMultiplier(2)}
                        disabled={disabled || tempo_beats_per_minute >= 150}
                        className="px-2.5 py-1 text-xs text-indigo-300 hover:text-white hover:bg-indigo-950/50 rounded transition-colors disabled:opacity-40 font-mono"
                        title="Double-Time (×2)"
                    >
                        2×
                    </button>
                </div>

                {/* Interactive Tap Button */}
                <button
                    type="button"
                    onClick={handleTapTempoInteraction}
                    disabled={disabled}
                    className={`btn text-xs py-1.5 px-3 flex items-center gap-1.5 font-semibold transition-all select-none ${is_tap_pulse_active
                        ? 'bg-indigo-500 text-white scale-95 shadow-lg shadow-indigo-500/50'
                        : 'btn-secondary hover:border-indigo-500'
                    }`}
                >
                    <span className={`inline-block w-2 h-2 rounded-full ${is_tap_pulse_active ? 'bg-white' : 'bg-indigo-400'}`}></span>
                    🥁 Tap Tempo
                </button>

                {/* Apply Beat Grid Button */}
                <button
                    type="button"
                    onClick={() => onApplyGrid(tempo_beats_per_minute)}
                    disabled={disabled || tempo_beats_per_minute <= 0}
                    className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 ml-auto"
                    title="Regenerate timeline beat grid using this exact BPM"
                >
                    <span>⚡</span> Apply Grid
                </button>
            </div>
        </div>
    );
};

export default BpmTapControl;
