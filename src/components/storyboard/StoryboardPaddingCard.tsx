import React, { useState } from 'react';
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
    const [inputDuration, setInputDuration] = useState<string>("6.0");

    const handleAddClick = () => {
        const parsedDuration = parseFloat(inputDuration);
        if (!isNaN(parsedDuration) && parsedDuration > 0) {
            onAdd(startTime, parsedDuration);
        }
    };

    return (
        <Tippy content="This is an empty slot in your timeline. Click to fill." placement="top" offset={[0, 48]}>
            <span className="block h-full cursor-pointer" onClick={(e) => { e.stopPropagation(); handleAddClick(); }}>
                <div 
                    className="group aspect-[4/5] border-2 border-dashed border-gray-800/50 rounded-xl bg-gray-900/10 flex flex-col p-6 transition-all hover:border-indigo-500/30 hover:bg-indigo-900/5"
                    style={{ padding: '5px' }}
                >
                    <div className="flex justify-between items-center opacity-40">
                        <span className="text-[10px] font-mono text-gray-500">{formatTime(startTime)} → {formatTime(endTime)}</span>
                        <span className="text-[10px] font-mono text-gray-500">{duration.toFixed(1)}s</span>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                        <div className="w-12 h-12 rounded-full border border-gray-800 flex items-center justify-center text-gray-700 opacity-20 group-hover:opacity-100 group-hover:border-indigo-500 group-hover:text-indigo-400 transition-all shadow-lg hover:scale-110 cursor-pointer mb-1">
                            <span className="text-xl">➕</span>
                        </div>
                        <p className="text-[9px] font-bold text-gray-700 uppercase tracking-widest group-hover:text-indigo-500 transition-colors">Empty Slot</p>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all" onClick={(e) => e.stopPropagation()}>
                            <input 
                                type="number" 
                                value={inputDuration} 
                                onChange={(e) => setInputDuration(e.target.value)}
                                className="w-12 bg-black/60 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-center focus:outline-none focus:border-indigo-500 text-indigo-300 font-mono"
                                step="0.1"
                                min="0.1"
                            />
                            <span className="text-[9px] text-gray-500 font-bold uppercase">sec</span>
                        </div>

                        <Tippy content="Create a new shot to fill this temporal gap." placement="top" offset={[0, 48]}>
                            <span>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleAddClick();
                                    }}
                                    className="mt-1 bg-gray-800/50 hover:bg-indigo-600 text-gray-500 hover:text-white px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    Add Card
                                </button>
                            </span>
                        </Tippy>
                    </div>
                </div>
            </span>
        </Tippy>
    );
};

export default StoryboardPaddingCard;
