import React from 'react';
import type { VideoClip } from '../../types/assembler';
import { formatTime, pathToMediaUrl } from '../../utils/timelineUtils';

interface AnimaticTimelineProps {
    cards: VideoClip[];
    onSelectCard: (id: string) => void;
    compact?: boolean;
    className?: string;
}

const AnimaticTimeline: React.FC<AnimaticTimelineProps> = ({ cards, onSelectCard, compact = false, className = "" }) => {
    const totalDuration = cards.reduce((sum, card) => sum + (card.duration || 0), 0);

    return (
        <div className={`flex flex-col h-full bg-[#050508] rounded-2xl border border-gray-800/80 overflow-hidden shadow-2xl ${className}`}>
            {/* Header / Stats */}
            {!compact && (
                <div className="px-6 py-4 bg-gray-900/40 border-b border-gray-800/50 flex justify-between items-center text-white">
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Animatic Sequence</span>
                        <div className="h-4 w-px bg-gray-700" />
                        <span className="text-xs font-mono text-indigo-400">{cards.length} Shots</span>
                        <span className="text-xs font-mono text-emerald-400">{totalDuration.toFixed(1)}s Total</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-white" title="Play Animatic">▶️</button>
                        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-white" title="Stop">⏹️</button>
                    </div>
                </div>
            )}

            {/* Timeline Scroll Area */}
            <div className={`flex-1 overflow-x-auto overflow-y-hidden flex items-end ${compact ? 'p-4' : 'p-8'}`}>
                <div className="flex h-full min-w-full items-end gap-1 relative">
                    {/* Time markers background */}
                    <div className="absolute top-0 left-0 right-0 h-full pointer-events-none opacity-5">
                         {/* TODO: Add a proper grid/ruler here */}
                    </div>

                    {cards.map((card, index) => {
                        // Width relative to duration (e.g. 100px per second)
                        const width = (card.duration || 2.0) * 80;
                        
                        return (
                            <div 
                                key={card.id}
                                onClick={() => onSelectCard(card.id)}
                                className="group relative flex flex-col h-full transition-all cursor-pointer"
                                style={{ width: `${width}px`, minWidth: '120px' }}
                            >
                                {/* Thumbnail Label */}
                                <div className="absolute top-0 left-0 right-0 bg-indigo-500/10 border-l border-indigo-500/30 px-2 py-1 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-indigo-300 truncate pr-2 leading-none mb-0.5">{card.label}</span>
                                        <span className="text-[8px] text-indigo-500/50 font-mono leading-none">{formatTime(card.startTime)}</span>
                                    </div>
                                    <span className="text-[9px] text-indigo-500/70 font-mono">{(card.duration || 0).toFixed(1)}s</span>
                                </div>

                                {/* Frame Image */}
                                <div className={`${compact ? 'h-16' : 'flex-1'} bg-black/40 border border-gray-800 group-hover:border-indigo-500/50 transition-colors overflow-hidden rounded-t-lg mt-8 flex items-center justify-center`}>
                                    {card.startImagePath ? (
                                        <img src={pathToMediaUrl(card.startImagePath)} alt="" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                                    ) : (
                                        <span className="text-xl opacity-20">🖼️</span>
                                    )}
                                </div>

                                {/* Info bar */}
                                <div className="h-10 bg-gray-900 border-x border-b border-gray-800 group-hover:bg-gray-800 transition-colors rounded-b-lg px-2 flex items-center overflow-hidden">
                                     <p className="text-[10px] text-gray-400 truncate italic w-full">
                                         {card.notes?.dialogue || card.notes?.action || (card as any).dialogue || (card as any).actionNotes || (card as any).promptText || 'No notes...'}
                                     </p>
                                </div>
                                
                                {/* Connector/Indicator */}
                                {index < cards.length - 1 && (
                                    <div className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-2 bg-indigo-500/20 rounded-full z-10 opacity-0 group-hover:opacity-100" />
                                )}
                            </div>
                        );
                    })}
                    
                 </div>
            </div>

            {/* Global Timeline Rail */}
            <div className="h-12 bg-black border-t border-gray-800/80 px-6 flex items-center gap-1 overflow-hidden">
                 {cards.map(card => {
                     const percent = ((card.duration || 0) / totalDuration) * 100;
                     return (
                         <div 
                            key={card.id}
                            className="h-2 rounded-full bg-indigo-600/30 border border-indigo-500/20"
                            style={{ width: `${percent}%` }}
                         />
                     );
                 })}
            </div>
        </div>
    );
};

export default AnimaticTimeline;
