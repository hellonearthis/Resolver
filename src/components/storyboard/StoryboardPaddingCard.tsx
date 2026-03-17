import React from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';
import { formatTime } from '../../utils/timelineUtils';

interface StoryboardPaddingCardProps {
    startTime: number;
    duration: number;
    onAdd: (startTime: number, duration: number) => void;
}

const StoryboardPaddingCard: React.FC<StoryboardPaddingCardProps> = ({ startTime, duration, onAdd }) => {
    const endTime = startTime + duration;

    return (
        <Tippy content="This is an empty slot in your timeline." placement="top" offset={[0, 48]}>
            <div 
                className="group aspect-[4/5] border-2 border-dashed border-gray-800/50 rounded-xl bg-gray-900/10 flex flex-col p-6 transition-all hover:border-indigo-500/30 hover:bg-indigo-900/5"
                style={{ padding: '5px' }}
            >
                <div className="flex justify-between items-center opacity-40">
                    <span className="text-[10px] font-mono text-gray-500">{formatTime(startTime)} → {formatTime(endTime)}</span>
                    <span className="text-[10px] font-mono text-gray-500">{duration.toFixed(1)}s</span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-full border border-gray-800 flex items-center justify-center text-gray-700 opacity-20 group-hover:opacity-100 group-hover:border-indigo-500 group-hover:text-indigo-400 transition-all">
                        <span className="text-xl">➕</span>
                    </div>
                    <p className="text-[9px] font-bold text-gray-700 uppercase tracking-widest group-hover:text-indigo-500 transition-colors">Empty Slot</p>
                    <Tippy content="Create a new shot to fill this temporal gap." placement="top" offset={[0, 48]}>
                        <button 
                            onClick={() => onAdd(startTime, duration)}
                            className="mt-2 bg-gray-800/50 hover:bg-indigo-600 text-gray-500 hover:text-white px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-all"
                        >
                            Fill Gap
                        </button>
                    </Tippy>
                </div>
            </div>
        </Tippy>
    );
};

export default StoryboardPaddingCard;
