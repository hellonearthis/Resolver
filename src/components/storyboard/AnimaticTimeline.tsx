import React from 'react';
import { AppTooltip } from '../ui/Tooltip';
import { formatTime, pathToMediaUrl } from '../../utils/timelineUtils';
import type { StoryboardTimelineItem, TimelineClipItem } from '../../modules/StoryboardModule';
import { type MusicSection, SECTION_TYPE_COLOR_MAP } from '../../types/sections';

interface AnimaticTimelineProps {
    items: StoryboardTimelineItem[];
    sections?: MusicSection[];
    onSelectCard: (selected_card_identifier: string) => void;
    onCardContextMenu?: (event: React.MouseEvent, card: import('../../types/assembler').VideoClip) => void;
    onAddPadding?: (start_time_seconds: number, duration_seconds: number) => void;
    compact?: boolean;
    className?: string;
}

// WHAT: Horizontal animatic timeline scrubber displaying sequential storyboard panels, musical segments, and timing gaps.
// WHY: Gives directors and animators a bird's-eye view of scene pacing, shot distribution, song form, and unassigned timeline slots.
const AnimaticTimeline: React.FC<AnimaticTimelineProps> = ({ 
    items, 
    sections = [],
    onSelectCard, 
    onCardContextMenu,
    onAddPadding, 
    className = "" 
}) => {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    // WHAT: Derives sections from project sections or clips with assigned sectionName.
    // WHY: Guarantees song segments are displayed whether defined via section analysis or imported Fountain scenes.
    const displaySections = React.useMemo(() => {
        if (sections && sections.length > 0) return sections;

        const clipsWithSections = items
            .filter((it): it is TimelineClipItem => it.type === 'clip' && Boolean(it.clip.sectionName))
            .map(it => it.clip);
        if (clipsWithSections.length === 0) return [];

        const derived: MusicSection[] = [];
        let current_section: { name: string; type?: string; startTime: number; endTime: number } | null = null;

        for (const candidate_clip of clipsWithSections) {
            if (!current_section) {
                current_section = {
                    name: candidate_clip.sectionName!,
                    type: candidate_clip.sectionType,
                    startTime: candidate_clip.startTime,
                    endTime: candidate_clip.endTime
                };
            } else if (current_section.name === candidate_clip.sectionName) {
                current_section.endTime = Math.max(current_section.endTime, candidate_clip.endTime);
            } else {
                derived.push({
                    id: `derived-sec-${derived.length}`,
                    name: current_section.name,
                    type: (current_section.type as MusicSection['type']) || 'verse',
                    startTime: current_section.startTime,
                    endTime: current_section.endTime,
                    color: '#3b82f6'
                });
                current_section = {
                    name: candidate_clip.sectionName!,
                    type: candidate_clip.sectionType,
                    startTime: candidate_clip.startTime,
                    endTime: candidate_clip.endTime
                };
            }
        }

        if (current_section) {
            derived.push({
                id: `derived-sec-${derived.length}`,
                name: current_section.name,
                type: (current_section.type as MusicSection['type']) || 'verse',
                startTime: current_section.startTime,
                endTime: current_section.endTime,
                color: '#3b82f6'
            });
        }

        return derived;
    }, [sections, items]);

    const maxSectionEnd = displaySections.reduce((max, s) => Math.max(max, s.endTime || 0), 0);
    const itemsDuration = items.reduce((sum, timeline_item) => sum + (timeline_item.duration || 0), 0);
    const totalDuration = Math.max(itemsDuration, maxSectionEnd, 1.0);

    // WHAT: Scrolls the timeline view to center the clicked item.
    const scrollToItem = (target_index: number) => {
        const container_element = scrollContainerRef.current;
        if (!container_element) return;
        const target_item_element = container_element.querySelector(`[data-timeline-index="${target_index}"]`) as HTMLElement | null;
        if (target_item_element) {
            target_item_element.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }
    };

    // WHAT: Smoothly scrolls the timeline horizontally to a specific timestamp in seconds.
    const scrollToTime = (target_time_seconds: number) => {
        const container_element = scrollContainerRef.current;
        if (!container_element) return;
        const target_pixel = target_time_seconds * 80;
        container_element.scrollTo({ left: Math.max(0, target_pixel - 40), behavior: 'smooth' });
    };

    const getShotsCountForSection = React.useCallback((sec: MusicSection) => {
        return items.filter(
            (it): it is TimelineClipItem => it.type === 'clip' && (
                it.clip.sectionId === sec.id ||
                it.clip.sectionName === sec.name ||
                (!it.clip.sectionName && !it.clip.sectionId && it.clip.startTime >= sec.startTime && it.clip.startTime < sec.endTime)
            )
        ).length;
    }, [items]);

    return (
        <div className={`flex flex-col h-full bg-[#050508] rounded-2xl border border-gray-800/80 overflow-hidden shadow-2xl ${className}`}>
            {/* Header / Stats & Segment Pills */}
            <div className="px-4 py-2 bg-gray-900/40 border-b border-gray-800/50 flex justify-between items-center text-white shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Animatic Sequence</span>
                    <div className="h-3 w-px bg-gray-700" />
                    <span className="text-[11px] font-mono text-indigo-400">
                        {items.filter(timeline_item => timeline_item.type === 'clip').length} Shots
                    </span>
                    <div className="h-3 w-px bg-gray-700" />
                    <span className="text-[11px] font-mono text-emerald-400">{totalDuration.toFixed(1)}s Total</span>
                    {displaySections.length > 0 && (
                        <>
                            <div className="h-3 w-px bg-gray-700" />
                            <span className="text-[11px] font-mono text-purple-300 flex items-center gap-1 font-semibold">
                                <span>{displaySections.length} {displaySections.length === 1 ? 'Segment' : 'Segments'}</span>
                            </span>
                        </>
                    )}
                </div>

                {/* Quick Segment Jump Pills */}
                {displaySections.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto max-w-[55%] py-0.5">
                        {displaySections.map((sec) => {
                            const theme = SECTION_TYPE_COLOR_MAP[sec.type] || SECTION_TYPE_COLOR_MAP.verse;
                            const count = getShotsCountForSection(sec);
                            return (
                                <button
                                    key={sec.id}
                                    type="button"
                                    aria-label={sec.name}
                                    onClick={() => scrollToTime(sec.startTime)}
                                    className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border flex items-center gap-1.5 hover:brightness-125 transition-all shrink-0 cursor-pointer"
                                    style={{
                                        backgroundColor: theme.background,
                                        borderColor: theme.border,
                                        color: theme.text
                                    }}
                                    title={`Jump to ${sec.name} (${count} shots • ${sec.startTime.toFixed(1)}s – ${sec.endTime.toFixed(1)}s)`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.border }} />
                                    <span>{sec.name}</span>
                                    <span className="text-[8px] font-mono opacity-80 px-1 py-0.2 rounded bg-black/40">
                                        {count} {count === 1 ? 'shot' : 'shots'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Timeline Scroll Area */}
            <div 
                ref={scrollContainerRef}
                className="flex-1 overflow-x-auto overflow-y-hidden flex flex-col p-3 scroll-smooth"
            >
                <div className="relative flex-1 min-w-full flex flex-col">
                    {/* Time Ruler (Dedicated Row) */}
                    <div className="vtb-ruler h-6 min-w-full relative border-b border-gray-800/40 mb-1 shrink-0">
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
                                     <div className={`w-px ${is_major_tick ? 'h-2.5 bg-indigo-500/50' : 'h-1 bg-gray-700/30'}`} />
                                     
                                     {/* Time label for major ticks */}
                                     {is_major_tick && (
                                         <span className="text-[9px] text-indigo-400 font-mono mb-0.5 font-bold drop-shadow-sm">
                                             {formatTime(timestamp_seconds)}
                                         </span>
                                     )}
                                     
                                     {/* Background vertical line guide */}
                                     {is_major_tick && <div className="absolute top-[24px] w-px h-[300px] bg-indigo-500/5 z-0 pointer-events-none" />}
                                 </div>
                             );
                         })}
                    </div>

                    {/* Dedicated Sections / Segments Track */}
                    {displaySections.length > 0 && (
                        <div className="h-6 min-w-full relative border-b border-gray-800/60 mb-2 shrink-0 bg-[#07070d]/80 rounded-md overflow-hidden shadow-inner">
                            {displaySections.map((sec) => {
                                const left = sec.startTime * 80;
                                const width = Math.max(30, (sec.endTime - sec.startTime) * 80);
                                const theme = SECTION_TYPE_COLOR_MAP[sec.type] || SECTION_TYPE_COLOR_MAP.verse;
                                const durationSec = (sec.endTime - sec.startTime).toFixed(1);
                                const count = getShotsCountForSection(sec);
                                return (
                                    <div
                                        key={sec.id}
                                        onClick={() => scrollToTime(sec.startTime)}
                                        className="absolute top-0 bottom-0 flex items-center justify-between px-2 cursor-pointer transition-all hover:brightness-125 border-r group/sec select-none"
                                        style={{
                                            left: `${left}px`,
                                            width: `${width}px`,
                                            backgroundColor: theme.background,
                                            borderRightColor: theme.border,
                                            borderLeft: `3px solid ${theme.border}`,
                                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06)`
                                        }}
                                        title={`${sec.name} (${sec.type.toUpperCase()}) • ${sec.startTime.toFixed(1)}s - ${sec.endTime.toFixed(1)}s (${durationSec}s) • ${count} ${count === 1 ? 'shot' : 'shots'}`}
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: theme.border }} />
                                            <span className="text-[10px] font-bold text-white tracking-wide truncate group-hover/sec:text-indigo-200">
                                                {sec.name}
                                            </span>
                                            <span className="text-[8px] font-mono text-indigo-300 bg-black/60 px-1 py-0.2 rounded border border-white/10 shrink-0 font-medium leading-none">
                                                {count} {count === 1 ? 'shot' : 'shots'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-1">
                                            <span 
                                                className="text-[8px] font-bold uppercase px-1 py-0.2 rounded tracking-wider leading-none"
                                                style={{ color: theme.text, backgroundColor: 'rgba(0,0,0,0.5)' }}
                                            >
                                                {sec.type}
                                            </span>
                                            <span className="text-[8px] font-mono text-gray-400 group-hover/sec:text-white">
                                                {durationSec}s
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Clips Container */}
                    <div className="flex items-end relative flex-1">
                    {items.map((timeline_item, item_index) => {
                        const pixel_width = (timeline_item.duration || 0.1) * 80;
                        
                        if (timeline_item.type === 'clip') {
                            const active_card = timeline_item.clip;
                            return (
                                <div 
                                    key={active_card.id}
                                    data-timeline-index={item_index}
                                    onClick={() => {
                                        onSelectCard(active_card.id);
                                        scrollToItem(item_index);
                                    }}
                                    onContextMenu={(event) => {
                                        if (onCardContextMenu) {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onCardContextMenu(event, active_card);
                                        }
                                    }}
                                    className="group relative flex flex-col h-full transition-all cursor-pointer shrink-0 border-r border-indigo-950/60"
                                    style={{ width: `${pixel_width}px`, minWidth: `${Math.min(60, pixel_width)}px` }}
                                >
                                    {/* Thumbnail Label with Shot & Segment tag */}
                                    <div className="absolute top-0 left-0 right-0 bg-indigo-500/10 border-l border-indigo-500/30 px-2 py-1 flex justify-between items-center z-10">
                                        <div className="flex flex-col min-w-0 pr-1">
                                            <div className="flex items-center gap-1 truncate">
                                                <span className="text-[10px] font-bold text-indigo-300 truncate leading-none">{active_card.label}</span>
                                                {active_card.sectionName && (
                                                    <span className="text-[8px] font-bold uppercase px-1 py-0.2 rounded bg-indigo-950/90 text-indigo-200 border border-indigo-500/40 shrink-0 leading-none">
                                                        {active_card.sectionName}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[8px] text-indigo-500/50 font-mono leading-none mt-0.5">{formatTime(active_card.startTime)}</span>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {onCardContextMenu && (
                                                <button
                                                    type="button"
                                                    onClick={(click_event) => {
                                                        click_event.stopPropagation();
                                                        const rect = click_event.currentTarget.getBoundingClientRect();
                                                        onCardContextMenu({
                                                            clientX: rect.left,
                                                            clientY: rect.bottom + 6,
                                                            preventDefault: () => {},
                                                            stopPropagation: () => {}
                                                        } as React.MouseEvent, active_card);
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 hover:scale-110 text-[9px] p-1 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-500/40 transition-all cursor-pointer leading-none flex items-center justify-center"
                                                    title="Divide shot into smaller sections"
                                                >
                                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                                                        <circle cx="12" cy="5" r="2.5" />
                                                        <rect x="4" y="11" width="16" height="2" rx="1" />
                                                        <circle cx="12" cy="19" r="2.5" />
                                                    </svg>
                                                </button>
                                            )}
                                            <span className="text-[9px] text-indigo-500/70 font-mono">{(active_card.duration || 0).toFixed(1)}s</span>
                                        </div>
                                    </div>

                                    {/* Frame Image */}
                                    <div className="h-16 bg-black/40 border border-gray-800 group-hover:border-indigo-500/50 transition-colors overflow-hidden rounded-t-lg mt-7 flex items-center justify-center">
                                        {(active_card.startImagePath || active_card.endImagePath) ? (
                                            <img 
                                                src={pathToMediaUrl(active_card.startImagePath || active_card.endImagePath!)} 
                                                alt="" 
                                                className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" 
                                            />
                                        ) : (
                                            <svg className="w-6 h-6 text-gray-500 opacity-25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                                <circle cx="8.5" cy="8.5" r="1.5" />
                                                <path d="M21 15l-5-5L5 21" />
                                            </svg>
                                        )}
                                    </div>

                                    {/* Info bar */}
                                    <div className="h-7 bg-gray-900 border-x border-b border-gray-800 group-hover:bg-gray-800 transition-colors rounded-b-lg px-2 flex items-center overflow-hidden">
                                         <p className="text-[9px] text-gray-400 truncate italic w-full">
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
                                    data-timeline-index={item_index}
                                    onClick={() => scrollToItem(item_index)}
                                    className="group/gap relative flex flex-col h-full shrink-0 cursor-pointer"
                                    style={{ width: `${pixel_width}px` }}
                                >
                                    <div className="h-16 border-2 border-dashed border-gray-800/30 rounded-lg mt-7 flex items-center justify-center group-hover/gap:border-indigo-500/20 transition-all">
                                        <button 
                                            onClick={(click_event) => {
                                                click_event.stopPropagation();
                                                onAddPadding?.(timeline_item.startTime, timeline_item.duration);
                                            }}
                                            className="h-7 w-7 rounded-full bg-gray-900/50 text-gray-500 opacity-0 group-hover/gap:opacity-100 group-hover/gap:bg-indigo-900/20 group-hover/gap:text-indigo-400 transition-all flex items-center justify-center"
                                            title="Fill gap with new shot"
                                        >
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                <path d="M12 5v14M5 12h14" />
                                            </svg>
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
            <div className="bg-black border-t border-gray-800/80 px-4 py-1.5 flex flex-col gap-1 shrink-0 overflow-hidden">
                {/* Segments / Sections Mini-Ribbon */}
                {displaySections.length > 0 && (
                    <div className="w-full h-3.5 flex rounded overflow-hidden border border-gray-800/60 bg-[#07070d]">
                        {displaySections.map((sec) => {
                            const secWidthPct = Math.max(1, ((sec.endTime - sec.startTime) / totalDuration) * 100);
                            const theme = SECTION_TYPE_COLOR_MAP[sec.type] || SECTION_TYPE_COLOR_MAP.verse;
                            return (
                                <div
                                    key={`rail-sec-${sec.id}`}
                                    onClick={() => scrollToTime(sec.startTime)}
                                    style={{
                                        width: `${secWidthPct}%`,
                                        backgroundColor: theme.background,
                                        borderRight: `1px solid ${theme.border}`
                                    }}
                                    className="h-full flex items-center justify-center cursor-pointer hover:brightness-150 transition-all px-1 overflow-hidden"
                                    title={`${sec.name} (${sec.type.toUpperCase()}) • ${(sec.endTime - sec.startTime).toFixed(1)}s`}
                                >
                                    <span className="text-[8px] font-bold uppercase truncate tracking-tighter" style={{ color: theme.text }}>
                                        {sec.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Clips Mini-Track */}
                <div className="w-full h-2 flex items-center gap-0.5 overflow-hidden">
                    {items.map((timeline_item, item_index) => {
                        const duration_percentage = ((timeline_item.duration || 0) / totalDuration) * 100;
                        const is_gap = timeline_item.type === 'unselected';
                        
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
                                            <div className="w-full h-full flex items-center justify-center opacity-25 text-gray-500">
                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                                    <path d="M21 15l-5-5L5 21" />
                                                </svg>
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
                                       onContextMenu={(event) => {
                                           if (timeline_item.type === 'clip' && onCardContextMenu) {
                                               event.preventDefault();
                                               event.stopPropagation();
                                               onCardContextMenu(event, timeline_item.clip);
                                           }
                                       }}
                                       className={`h-2 rounded-full border cursor-pointer transition-all hover:brightness-125 hover:scale-y-150 ${is_gap ? 'bg-gray-800/20 border-gray-800/30' : 'bg-indigo-600/30 border-indigo-500/20 hover:bg-indigo-500/50'}`}
                                       style={{ width: `${duration_percentage}%` }}
                                    />
                                </span>
                            </AppTooltip>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default AnimaticTimeline;
