import React, { useState } from 'react';
import type { VideoClip } from '../types/assembler';
import { formatTime, buildTimelineRows, getAlignedDuration } from '../utils/timelineUtils';
import PromptEditorModal from './PromptEditorModal';
import DurationEditPopup from './DurationEditPopup';

/**
 * Props for the ProjectTimelineTable component.
 */
interface ProjectTimelineTableProps {
    clips: VideoClip[];
    duration: number;
    onUpdateClipLabel: (clipId: string, newLabel: string) => void;
    onUpdateClipPrompt: (clipId: string, newPrompt: string) => void;
    onUpdateClipStartTime: (clipId: string, newStartTime: number) => void;
    onUpdateClipEndTime: (clipId: string, newEndTime: number) => void;
    onRemoveClip: (clipId: string) => void;
    onPickImage: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    onGenerateClip: (clipId: string) => void;
    onError: (msg: string) => void;
}

/**
 * Renders the project's timeline of video clips as a detailed table.
 * Supports inline editing of clip labels, picking start/end images, and removing clips.
 */
const ProjectTimelineTable: React.FC<ProjectTimelineTableProps> = ({
    clips,
    duration,
    onUpdateClipLabel,
    onUpdateClipPrompt,
    onUpdateClipStartTime,
    onUpdateClipEndTime,
    onRemoveClip,
    onPickImage,
    onGenerateClip,
    onError
}) => {
    // Helper to parse time string (e.g., "0:02.49") to seconds
    const parseTime = (timeStr: string): number | null => {
        try {
            const parts = timeStr.trim().split(':');
            if (parts.length === 2) {
                const mins = parseFloat(parts[0]);
                const secs = parseFloat(parts[1]);
                if (!isNaN(mins) && !isNaN(secs)) {
                    return (mins * 60) + secs;
                }
            } else if (parts.length === 1) {
                const secs = parseFloat(parts[0]);
                if (!isNaN(secs)) return secs;
            }
        } catch (e) {
            console.error('Failed to parse time:', timeStr);
        }
        return null;
    };

    // Inline label editing
    const [editingClipId, setEditingClipId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState('');

    // Prompt Editor Modal
    const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
    const [activePromptClip, setActivePromptClip] = useState<{ id: string, text: string } | null>(null);

    // Inline Time Editing
    const [editingTime, setEditingTime] = useState<{ id: string, field: 'start' | 'end', value: string } | null>(null);

    // Duration Popup State
    const [durationPopup, setDurationPopup] = useState<{ clipId: string, duration: number, startTime: number, x: number, y: number } | null>(null);

    const startEditTime = (clipId: string, field: 'start' | 'end', currentValue: number) => {
        setEditingTime({ id: clipId, field, value: formatTime(currentValue) });
    };

    const commitTime = () => {
        if (!editingTime) return;
        const seconds = parseTime(editingTime.value);
        if (seconds === null) {
            onError(`Invalid time format: ${editingTime.value}. Use M:SS.ss`);
            setEditingTime(null);
            return;
        }

        if (editingTime.field === 'start') {
            onUpdateClipStartTime(editingTime.id, seconds);
        } else {
            onUpdateClipEndTime(editingTime.id, seconds);
        }
        setEditingTime(null);
    };

    const openPromptEditor = (clipId: string, currentText: string) => {
        setActivePromptClip({ id: clipId, text: currentText });
        setIsPromptModalOpen(true);
    };

    const handleSavePrompt = (newPrompt: string) => {
        if (activePromptClip) {
            onUpdateClipPrompt(activePromptClip.id, newPrompt);
        }
        setIsPromptModalOpen(false);
        setActivePromptClip(null);
    };

    const startEditLabel = (clipId: string, currentLabel: string) => {
        setEditingClipId(clipId);
        setEditingLabel(currentLabel);
    };

    const commitLabel = () => {
        if (!editingClipId) return;
        const trimmed = editingLabel.trim();
        if (!trimmed) {
            // Don't allow empty — cancel
            setEditingClipId(null);
            return;
        }
        // Check uniqueness (allow keeping the same name)
        const duplicate = clips.find(c => c.id !== editingClipId && c.label === trimmed);
        if (duplicate) {
            onError(`Label "${trimmed}" is already in use.`);
            return;
        }

        onUpdateClipLabel(editingClipId, trimmed);
        setEditingClipId(null);
    };

    const cancelEditLabel = () => {
        setEditingClipId(null);
    };

    return (
        <div className="clips-table-container overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="text-xs text-gray-400 uppercase bg-gray-900/60">
                        <th className="p-2 pl-3">#</th>
                        <th className="p-2">Label</th>
                        <th className="p-2">Prompt (AI)</th>
                        <th className="p-2">Start</th>
                        <th className="p-2">End</th>
                        <th className="p-2">Duration</th>
                        <th className="p-2">Source</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Start Image</th>
                        <th className="p-2">End Image</th>
                        <th className="p-2">Generate</th>
                        <th className="p-2">Video Links</th>
                        <th className="p-2"></th>
                    </tr>
                </thead>
                <tbody className="text-sm">
                    {buildTimelineRows(clips, duration).map((row, idx) => (
                        <tr
                            key={idx}
                            onContextMenu={(e) => {
                                if (row.type === 'clip' && row.clip) {
                                    e.preventDefault();
                                    setDurationPopup({
                                        clipId: row.clip.id,
                                        duration: row.duration,
                                        startTime: row.startTime,
                                        x: e.clientX,
                                        y: e.clientY
                                    });
                                }
                            }}
                            className={`border-b border-gray-800 transition-colors ${row.type === 'unselected'
                                ? 'bg-gray-900/30 text-gray-500'
                                : 'hover:bg-gray-800/50 text-gray-300'
                                }`}
                        >
                            <td className="p-2 pl-3 font-mono text-xs text-gray-600">{idx}</td>
                            <td className="p-2">
                                {row.type === 'clip' && row.clip ? (
                                    editingClipId === row.clip.id ? (
                                        <input
                                            type="text"
                                            value={editingLabel}
                                            onChange={(e) => setEditingLabel(e.target.value)}
                                            onBlur={commitLabel}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitLabel();
                                                if (e.key === 'Escape') cancelEditLabel();
                                            }}
                                            autoFocus
                                            className="bg-gray-800 border border-indigo-500 text-indigo-200 text-xs font-bold px-2 py-0.5 rounded outline-none w-28"
                                        />
                                    ) : (
                                        <span
                                            className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-900/60 text-indigo-300 cursor-pointer hover:bg-indigo-800/80 transition-colors"
                                            onClick={() => startEditLabel(row.clip!.id, row.label)}
                                            title="Click to rename"
                                        >
                                            {row.label}
                                        </span>
                                    )) : (
                                    <span className="text-xs text-gray-600 italic">Unselected</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.type === 'clip' && row.clip ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="text"
                                            placeholder="AI Prompt (optional)..."
                                            value={row.clip.notes?.action || (row.clip as any).promptText || ''}
                                            onChange={(e) => onUpdateClipPrompt(row.clip!.id, e.target.value)}
                                            className="bg-gray-900/50 border border-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded outline-none w-48 focus:border-indigo-500 focus:bg-gray-900 transition-all"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                            onClick={() => openPromptEditor(row.clip!.id, row.clip!.notes?.action || (row.clip as any).promptText || '')}
                                            className="text-gray-500 hover:text-indigo-400 transition-colors p-1"
                                            title="Expand editor"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                            </svg>
                                        </button>
                                    </div>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2 font-mono text-xs">
                                {row.type === 'clip' && row.clip ? (
                                    editingTime?.id === row.clip.id && editingTime?.field === 'start' ? (
                                        <input
                                            type="text"
                                            value={editingTime.value}
                                            onChange={(e) => setEditingTime({ ...editingTime, value: e.target.value })}
                                            onBlur={commitTime}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitTime();
                                                if (e.key === 'Escape') setEditingTime(null);
                                            }}
                                            autoFocus
                                            className="bg-gray-800 border border-indigo-500 text-indigo-200 text-xs font-mono px-1 py-0.5 rounded outline-none w-20"
                                        />
                                    ) : (
                                        <span 
                                            className="cursor-pointer hover:text-indigo-400 border-b border-transparent hover:border-indigo-400/50"
                                            onClick={() => startEditTime(row.clip!.id, 'start', row.startTime)}
                                            title="Click to edit start time"
                                        >
                                            {formatTime(row.startTime)}
                                        </span>
                                    )
                                ) : (
                                    formatTime(row.startTime)
                                )}
                            </td>
                            <td className="p-2 font-mono text-xs">
                                {row.type === 'clip' && row.clip ? (
                                    editingTime?.id === row.clip.id && editingTime?.field === 'end' ? (
                                        <input
                                            type="text"
                                            value={editingTime.value}
                                            onChange={(e) => setEditingTime({ ...editingTime, value: e.target.value })}
                                            onBlur={commitTime}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitTime();
                                                if (e.key === 'Escape') setEditingTime(null);
                                            }}
                                            autoFocus
                                            className="bg-gray-800 border border-indigo-500 text-indigo-200 text-xs font-mono px-1 py-0.5 rounded outline-none w-20"
                                        />
                                    ) : (
                                        <span 
                                            className="cursor-pointer hover:text-indigo-400 border-b border-transparent hover:border-indigo-400/50"
                                            onClick={() => startEditTime(row.clip!.id, 'end', row.endTime)}
                                            title="Click to edit end time"
                                        >
                                            {formatTime(row.endTime)}
                                        </span>
                                    )
                                ) : (
                                    formatTime(row.endTime)
                                )}
                            </td>
                            <td className="p-2 font-mono text-xs">{formatTime(row.duration)}</td>
                            <td className="p-2">
                                {row.clip ? (
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${row.clip.source === 'main'
                                        ? 'bg-indigo-900 text-indigo-300'
                                        : 'bg-gray-700 text-gray-300'
                                        }`}>
                                        {row.clip.source === 'main' ? 'Main' : row.clip.stemName || 'Stem'}
                                    </span>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip ? (
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${row.clip.status === 'done' ? 'bg-green-900/50 text-green-400' :
                                        row.clip.status === 'error' ? 'bg-red-900/50 text-red-400' :
                                            'bg-yellow-900/50 text-yellow-400'
                                        }`}>
                                        {row.clip.status}
                                    </span>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip ? (
                                    row.clip.startImagePath ? (
                                        <div
                                            className="w-16 h-10 bg-gray-800 border border-gray-600 rounded overflow-hidden cursor-pointer hover:border-indigo-400 group relative"
                                            onClick={() => onPickImage(row.clip!.id, 'startImagePath')}
                                            title={row.clip.startImagePath}
                                        >
                                            <img
                                                src={`media://${row.clip.startImagePath}?t=${Date.now()}`}
                                                alt="Start"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                <span className="text-white text-[10px]">Change</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded truncate max-w-[120px]"
                                            onClick={() => onPickImage(row.clip!.id, 'startImagePath')}
                                        >
                                            📷 Select
                                        </button>
                                    )
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip ? (
                                    row.clip.endImagePath ? (
                                        <div
                                            className="w-16 h-10 bg-gray-800 border border-gray-600 rounded overflow-hidden cursor-pointer hover:border-indigo-400 group relative"
                                            onClick={() => onPickImage(row.clip!.id, 'endImagePath')}
                                            title={row.clip.endImagePath}
                                        >
                                            <img
                                                src={`media://${row.clip.endImagePath}?t=${Date.now()}`}
                                                alt="End"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                <span className="text-white text-[10px]">Change</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded truncate max-w-[120px]"
                                            onClick={() => onPickImage(row.clip!.id, 'endImagePath')}
                                        >
                                            📷 Select
                                        </button>
                                    )
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip ? (
                                    <button
                                        className={`text-xs px-2 py-0.5 rounded font-bold uppercase transition-colors ${!row.clip.startImagePath
                                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                            : row.clip.status === 'generating'
                                                ? 'bg-amber-600 text-white animate-pulse cursor-wait'
                                                : row.clip.status === 'queued'
                                                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 animate-pulse cursor-wait'
                                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                            }`}
                                        onClick={() => {
                                            if (!row.clip!.startImagePath) {
                                                onError('A Start Image is required to generate a video.');
                                                return;
                                            }
                                            if (row.clip!.status !== 'generating' && row.clip!.status !== 'queued') {
                                                onGenerateClip(row.clip!.id);
                                            }
                                        }}
                                        disabled={row.clip.status === 'generating' || row.clip.status === 'queued'}
                                    >
                                        {row.clip.status === 'generating' ? 'Generating...' : row.clip.status === 'queued' ? 'Queued...' : '▶ Generate'}
                                    </button>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip?.generatedVideos && row.clip.generatedVideos.length > 0 ? (
                                    <div className="flex items-center gap-1">
                                        <select
                                            className="text-xs bg-gray-800 border-none text-indigo-300 w-24 rounded p-1 cursor-pointer hover:bg-gray-700"
                                            onChange={async (e) => {
                                                const url = e.target.value;
                                                if (url) {
                                                    try {
                                                        // @ts-ignore
                                                        const { ipcRenderer } = window.require('electron');
                                                        // @ts-ignore
                                                        const path = window.require('path');
                                                        const dir = path.dirname(url);
                                                        await ipcRenderer.invoke('open-folder', dir);
                                                    } catch (err) {
                                                        console.error(err);
                                                    }
                                                }
                                                e.target.value = ""; // reset
                                            }}
                                        >
                                            <option value="">{row.clip.generatedVideos.length} Videos ▼</option>
                                            {row.clip.generatedVideos.map((vid, idx) => (
                                                <option key={idx} value={vid}>
                                                    Take {idx + 1}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : row.clip?.videoPath ? (
                                    // Fallback for older projects
                                    <a
                                        href="#"
                                        className="text-indigo-400 hover:text-indigo-300 text-xs underline cursor-pointer"
                                        onClick={async (e) => {
                                            e.preventDefault();
                                            try {
                                                // @ts-ignore
                                                const { ipcRenderer } = window.require('electron');
                                                // @ts-ignore
                                                const path = window.require('path');
                                                const dir = path.dirname(row.clip!.videoPath!);
                                                await ipcRenderer.invoke('open-folder', dir);
                                            } catch (err) {
                                                console.error(err);
                                            }
                                        }}
                                        title="Open Videos Folder"
                                    >
                                        View Videos
                                    </a>
                                ) : row.type === 'clip' ? (
                                    <span className="text-gray-600 text-xs">No video</span>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip && (
                                    <button
                                        className="text-xs bg-red-900/60 hover:bg-red-800 text-red-300 px-2 py-0.5 rounded font-bold"
                                        onClick={() => onRemoveClip(row.clip!.id)}
                                        title="Remove this segment"
                                    >
                                        ✕
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <PromptEditorModal
                isOpen={isPromptModalOpen}
                initialValue={activePromptClip?.text || ''}
                onSave={handleSavePrompt}
                onCancel={() => setIsPromptModalOpen(false)}
                title={`Edit Prompt for Clip: ${clips.find(c => c.id === activePromptClip?.id)?.label || ''}`}
            />

            {durationPopup && (
                <DurationEditPopup 
                    clipId={durationPopup.clipId}
                    initialDuration={durationPopup.duration}
                    startTime={durationPopup.startTime}
                    frameRate={20} // Default or passed from props
                    position={{ x: durationPopup.x, y: durationPopup.y }}
                    onClose={() => setDurationPopup(null)}
                    onSave={(id, newDur) => {
                        const aligned = getAlignedDuration(newDur, 20);
                        onUpdateClipEndTime(id, durationPopup.startTime + aligned);
                        setDurationPopup(null);
                    }}
                />
            )}
        </div>
    );
};

export default ProjectTimelineTable;
