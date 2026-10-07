/**
 * src/components/SectionTimelineBar.tsx
 * 
 * WHAT:
 *   Visual timeline ribbon displaying musical sections (Intro, Verse, Chorus, Bridge, Outro).
 * 
 * WHY:
 *   Visualizes song form across the timeline with color coding, lets users inspect and edit
 *   section boundaries, and enables pushing colored section markers to DaVinci Resolve.
 */

import React, { useState } from 'react';
import { type MusicSection, SECTION_TYPE_COLOR_MAP, type SectionType } from '../types/sections';

interface SectionTimelineBarProps {
    sections: MusicSection[];
    totalDuration: number;
    currentTime?: number;
    onSectionClick?: (section_item: MusicSection) => void;
    onUpdateSection?: (updated_section: MusicSection) => void;
    onDeleteSection?: (section_identifier: string) => void;
    onDetectSections?: () => void;
    onPushSectionsToResolve?: () => void;
    onAddSectionsToTimeline?: () => void;
    isDetecting?: boolean;
    isPushingToResolve?: boolean;
    resolveOnline?: boolean;
}

export const SectionTimelineBar: React.FC<SectionTimelineBarProps> = ({
    sections,
    totalDuration,
    currentTime = 0,
    onSectionClick,
    onUpdateSection,
    onDeleteSection,
    onDetectSections,
    onPushSectionsToResolve,
    onAddSectionsToTimeline,
    isDetecting = false,
    isPushingToResolve = false,
    resolveOnline = false
}) => {
    const [editing_section_id, setEditingSectionId] = useState<string | null>(null);
    const [editing_section_name, setEditingSectionName] = useState<string>('');
    const [editing_section_type, setEditingSectionType] = useState<SectionType>('verse');

    // WHAT: Begins editing of a section name and category.
    // WHY: Lets users customize the automated classification labels.
    const handleStartEditing = (target_section: MusicSection, click_event: React.MouseEvent) => {
        click_event.stopPropagation();
        setEditingSectionId(target_section.id);
        setEditingSectionName(target_section.name);
        setEditingSectionType(target_section.type);
    };

    // WHAT: Commits edits to a section and updates parent project state.
    // WHY: Persists custom section labels and themes into the project bundle.
    const handleSaveEditing = (target_section: MusicSection) => {
        if (onUpdateSection) {
            const updated_color = SECTION_TYPE_COLOR_MAP[editing_section_type]?.border || target_section.color;
            onUpdateSection({
                ...target_section,
                name: editing_section_name.trim() || target_section.name,
                type: editing_section_type,
                color: updated_color
            });
        }
        setEditingSectionId(null);
    };

    if (totalDuration <= 0) return null;

    return (
        <div className="bg-[#101014] border border-gray-800/80 rounded-xl p-3 flex flex-col gap-2.5">
            {/* Header & Section Actions */}
            <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
                        <span>🎼</span> Song Sections &amp; Transitions ({sections.length})
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {onDetectSections && (
                        <button
                            type="button"
                            onClick={onDetectSections}
                            disabled={isDetecting}
                            className="btn btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 border border-indigo-500/30 hover:border-indigo-500/80"
                            title="Analyze audio dynamics and stem activity to automatically detect verses and choruses"
                        >
                            <span>🔍</span> {isDetecting ? 'Detecting...' : 'Auto-Detect Sections'}
                        </button>
                    )}

                    {onAddSectionsToTimeline && sections.length > 0 && (
                        <button
                            type="button"
                            onClick={onAddSectionsToTimeline}
                            className="btn btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 border border-emerald-500/40 hover:border-emerald-500/80 text-emerald-300"
                            title="Add detected song sections as video clip segments to the Project Timeline"
                        >
                            <span>➕</span> Add to Project Timeline
                        </button>
                    )}

                    {onPushSectionsToResolve && sections.length > 0 && (
                        <button
                            type="button"
                            onClick={onPushSectionsToResolve}
                            disabled={isPushingToResolve || !resolveOnline}
                            className={`btn text-xs py-1 px-2.5 flex items-center gap-1 ${
                                resolveOnline 
                                    ? 'btn-primary' 
                                    : 'btn-secondary opacity-50 cursor-not-allowed'
                            }`}
                            title={resolveOnline ? "Push colored section markers to active DaVinci Resolve timeline" : "Open DaVinci Resolve to push markers"}
                        >
                            <span>⚡</span> {isPushingToResolve ? 'Pushing...' : 'Push to Resolve'}
                        </button>
                    )}
                </div>
            </div>

            {/* Visual Ribbon Bar */}
            {sections.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-500 border border-dashed border-gray-800 rounded-lg">
                    No song sections detected yet. Click <b>&quot;Auto-Detect Sections&quot;</b> to detect Verse/Chorus transitions from audio.
                </div>
            ) : (
                <div className="relative w-full h-11 bg-[#0b0b0e] border border-gray-800 rounded-lg overflow-hidden flex select-none">
                    {sections.map((section_item) => {
                        const section_width_percentage = Math.max(
                            2,
                            ((section_item.endTime - section_item.startTime) / totalDuration) * 100
                        );
                        const section_duration_seconds = (section_item.endTime - section_item.startTime).toFixed(1);
                        const theme = SECTION_TYPE_COLOR_MAP[section_item.type] || SECTION_TYPE_COLOR_MAP.verse;

                        const is_playhead_inside = currentTime >= section_item.startTime && currentTime <= section_item.endTime;

                        return (
                            <div
                                key={section_item.id}
                                style={{
                                    width: `${section_width_percentage}%`,
                                    backgroundColor: theme.background,
                                    borderRight: `2px solid ${theme.border}`,
                                }}
                                onClick={() => onSectionClick && onSectionClick(section_item)}
                                onDoubleClick={(click_event) => handleStartEditing(section_item, click_event)}
                                className={`h-full relative flex flex-col justify-between p-1.5 cursor-pointer transition-all hover:brightness-125 overflow-hidden ${
                                    is_playhead_inside ? 'ring-1 ring-inset ring-white/40' : ''
                                }`}
                                title={`${section_item.name} (${section_duration_seconds}s) [${section_item.startTime.toFixed(1)}s - ${section_item.endTime.toFixed(1)}s] - Double click to edit`}
                            >
                                <div className="flex justify-between items-center w-full">
                                    <span
                                        className="font-bold text-[11px] truncate tracking-tight font-mono"
                                        style={{ color: theme.text }}
                                    >
                                        {section_item.name}
                                    </span>
                                    <span className="text-[9px] text-gray-400 font-mono hidden sm:inline">
                                        {section_duration_seconds}s
                                    </span>
                                </div>

                                <div className="flex justify-between items-center text-[9px] text-gray-500 font-mono">
                                    <span>{section_item.startTime.toFixed(0)}s</span>
                                    <span>{section_item.endTime.toFixed(0)}s</span>
                                </div>
                            </div>
                        );
                    })}

                    {/* Timeline Playhead Indicator */}
                    {totalDuration > 0 && currentTime >= 0 && (
                        <div
                            style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-md shadow-red-500/50 pointer-events-none z-10 transition-all duration-75"
                        />
                    )}
                </div>
            )}

            {/* Inline Section Editor Modal / Drawer */}
            {editing_section_id && (
                <div className="bg-[#18181f] border border-indigo-500/40 p-3 rounded-lg flex items-center gap-3 flex-wrap animate-fade-in text-xs">
                    <span className="font-semibold text-white">Edit Section:</span>

                    <input
                        type="text"
                        value={editing_section_name}
                        onChange={(change_event) => setEditingSectionName(change_event.target.value)}
                        placeholder="Section Name..."
                        className="bg-[#0f0f13] border border-gray-700 rounded px-2.5 py-1 text-white font-mono focus:outline-none focus:border-indigo-500 w-36"
                    />

                    <select
                        value={editing_section_type}
                        onChange={(change_event) => setEditingSectionType(change_event.target.value as SectionType)}
                        className="bg-[#0f0f13] border border-gray-700 rounded px-2.5 py-1 text-white font-mono focus:outline-none focus:border-indigo-500"
                    >
                        <option value="intro">Intro</option>
                        <option value="verse">Verse</option>
                        <option value="pre-chorus">Pre-Chorus</option>
                        <option value="chorus">Chorus</option>
                        <option value="bridge">Bridge</option>
                        <option value="breakdown">Breakdown</option>
                        <option value="solo">Solo</option>
                        <option value="outro">Outro</option>
                    </select>

                    {(() => {
                        const target_section = sections.find((s) => s.id === editing_section_id);
                        if (!target_section) return null;
                        return (
                            <div className="flex items-center gap-2 ml-auto">
                                {onDeleteSection && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onDeleteSection(editing_section_id);
                                            setEditingSectionId(null);
                                        }}
                                        className="btn btn-secondary text-rose-400 py-1 px-2.5 text-xs hover:border-rose-500"
                                    >
                                        Delete
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleSaveEditing(target_section)}
                                    className="btn btn-primary py-1 px-3 text-xs"
                                >
                                    Save
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingSectionId(null)}
                                    className="btn btn-secondary py-1 px-2.5 text-xs"
                                >
                                    Cancel
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};

export default SectionTimelineBar;
