import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { VideoClip } from '../../types/assembler';

export interface BeatIntervalOption {
    interval: number;
    label: string;
    sub: string;
}

export const BEAT_INTERVALS: BeatIntervalOption[] = [
    { interval: 2, label: '2 Beats', sub: '1/2 Bar' },
    { interval: 4, label: '4 Beats', sub: '1 Bar' },
    { interval: 6, label: '6 Beats', sub: '1.5 Bars' },
    { interval: 8, label: '8 Beats', sub: '2 Bars' },
    { interval: 16, label: '16 Beats', sub: '4 Bars' },
];

/**
 * Calculates cut timestamps for dividing a card by musical beat intervals (e.g. 2, 4, 6, 8, 16 beats).
 * Cuts land strictly on beat timestamps inside the card.
 */
export function calculateBeatIntervalCutPoints(
    startTime: number,
    endTime: number,
    interval: number,
    beatTimestamps: number[],
    minSliverDuration: number = 0.2
): number[] {
    if (interval <= 0) return [];
    
    // Sort and filter beats strictly within card boundaries
    const validBeats = beatTimestamps
        .filter(t => t > startTime + 0.05 && t < endTime - 0.05)
        .sort((a, b) => a - b);

    if (validBeats.length < interval) return [];

    const cuts: number[] = [];
    // A cut occurs after every `interval` beats: index interval - 1, 2 * interval - 1, etc.
    for (let i = interval - 1; i < validBeats.length; i += interval) {
        const cutTime = validBeats[i];
        if (endTime - cutTime >= minSliverDuration) {
            cuts.push(cutTime);
        }
    }
    return cuts;
}

/**
 * Calculates cut timestamps for dividing a card into N sections,
 * snapping the cuts to the closest musical beats while guaranteeing chronological order.
 */
export function calculateSnappedBeatCutPoints(
    startTime: number,
    endTime: number,
    sectionsCount: number,
    beatTimestamps: number[],
    minSegmentDuration: number = 0.15
): number[] {
    if (sectionsCount < 2) return [];

    const neededCuts = sectionsCount - 1;
    const duration = endTime - startTime;

    // Ideal targets (e.g. for 4 sections: 25%, 50%, 75% of duration)
    const idealTargets = Array.from({ length: neededCuts }, (_, i) => 
        startTime + ((i + 1) / sectionsCount) * duration
    );

    // Filter beats strictly within card boundaries with clearance
    const validBeats = beatTimestamps
        .filter(t => t >= startTime + minSegmentDuration && t <= endTime - minSegmentDuration)
        .sort((a, b) => a - b);

    // If not enough beats to pick distinct cuts for every section, fallback to ideal cuts
    if (validBeats.length < neededCuts) {
        return idealTargets;
    }

    const m = validBeats.length;
    // dp[k][j]: minimum sum of deviations choosing k+1 cuts ending at validBeats[j]
    const dp: number[][] = Array.from({ length: neededCuts }, () => Array(m).fill(Infinity));
    const parent: number[][] = Array.from({ length: neededCuts }, () => Array(m).fill(-1));

    // Base case: first cut (k = 0)
    for (let j = 0; j < m; j++) {
        dp[0][j] = Math.abs(validBeats[j] - idealTargets[0]);
    }

    // Step for k = 1 to neededCuts - 1
    for (let k = 1; k < neededCuts; k++) {
        let bestPrevCost = Infinity;
        let bestPrevIdx = -1;

        for (let j = k; j < m; j++) {
            if (dp[k - 1][j - 1] < bestPrevCost) {
                bestPrevCost = dp[k - 1][j - 1];
                bestPrevIdx = j - 1;
            }

            if (bestPrevCost !== Infinity) {
                dp[k][j] = bestPrevCost + Math.abs(validBeats[j] - idealTargets[k]);
                parent[k][j] = bestPrevIdx;
            }
        }
    }

    // Pick best ending cut
    let bestFinalIdx = -1;
    let minFinalCost = Infinity;
    for (let j = neededCuts - 1; j < m; j++) {
        if (dp[neededCuts - 1][j] < minFinalCost) {
            minFinalCost = dp[neededCuts - 1][j];
            bestFinalIdx = j;
        }
    }

    if (bestFinalIdx === -1) {
        return idealTargets;
    }

    // Reconstruct cuts
    const result: number[] = [];
    let curr = bestFinalIdx;
    for (let k = neededCuts - 1; k >= 0; k--) {
        result.unshift(validBeats[curr]);
        curr = parent[k][curr];
    }

    return result;
}

