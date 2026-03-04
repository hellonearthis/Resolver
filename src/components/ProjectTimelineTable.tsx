import React, { useState } from 'react';
import type { VideoClip } from '../types/assembler';
import { formatTime, buildTimelineRows } from '../utils/timelineUtils';

/**
 * Props for the ProjectTimelineTable component.
 */
interface ProjectTimelineTableProps {
    clips: VideoClip[];
    duration: number;
    onUpdateClipLabel: (clipId: string, newLabel: string) => void;
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
    onRemoveClip,
    onPickImage,
    onGenerateClip,
    onError
}) => {
    // Inline label editing
    const [editingClipId, setEditingClipId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState('');

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
                                    )
                                ) : (
                                    <span className="text-xs text-gray-600 italic">Unselected</span>
                                )}
                            </td>
                            <td className="p-2 font-mono text-xs">{formatTime(row.startTime)}</td>
                            <td className="p-2 font-mono text-xs">{formatTime(row.endTime)}</td>
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
                                    <button
                                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded truncate max-w-[120px]"
                                        onClick={() => onPickImage(row.clip!.id, 'startImagePath')}
                                        title={row.clip.startImagePath || 'Click to select'}
                                    >
                                        {row.clip.startImagePath
                                            ? row.clip.startImagePath.split(/[\\/]/).pop()
                                            : '📷 Select'}
                                    </button>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip ? (
                                    <button
                                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded truncate max-w-[120px]"
                                        onClick={() => onPickImage(row.clip!.id, 'endImagePath')}
                                        title={row.clip.endImagePath || 'Click to select'}
                                    >
                                        {row.clip.endImagePath
                                            ? row.clip.endImagePath.split(/[\\/]/).pop()
                                            : '📷 Select'}
                                    </button>
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
                                                    ? 'bg-indigo-600 text-white animate-pulse cursor-wait'
                                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                            }`}
                                        onClick={() => {
                                            if (!row.clip!.startImagePath) {
                                                onError('A Start Image is required to generate a video.');
                                                return;
                                            }
                                            if (row.clip!.status !== 'generating') {
                                                onGenerateClip(row.clip!.id);
                                            }
                                        }}
                                        disabled={row.clip.status === 'generating'}
                                    >
                                        {row.clip.status === 'generating' ? 'Generating...' : '▶ Generate'}
                                    </button>
                                ) : (
                                    <span className="text-gray-700">—</span>
                                )}
                            </td>
                            <td className="p-2">
                                {row.clip?.generatedVideos && row.clip.generatedVideos.length > 0 ? (
                                    <div className="flex items-center gap-1">
                                        <select
                                            className="text-xs bg-gray-800 border-none text-indigo-300 w-24 rounded p-1"
                                            onChange={(e) => {
                                                const url = e.target.value;
                                                if (url) {
                                                    // Optional: handle opening the URL or showing a preview modal
                                                }
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
                                        className="text-indigo-400 hover:text-indigo-300 text-xs underline"
                                        onClick={(e) => { e.preventDefault(); }}
                                        title={row.clip.videoPath}
                                    >
                                        View Video
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
        </div>
    );
};

export default ProjectTimelineTable;
