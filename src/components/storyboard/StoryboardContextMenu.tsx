import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { VideoClip } from '../../types/assembler';

export interface StoryboardContextMenuProps {
    card: VideoClip;
    position: { x: number; y: number };
    onClose: () => void;
    onDivide: (card: VideoClip, sectionsCount: number) => void;
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

    const totalDuration = card.duration || (card.endTime - card.startTime) || 1.0;
    const totalFrames = Math.round(totalDuration * frameRate);
    const maxSections = Math.min(16, Math.max(2, Math.floor(totalFrames / 2)));

    // Immediate viewport clamping
    const [clampedPosition, setClampedPosition] = useState<{ x: number; y: number }>(() => {
        const menuWidth = 320;
        const menuHeight = 440;
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
        const menuWidth = rect.width || 320;
        const menuHeight = rect.height || 440;

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
        onDivide(card, count);
        onClose();
    };

    const handleCustomDivideSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (customCount >= 2 && customCount <= maxSections) {
            onDivide(card, customCount);
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
                className="w-80 bg-[#10101b]/98 backdrop-blur-2xl border border-indigo-500/50 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-4 text-white flex flex-col gap-3 animate-in fade-in-0 zoom-in-95 duration-150 select-none"
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
            >
                {/* Header with Card Details */}
                <div className="flex items-start justify-between pb-2.5 border-b border-gray-800/80">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base text-indigo-400">➗</span>
                            <h4 className="text-sm font-bold text-white tracking-wide truncate max-w-[200px]">
                                Divide {card.label || 'Shot'}
                            </h4>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-gray-400">
                            <span className="px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 font-semibold border border-indigo-700/40">
                                ⏱️ {totalDuration.toFixed(2)}s
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

                {/* Section: Quick Divide Presets */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Quick Divide Presets
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                        {[2, 3, 4].map((count) => {
                            const partSec = (totalDuration / count).toFixed(2);
                            return (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => handleQuickDivide(count)}
                                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#181829] hover:bg-gradient-to-b hover:from-indigo-600/30 hover:to-indigo-900/40 border border-gray-700/60 hover:border-indigo-400 text-xs font-semibold text-gray-200 hover:text-white transition-all shadow-sm group cursor-pointer"
                                >
                                    <span className="text-sm font-bold group-hover:scale-110 transition-transform">
                                        {count} Parts
                                    </span>
                                    <span className="text-[10px] font-mono text-indigo-300/80 group-hover:text-indigo-200 mt-0.5">
                                        ~{partSec}s ea
                                    </span>
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

                {/* Section: Musical Beat Divide (if beats exist within card) */}
                {beatTimestamps && beatTimestamps.length > 0 && onDivideAtBeats && (
                    <div className="pt-1 border-t border-gray-800/60">
                        <button
                            type="button"
                            onClick={() => {
                                onDivideAtBeats(card, beatTimestamps);
                                onClose();
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 hover:border-purple-400 text-purple-200 hover:text-white transition-all text-xs font-semibold group cursor-pointer"
                        >
                            <span className="flex items-center gap-2">
                                <span className="group-hover:scale-110 transition-transform">🎵</span>
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
                            <span>📋</span> Duplicate
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
                            <span>{card.isMuted ? '🔊' : '🔇'}</span> {card.isMuted ? 'Unmute' : 'Mute'}
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
                            <span>🗑️</span>
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