export interface StoryboardContextMenuProps {
    card: VideoClip;
    position: { x: number; y: number };
    onClose: () => void;
    onDivide: (card: VideoClip, sectionsCount: number, customCutPoints?: number[]) => void;
    onDivideAtBeats?: (card: VideoClip, beatTimestamps: number[]) => void;
    onDuplicate?: (card: VideoClip) => void;
    onDelete?: (cardId: string) => void;
    onToggleMute?: (card: VideoClip) => void;
    beatTimestamps?: number[];
    frameRate?: number;
}

export const StoryboardContextMenu: React.FC<StoryboardContextMenuProps> = ({
    card,
    position,
    onClose,
    onDivide,
    onDivideAtBeats,
    onDuplicate,
    onDelete,
    onToggleMute,
    beatTimestamps = [],
    frameRate = 24
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [customCount, setCustomCount] = useState<number>(2);
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const [snapToBeats, setSnapToBeats] = useState<boolean>(beatTimestamps.length > 0);

    const totalDuration = card.duration || (card.endTime - card.startTime) || 1.0;
    const totalFrames = Math.round(totalDuration * frameRate);
    const maxSections = Math.min(16, Math.max(2, Math.floor(totalFrames / 2)));

    // Immediate viewport clamping
    const [clampedPosition, setClampedPosition] = useState<{ x: number; y: number }>(() => {
        const menuWidth = 340;
        const menuHeight = 540;
        const padding = 16;
        const x = typeof window !== 'undefined' 
            ? Math.max(padding, Math.min(position.x, (window.innerWidth || 1200) - menuWidth - padding))
            : position.x;
        const y = typeof window !== 'undefined' 
            ? Math.max(padding, Math.min(position.y, (window.innerHeight || 800) - menuHeight - padding))
            : position.y;
        return { x, y };
    });

    // Fine-tune clamping once measured
    useEffect(() => {
        if (!menuRef.current || typeof window === 'undefined') return;
        const rect = menuRef.current.getBoundingClientRect();
        const menuWidth = rect.width || 340;
        const menuHeight = rect.height || 540;

        const padding = 16;
        const x = Math.max(padding, Math.min(position.x, window.innerWidth - menuWidth - padding));
        const y = Math.max(padding, Math.min(position.y, window.innerHeight - menuHeight - padding));

        setClampedPosition({ x, y });
    }, [position]);

    // Delay mounting active dismissal to prevent the initiating right-click mouseup from instantly closing popup
    useEffect(() => {
        const mountTimer = setTimeout(() => {
            setIsMounted(true);
        }, 100);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            clearTimeout(mountTimer);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const handleQuickDivide = (count: number) => {
        if (snapToBeats && beatTimestamps.length >= count - 1) {
            const snappedCuts = calculateSnappedBeatCutPoints(card.startTime, card.endTime, count, beatTimestamps);
            onDivide(card, count, snappedCuts);
        } else {
            onDivide(card, count);
        }
        onClose();
    };

    const handleCustomDivideSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (customCount >= 2 && customCount <= maxSections) {
            if (snapToBeats && beatTimestamps.length >= customCount - 1) {
                const snappedCuts = calculateSnappedBeatCutPoints(card.startTime, card.endTime, customCount, beatTimestamps);
                onDivide(card, customCount, snappedCuts);
            } else {
                onDivide(card, customCount);
            }
            onClose();
        }
    };

    const handleDivideByBeatInterval = (interval: number) => {
        const cuts = calculateBeatIntervalCutPoints(card.startTime, card.endTime, interval, beatTimestamps);
        if (cuts.length > 0 && onDivideAtBeats) {
            onDivideAtBeats(card, cuts);
            onClose();
        }
    };

    const handleDivideAllBeats = () => {
        if (beatTimestamps.length > 0 && onDivideAtBeats) {
            onDivideAtBeats(card, beatTimestamps);
            onClose();
        }
    };

    const customPartDuration = totalDuration / customCount;
    const customPartFrames = Math.round(customPartDuration * frameRate);

    const menuContent = (
        <div className="storyboard-context-menu-container" style={{ position: 'fixed', inset: 0, zIndex: 99999 }}>
            {/* Backdrop for outside click dismissal */}
            <div 
                className="fixed inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in-0 duration-150"
                style={{ zIndex: 99999 }}
                onMouseDown={(downEvent) => {
                    if (!isMounted) return;
                    downEvent.stopPropagation();
                    onClose();
                }}
                onClick={(clickEvent) => {
                    if (!isMounted) return;
                    clickEvent.stopPropagation();
                    onClose();
                }}
                onContextMenu={(contextEvent) => {
                    contextEvent.preventDefault();
                    contextEvent.stopPropagation();
                    if (!isMounted) return;
                    onClose();
                }}
            />

            {/* Context Menu Popup Window */}
            <div
                ref={menuRef}
                role="dialog"
                aria-label={`Divide shot ${card.label}`}
                style={{
                    position: 'fixed',
                    left: `${clampedPosition.x}px`,
                    top: `${clampedPosition.y}px`,
                    zIndex: 100000
                }}
                className="w-84 max-h-[88vh] overflow-y-auto custom-scrollbar bg-[#10101b]/98 backdrop-blur-2xl border border-indigo-500/50 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-4 text-white flex flex-col gap-3 animate-in fade-in-0 zoom-in-95 duration-150 select-none"
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
            >
                {/* Header with Card Details */}
                <div className="flex items-start justify-between pb-2.5 border-b border-gray-800/80">
                    <div>
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6h.01M12 18h.01M5 12h14" />
                            </svg>
                            <h4 className="text-sm font-bold text-white tracking-wide truncate max-w-[200px]">
                                Divide {card.label || 'Shot'}
                            </h4>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-gray-400">
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 font-semibold border border-indigo-700/40">
                                <svg className="w-3 h-3 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>{totalDuration.toFixed(2)}s</span>
                            </span>
                            <span>{totalFrames} frames @ {frameRate}fps</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-white hover:bg-gray-800/60 w-6 h-6 rounded-lg flex items-center justify-center text-xs transition-colors cursor-pointer"
                        title="Close popup"
                    >
                        ✕
                    </button>
                </div>

                {/* Section: Beat Snapping Option (when beats exist in card) */}
                {beatTimestamps && beatTimestamps.length > 0 && (
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-purple-950/40 border border-purple-600/30 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={snapToBeats}
                                onChange={(e) => setSnapToBeats(e.target.checked)}
                                className="rounded text-purple-600 focus:ring-0 cursor-pointer w-3.5 h-3.5 accent-purple-500"
                            />
                            <span className="font-semibold text-purple-200 text-[11px]">
                                Snap cuts to musical beats
                            </span>
                        </label>
                        <span className="text-[10px] font-mono text-purple-300 bg-purple-900/60 px-1.5 py-0.5 rounded border border-purple-500/20">
                            {beatTimestamps.length} beats
                        </span>
                    </div>
                )}

                {/* Section: Quick Divide Presets */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Quick Divide Presets
                        </span>
                        {snapToBeats && beatTimestamps.length > 0 && (
                            <span className="text-[9px] text-purple-300 font-medium">
                                Snapping to beats
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {[2, 3, 4].map((count) => {
                            const partSec = (totalDuration / count).toFixed(2);
                            const canSnap = snapToBeats && beatTimestamps.length >= count - 1;
                            return (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => handleQuickDivide(count)}
                                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-xs font-semibold transition-all shadow-sm group cursor-pointer ${
                                        canSnap
                                            ? 'bg-[#181829] hover:bg-gradient-to-b hover:from-purple-900/40 hover:to-indigo-900/40 border-purple-600/50 hover:border-purple-400 text-purple-200 hover:text-white'
                                            : 'bg-[#181829] hover:bg-gradient-to-b hover:from-indigo-600/30 hover:to-indigo-900/40 border-gray-700/60 hover:border-indigo-400 text-gray-200 hover:text-white'
                                    }`}
                                >
                                    <span className="text-sm font-bold group-hover:scale-110 transition-transform">
                                        {count} Parts
                                    </span>
                                    <span className="text-[10px] font-mono text-indigo-300/80 group-hover:text-indigo-200 mt-0.5">
                                        ~{partSec}s ea
                                    </span>
                                    {canSnap && (
                                        <span className="text-[8px] font-bold uppercase tracking-wider text-purple-300/80 group-hover:text-purple-200 mt-0.5">
                                            on beats
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Section: Custom Division Stepper */}
                <form onSubmit={handleCustomDivideSubmit} className="flex flex-col gap-2 pt-1 border-t border-gray-800/60">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        <span>Custom Sections</span>
                        <span className="text-indigo-300 font-mono normal-case">
                            ~{customPartDuration.toFixed(2)}s ({customPartFrames}f)
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[#181829] border border-gray-700/60 rounded-xl p-1 gap-1 flex-1">
                            <button
                                type="button"
                                onClick={() => setCustomCount(prev => Math.max(2, prev - 1))}
                                disabled={customCount <= 2}
                                className="w-8 h-7 rounded-lg bg-gray-800/60 hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-gray-800/60 text-white font-bold text-sm flex items-center justify-center transition-all cursor-pointer"
                            >
                                −
                            </button>
                            <input
                                type="number"
                                min={2}
                                max={maxSections}
                                value={customCount}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val)) {
                                        setCustomCount(Math.max(2, Math.min(maxSections, val)));
                                    }
                                }}
                                className="w-full text-center bg-transparent border-none text-sm font-bold text-white focus:outline-none focus:ring-0 p-0 font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setCustomCount(prev => Math.min(maxSections, prev + 1))}
                                disabled={customCount >= maxSections}
                                className="w-8 h-7 rounded-lg bg-gray-800/60 hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-gray-800/60 text-white font-bold text-sm flex items-center justify-center transition-all cursor-pointer"
                            >
                                +
                            </button>
                        </div>

                        <button
                            type="submit"
                            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <span>Divide</span>
                        </button>
                    </div>
                </form>

                {/* Section: Musical Beat Divide (Intervals: 2, 4, 6, 8, 16 beats & All Beats) */}
                {beatTimestamps && beatTimestamps.length > 0 && onDivideAtBeats && (
                    <div className="flex flex-col gap-2 pt-1 border-t border-gray-800/60">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-purple-300">
                            <span className="flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5 text-purple-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                                <span>Divide by Beat Intervals</span>
                            </span>
                            <span className="text-gray-400 font-mono normal-case">
                                {beatTimestamps.length} beats inside
                            </span>
                        </div>

                        {/* Grid of 2, 4, 6, 8, 16 beats intervals */}
                        <div className="grid grid-cols-3 gap-1.5">
                            {BEAT_INTERVALS.map(({ interval, label, sub }) => {
                                const cuts = calculateBeatIntervalCutPoints(card.startTime, card.endTime, interval, beatTimestamps);
                                const isAvailable = cuts.length > 0;
                                const numSections = cuts.length + 1;
                                const avgDur = (totalDuration / numSections).toFixed(1);
                                return (
                                    <button
                                        key={interval}
                                        type="button"
                                        disabled={!isAvailable}
                                        onClick={() => handleDivideByBeatInterval(interval)}
                                        className={`flex flex-col items-center justify-center p-2 rounded-xl border text-xs font-semibold transition-all shadow-sm group ${
                                            isAvailable
                                                ? 'bg-[#181829] hover:bg-gradient-to-b hover:from-purple-900/40 hover:to-indigo-900/40 border-purple-700/50 hover:border-purple-400 text-gray-200 hover:text-white cursor-pointer'
                                                : 'bg-[#141420]/60 border-gray-800/40 text-gray-500 cursor-not-allowed opacity-40'
                                        }`}
                                        title={isAvailable ? `Divide into ${numSections} shots (${interval} beats each)` : `Needs at least ${interval} beats (this shot has ${beatTimestamps.length})`}
                                    >
                                        <span className="text-xs font-bold group-hover:scale-105 transition-transform">
                                            {label}
                                        </span>
                                        <span className="text-[9px] text-purple-400/80 group-hover:text-purple-300 font-medium">
                                            {sub}
                                        </span>
                                        {isAvailable ? (
                                            <span className="text-[10px] font-mono text-gray-400 group-hover:text-purple-200 mt-0.5">
                                                {numSections} cuts (~{avgDur}s)
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-mono text-gray-600 mt-0.5">
                                                n/a
                                            </span>
                                        )}
                                    </button>
                                );
                            })}

                        </div>

                        {/* Full-width Divide at Musical Beats button for direct 1-click access */}
                        <button
                            type="button"
                            onClick={handleDivideAllBeats}
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 hover:border-purple-400 text-purple-200 hover:text-white transition-all text-xs font-semibold group cursor-pointer"
                        >
                            <span className="flex items-center gap-2">
                                <svg className="w-3.5 h-3.5 text-purple-300 group-hover:scale-110 transition-transform shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                                <span>Divide at Musical Beats</span>
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-400/30">
                                {beatTimestamps.length + 1} cuts
                            </span>
                        </button>
                    </div>
                )}

                {/* Quick Shot Operations (Duplicate, Mute, Delete) */}
                <div className="pt-2 border-t border-gray-800/80 flex items-center justify-between gap-1.5">
                    {onDuplicate && (
                        <button
                            type="button"
                            onClick={() => {
                                onDuplicate(card);
                                onClose();
                            }}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-[#181829] hover:bg-gray-700/60 text-gray-300 hover:text-white border border-gray-700/50 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                            title="Duplicate this shot"
                        >
                            <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Duplicate</span>
                        </button>
                    )}

                    {onToggleMute && (
                        <button
                            type="button"
                            onClick={() => {
                                onToggleMute(card);
                                onClose();
                            }}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-[#181829] hover:bg-gray-700/60 text-gray-300 hover:text-white border border-gray-700/50 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                            title="Toggle Alternate/Mute take"
                        >
                            {card.isMuted ? (
                                <svg className="w-3.5 h-3.5 text-purple-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                </svg>
                            ) : (
                                <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                            )}
                            <span>{card.isMuted ? 'Unmute' : 'Mute'}</span>
                        </button>
                    )}

                    {onDelete && (
                        <button
                            type="button"
                            onClick={() => {
                                onDelete(card.id);
                                onClose();
                            }}
                            className="py-1.5 px-2.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-700/40 text-[11px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer"
                            title="Delete this shot"
                        >
                            <svg className="w-3.5 h-3.5 text-red-400 group-hover:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    // If running in DOM environment, render via Portal to document.body
    if (typeof document !== 'undefined' && document.body) {
        return createPortal(menuContent, document.body);
    }
    return menuContent;
};

export default StoryboardContextMenu;
