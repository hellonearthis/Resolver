import React from 'react';
import { AppTooltip } from '../ui/Tooltip';
import { formatTime, pathToMediaUrl } from '../../utils/timelineUtils';

interface AnimaticTimelineProps {
    items: any[]; // Using any[] to match the mixed clip/padding structure
    onSelectCard: (id: string) => void;
    onAddPadding?: (startTime: number, duration: number) => void;
    compact?: boolean;
    className?: string;
}

const AnimaticTimeline: React.FC<AnimaticTimelineProps> = ({ items, onSelectCard, onAddPadding, compact = false, className = "" }) => {
    const totalDuration = Math.sumPrecise(items.map(item => item.duration || 0));
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    const scrollToItem = (index: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;
        // container -> .relative -> .clips-container -> .clip
        const itemElement = container.children[0]?.children[1]?.children[index] as HTMLElement;
        if (itemElement) {
            itemElement.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }
    };

    return (
        <div className={`flex flex-col h-full bg-[#050508] rounded-2xl border border-gray-800/80 overflow-hidden shadow-2xl ${className}`}>
            {/* Header / Stats */}
            {!compact && (
                <div className="px-6 py-4 bg-gray-900/40 border-b border-gray-800/50 flex justify-between items-center text-white">
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Animatic Sequence</span>
                        <div className="h-4 w-px bg-gray-700" />
                        <span className="text-xs font-mono text-indigo-400">{items.filter(i => i.type === 'clip').length} Shots</span>
                        <span className="text-xs font-mono text-emerald-400">{totalDuration.toFixed(1)}s Total</span>
                    </div>
                </div>
            )}

            {/* Timeline Scroll Area */}
            <div 
                ref={scrollContainerRef}
                className={`flex-1 overflow-x-auto overflow-y-hidden flex flex-col ${compact ? 'p-4' : 'p-8'} scroll-smooth`}
            >
                <div className="relative flex-1 min-w-full flex flex-col">
                    {/* Time Ruler (Dedicated Row) */}
                    <div className="vtb-ruler h-10 min-w-full relative border-b border-gray-800/40 mb-2 shrink-0">
                         {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => {
                             const time = i;
                             const isMajor = time % 5 === 0;
                             const left = time * 80;
                             if (left > totalDuration * 80 + 100) return null;
                             return (
                                 <div key={i} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${left}px`, transform: 'translateX(-50%)' }}>
                                     {/* Tick mark */}
                                     <div className={`w-px ${isMajor ? 'h-3 bg-indigo-500/50' : 'h-1.5 bg-gray-700/30'}`} />
                                     
                                     {/* Time label for major ticks */}
                                     {isMajor && <span className="text-[10px] text-indigo-400 font-mono mb-1 font-bold drop-shadow-sm">{formatTime(time)}</span>}
                                     
                                     {/* Background vertical line (guide) */}
                                     {isMajor && <div className="absolute top-[32px] w-px h-[500px] bg-indigo-500/5 z-0" />}
                                 </div>
                             );
                         })}
                    </div>

                    {/* Clips Container */}
                    <div className="flex items-end gap-1 relative flex-1">

                    {items.map((item, index) => {
                        // Width relative to duration (80px per second)
                        const width = (item.duration || 0.1) * 80;
                        
                        if (item.type === 'clip' && item.clip) {
                            const card = item.clip;
                            return (
                                <div 
                                    key={card.id}
                                    onClick={() => {
                                        onSelectCard(card.id);
                                        scrollToItem(index);
                                    }}
                                    className="group relative flex flex-col h-full transition-all cursor-pointer shrink-0"
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
                                             {card.notes?.dialogue || card.notes?.action || 'No notes...'}
                                         </p>
                                    </div>
                                    
                                    {/* Connector/Indicator */}
                                    {index < items.length - 1 && (
                                        <div className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-2 bg-indigo-500/20 rounded-full z-10 opacity-0 group-hover:opacity-100" />
                                    )}
                                </div>
                            );
                        } else {
                            // Padding / Gap rendering
                            return (
                                <div 
                                    key={`padding-${index}`}
                                    onClick={() => scrollToItem(index)}
                                    className="group/gap relative flex flex-col h-full shrink-0 cursor-pointer"
                                    style={{ width: `${width}px` }}
                                >
                                    <div className="h-16 border-2 border-dashed border-gray-800/30 rounded-lg mt-8 flex items-center justify-center group-hover/gap:border-indigo-500/20 transition-all">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAddPadding?.(item.startTime, item.duration);
                                            }}
                                            className="h-8 w-8 rounded-full bg-gray-900/50 text-gray-600 opacity-0 group-hover/gap:opacity-100 group-hover/gap:bg-indigo-900/20 group-hover/gap:text-indigo-400 transition-all flex items-center justify-center"
                                            title="Fill gap with new shot"
                                        >
                                            <span className="text-xs">➕</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                    })}
                    </div>
                </div>
            </div>

            {/* Global Timeline Rail */}
            <div className="h-12 bg-black border-t border-gray-800/80 px-6 flex items-center gap-1 overflow-hidden">
                 {items.map((item, idx) => {
                     const percent = ((item.duration || 0) / totalDuration) * 100;
                     const isGap = item.type === 'unselected';
                     
                     // Custom content for the timeline popup
                     const tooltipContent = (
                         <div className="flex flex-col gap-2 p-1 min-w-[140px]">
                             <div className="flex justify-between items-center gap-4">
                                 <span className="text-[11px] font-bold text-indigo-300">{isGap ? 'Gap' : item.label}</span>
                                 <span className="text-[10px] font-mono text-gray-400">{(item.duration || 0).toFixed(1)}s</span>
                             </div>
                             
                             {item.type === 'clip' && item.clip && (
                                 <div className="w-full aspect-video bg-black/40 rounded border border-white/10 overflow-hidden">
                                     {item.clip.startImagePath ? (
                                         <img 
                                             src={pathToMediaUrl(item.clip.startImagePath)} 
                                             alt="" 
                                             className="w-full h-full object-cover"
                                         />
                                     ) : (
                                         <div className="w-full h-full flex items-center justify-center opacity-20">
                                             <span>🖼️</span>
                                         </div>
                                     )}
                                 </div>
                             )}
                             
                             {item.type === 'clip' && item.clip && (
                                 <div className="text-[9px] text-gray-500 font-mono">
                                     Start: {formatTime(item.clip.startTime)}
                                 </div>
                             )}
                         </div>
                     );

                     return (
                         <AppTooltip 
                            key={`${item.type}-${idx}`} 
                            content={tooltipContent} 
                            placement="top" 
                            offset={[0, 48]}
                         >
                             <span className="contents">
                                 <div 
                                    onClick={() => scrollToItem(idx)}
                                    className={`h-2 rounded-full border cursor-pointer transition-all hover:brightness-125 hover:scale-y-150 ${isGap ? 'bg-gray-800/20 border-gray-800/30' : 'bg-indigo-600/30 border-indigo-500/20 hover:bg-indigo-500/50'}`}
                                    style={{ width: `${percent}%` }}
                                 />
                             </span>
                         </AppTooltip>
                     );
                 })}
            </div>
        </div>
    );
};

export default AnimaticTimeline;
