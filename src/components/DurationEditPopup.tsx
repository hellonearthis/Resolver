import React, { useState, useEffect, useRef } from 'react';
import { getAlignedDuration, formatTime } from '../utils/timelineUtils';

interface DurationEditPopupProps {
    clipId: string;
    initialDuration: number;
    startTime: number;
    frameRate: number;
    position: { x: number, y: number };
    onSave: (clipId: string, newDuration: number) => void;
    onClose: () => void;
}

const DurationEditPopup: React.FC<DurationEditPopupProps> = ({
    clipId,
    initialDuration,
    startTime,
    frameRate,
    position,
    onSave,
    onClose
}) => {
    const [duration, setDuration] = useState(initialDuration);
    const popupRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const handleSave = () => {
        const aligned = getAlignedDuration(duration, frameRate);
        onSave(clipId, aligned);
        onClose();
    };

    const jumpFrames = (delta: number) => {
        const current = duration;
        // approx jump step based on FPS (e.g. 17 frames for Minimax)
        const step = 17 / frameRate;
        const next = Math.max(0.1, getAlignedDuration(current + (delta * step) + (delta > 0 ? 0.01 : -0.01), frameRate));
        setDuration(next);
    };

    return (
        <div 
            ref={popupRef}
            className="fixed z-[9999] bg-[#1a1a2e] border border-indigo-500/50 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-4 flex flex-col gap-3 min-w-[200px] animate-in fade-in zoom-in duration-150"
            style={{ 
                left: Math.min(window.innerWidth - 220, position.x), 
                top: Math.min(window.innerHeight - 200, position.y) 
            }}
        >
            <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Edit Duration</span>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
            </div>

            <div className="space-y-3">
                <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">Seconds (Aligned)</label>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number"
                            step={1/frameRate}
                            value={duration.toFixed(2)}
                            onChange={(e) => setDuration(parseFloat(e.target.value) || 0.1)}
                            className="bg-black/40 border border-gray-700/50 rounded px-2 py-1 text-sm font-mono text-indigo-200 outline-none focus:border-indigo-500 flex-1"
                            autoFocus
                        />
                        <span className="text-xs text-gray-500 font-bold">s</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button 
                        onClick={() => jumpFrames(-1)}
                        className="flex-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-400 border border-gray-700 transition-all"
                    >
                        -17 Frames
                    </button>
                    <button 
                        onClick={() => jumpFrames(1)}
                        className="flex-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-400 border border-gray-700 transition-all"
                    >
                        +17 Frames
                    </button>
                </div>

                <div className="pt-2 border-t border-gray-800/50 flex flex-col gap-1 text-[10px]">
                    <div className="flex justify-between">
                        <span className="text-gray-500">Resulting End:</span>
                        <span className="text-gray-300 font-mono italic">{formatTime(startTime + duration)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Model Frames:</span>
                        <span className="text-amber-500 font-black italic">{Math.round(duration * frameRate)}</span>
                    </div>
                </div>

                <button 
                    onClick={handleSave}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition-all shadow-[0_4px_12px_rgba(79,70,229,0.3)] mt-1"
                >
                    Apply Changes
                </button>
            </div>
        </div>
    );
};

export default DurationEditPopup;
