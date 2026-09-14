import React from 'react';
import { AppTooltip } from '../ui/Tooltip';
import { formatTime, pathToMediaUrl } from '../../utils/timelineUtils';
import type { StoryboardTimelineItem } from '../../modules/StoryboardModule';

interface AnimaticTimelineProps {
    items: StoryboardTimelineItem[];
    onSelectCard: (selected_card_identifier: string) => void;
    onAddPadding?: (start_time_seconds: number, duration_seconds: number) => void;
    compact?: boolean;
    className?: string;
}

// WHAT: Horizontal animatic timeline scrubber displaying sequential storyboard panels and timing gaps.
// WHY: Gives animators a bird's-eye view of scene pacing, shot distribution, and unassigned timeline slots.
const AnimaticTimeline: React.FC<AnimaticTimelineProps> = ({ 
    items, 
    onSelectCard, 
    onAddPadding, 
    compact = false, 
    className = "" 
}) => {
    const totalDuration = Math.sumPrecise(items.map(timeline_item => timeline_item.duration || 0));
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    // WHAT: Scrolls the timeline view to center the clicked item.
    // WHY: Keeps active panels immediately visible and editable in long multi-minute music video sequences.
    const scrollToItem = (target_index: number) => {
        const container_element = scrollContainerRef.current;
        if (!container_element) return;
        // container -> .relative -> .clips-container -> .clip
        const target_item_element = container_element.children[0]?.children[1]?.children[target_index] as HTMLElement | undefined;
        if (target_item_element) {
            target_item_element.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
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
                        <span className="text-xs font-mono text-indigo-400">
                            {items.filter(timeline_item => timeline_item.type === 'clip').length} Shots
                        </span>
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
                         {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, second_index) => {
                             const timestamp_seconds = second_index;
                             const is_major_tick = timestamp_seconds % 5 === 0;
                             const pixel_offset_left = timestamp_seconds * 80;
                             if (pixel_offset_left > totalDuration * 80 + 100) return null;
                             return (
                                 <div 
                                     key={second_index} 
                                     className="absolute bottom-0 flex flex-col items-center" 
                                     style={{ left: `${pixel_offset_left}px`, transform: 'translateX(-50%)' }}
                                 >
                                     {/* Tick mark */}
                                     <div className={`w-px ${is_major_tick ? 'h-3 bg-indigo-500/50' : 'h-1.5 bg-gray-700/30'}`} />
                                     
                                     {/* Time label for major ticks */}
                                     {is_major_tick && (
                                         <span className="text-[10px] text-indigo-400 font-mono mb-1 font-bold drop-shadow-sm">
                                             {formatTime(timestamp_seconds)}
                                         </span>
                                     )}
                                     
                                     {/* Background vertical line (guide) */}
                                     {is_major_tick && <div className="absolute top-[32px] w-px h-[500px] bg-indigo-500/5 z-0" />}
                                 </div>
                             );
                         })}
                    </div>

                    {/* Clips Container */}
                    <div className="flex items-end gap-1 relative flex-1">
                    {items.map((timeline_item, item_index) => {
                        // Width relative to duration (80px per second)
                        const pixel_width = (timeline_item.duration || 0.1) * 80;
                        
                        if (timeline_item.type === 'clip') {
                            const active_card = timeline_item.clip;
                            return (
                                <div 
                                    key={active_card.id}
                                    onClick={() => {
                                        onSelectCard(active_card.id);
                                        scrollToItem(item_index);
                                    }}
                                    className="group relative flex flex-col h-full transition-all cursor-pointer shrink-0"
                                    style={{ width: `${pixel_width}px`, minWidth: '120px' }}
                                >
                                    {/* Thumbnail Label */}
                                    <div className="absolute top-0 left-0 right-0 bg-indigo-500/10 border-l border-indigo-500/30 px-2 py-1 flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-indigo-300 truncate pr-2 leading-none mb-0.5">{active_card.label}</span>
                                            <span className="text-[8px] text-indigo-500/50 font-mono leading-none">{formatTime(active_card.startTime)}</span>
                                        </div>
                                        <span className="text-[9px] text-indigo-500/70 font-mono">{(active_card.duration || 0).toFixed(1)}s</span>
                                    </div>

                                    {/* Frame Image */}
                                    <div className={`${compact ? 'h-16' : 'flex-1'} bg-black/40 border border-gray-800 group-hover:border-indigo-500/50 transition-colors overflow-hidden rounded-t-lg mt-8 flex items-center justify-center`}>
                                        {(active_card.startImagePath || active_card.endImagePath) ? (
                                            <img 
                                                src={pathToMediaUrl(active_card.startImagePath || active_card.endImagePath!)} 
                                                alt="" 
                                                className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" 
                                            />
                                        ) : (
                                            <span className="text-xl opacity-20">🖼️</span>
                                        )}
                                    </div>

                                    {/* Info bar */}
                                    <div className="h-10 bg-gray-900 border-x border-b border-gray-800 group-hover:bg-gray-800 transition-colors rounded-b-lg px-2 flex items-center overflow-hidden">
                                         <p className="text-[10px] text-gray-400 truncate italic w-full">
                                             {active_card.notes?.dialogue || active_card.notes?.action || 'No notes...'}
                                         </p>
                                    </div>
                                    
                                    {/* Connector/Indicator */}
                                    {item_index < items.length - 1 && (
                                        <div className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-2 bg-indigo-500/20 rounded-full z-10 opacity-0 group-hover:opacity-100" />
                                    )}
                                </div>
                            );
                        } else {
                            // Padding / Gap rendering
                            return (
                                <div 
                                    key={`padding-${item_index}`}
                                    onClick={() => scrollToItem(item_index)}
                                    className="group/gap relative flex flex-col h-full shrink-0 cursor-pointer"
                                    style={{ width: `${pixel_width}px` }}
                                >
                                    <div className="h-16 border-2 border-dashed border-gray-800/30 rounded-lg mt-8 flex items-center justify-center group-hover/gap:border-indigo-500/20 transition-all">
                                        <button 
                                            onClick={(click_event) => {
                                                click_event.stopPropagation();
                                                onAddPadding?.(timeline_item.startTime, timeline_item.duration);
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
                 {items.map((timeline_item, item_index) => {
                     const duration_percentage = ((timeline_item.duration || 0) / totalDuration) * 100;
                     const is_gap = timeline_item.type === 'unselected';
                     
                     // Custom content for the timeline popup
                     const tooltip_content = (
                         <div className="flex flex-col gap-2 p-1 min-w-[140px]">
                             <div className="flex justify-between items-center gap-4">
                                 <span className="text-[11px] font-bold text-indigo-300">{is_gap ? 'Gap' : timeline_item.label}</span>
                                 <span className="text-[10px] font-mono text-gray-400">{(timeline_item.duration || 0).toFixed(1)}s</span>
                             </div>
                             
                             {timeline_item.type === 'clip' && (
                                 <div className="w-full aspect-video bg-black/40 rounded border border-white/10 overflow-hidden">
                                     {(timeline_item.clip.startImagePath || timeline_item.clip.endImagePath) ? (
                                         <img 
                                             src={pathToMediaUrl(timeline_item.clip.startImagePath || timeline_item.clip.endImagePath!)} 
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
                             
                             {timeline_item.type === 'clip' && (
                                 <div className="text-[9px] text-gray-500 font-mono">
                                     Start: {formatTime(timeline_item.clip.startTime)}
                                 </div>
                             )}
                         </div>
                     );

                     return (
                         <AppTooltip 
                            key={`${timeline_item.type}-${item_index}`} 
                            content={tooltip_content} 
                            placement="top" 
                            offset={[0, 48]}
                         >
                             <span className="contents">
                                 <div 
                                    onClick={() => scrollToItem(item_index)}
                                    className={`h-2 rounded-full border cursor-pointer transition-all hover:brightness-125 hover:scale-y-150 ${is_gap ? 'bg-gray-800/20 border-gray-800/30' : 'bg-indigo-600/30 border-indigo-500/20 hover:bg-indigo-500/50'}`}
                                    style={{ width: `${duration_percentage}%` }}
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
