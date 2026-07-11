/**
 * StoryboardCardComponent
 * 
 * A rich, interactive card representing a single shot in the storyboard.
 * It handles image picking, AI description generation, video previews, and timing.
 */

import React from 'react';
import { AppTooltip } from '../ui/Tooltip';
import { AppPopover } from '../ui/Popover';
import type { VideoClip } from '../../types/assembler';
import { formatTime, pathToMediaUrl, getLtxAlignedDuration } from '../../utils/timelineUtils';
import PromptEditorModal from '../PromptEditorModal';
import { getTextHeight } from '../../utils/pretextUtils';

interface CardProps {
    card: VideoClip;
    onUpdate: (id: string, updates: Partial<VideoClip>) => void;
    onDelete: (id: string) => void;
    onGenerateVideo?: (clipId: string) => Promise<void>;
    onPickImage?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    onCopyImageFromNext?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    onCopyEndFrameFromPrev?: (clipId: string, exactBeat?: boolean) => void;
    onGetImageDescription?: (clipId: string) => Promise<void>;
    onRewordPrompt?: (clipId: string) => Promise<void>;
    nextClipStartImage?: string;
    prevClipEndImage?: string;
    llmProvider?: 'lmstudio' | 'vino';
    comfyConnected?: boolean;
    frameRate?: number;
}

const StoryboardCardComponent: React.FC<CardProps> = ({ 
    card, 
    onUpdate, 
    onDelete, 
    onGenerateVideo,
    onPickImage,
    onCopyImageFromNext,
    onCopyEndFrameFromPrev,
    onGetImageDescription,
    onRewordPrompt,
    nextClipStartImage,
    prevClipEndImage,
    llmProvider,
    comfyConnected,
    frameRate = 20
}) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isStartPopoverOpen, setIsStartPopoverOpen] = React.useState(false);
    const [isEndPopoverOpen, setIsEndPopoverOpen] = React.useState(false);
    const [isEditorOpen, setIsEditorOpen] = React.useState(false);
    const [editorConfig, setEditorConfig] = React.useState<{
        title: string;
        initialValue: string;
        onSave: (val: string) => void;
    }>({ title: '', initialValue: '', onSave: () => {} });

    // Pretext strict height measurement
    const cardRef = React.useRef<HTMLDivElement>(null);
    
    /**
     * TEXT MEASUREMENT (assumedWidth):
     * 
     * WHY: We want the textareas to automatically resize to fit their content (up to a limit), 
     * giving a "script-like" feel without manual resizing.
     * HOW: Pretext (via getTextHeight) calculates height based on a fixed width. We assume 
     * 260px based on the standard responsive grid width of the card.
     */
    const assumedWidth = 260;

    React.useEffect(() => {
        if (!isHovered) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't intercept if an input is focused (handled natively)
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            /**
             * DURATION STEPPING (ArrowUp/Down):
             * 
             * WHY: Creative editors often want to nudge durations by discrete intervals 
             * (like 8-frame blocks) to match a beat or pace.
             * HOW: We increment/decrement the duration and call onUpdate, which triggers 
             * the 'ripple' process in the parent module to shift contiguous clips.
             */
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                const currentDur = card.duration || 0;
                const nextDur = getLtxAlignedDuration(currentDur + (8 / frameRate) + 0.01, frameRate);
                onUpdate(card.id, { duration: nextDur, endTime: card.startTime + nextDur });
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const currentDur = card.duration || 0;
                // Subtract 0.01 to ensure we drop into the previous bracket for the round/ceil logic
                const nextDur = getLtxAlignedDuration(Math.max(0.1, currentDur - (8 / frameRate) - 0.01), frameRate);
                onUpdate(card.id, { duration: nextDur, endTime: card.startTime + nextDur });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isHovered, card.duration, card.startTime, card.id, frameRate, onUpdate]);

    // Unified Notes Helpers
    // These grab values from the modern nested 'notes' object, which keeps the clip interface clean.
    const actionPromptValue = card.notes?.action || '';
    const dialogueValue = card.notes?.dialogue || '';
    const soundValue = card.notes?.sound || '';

    const renderImageOptions = (field: 'startImagePath' | 'endImagePath') => {
        const closePopover = () => {
            if (field === 'startImagePath') setIsStartPopoverOpen(false); else setIsEndPopoverOpen(false);
        };

        return (
            <div className="flex flex-col bg-[#11111e] border border-indigo-500/30 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden min-w-[220px] backdrop-blur-xl">
                {/* Load a new image from disk */}
                <button 
                    onClick={() => { closePopover(); onPickImage?.(card.id, field); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-600/20 text-[10px] font-black text-gray-300 hover:text-white transition-all border-b border-indigo-500/10 text-left uppercase tracking-widest"
                >
                    <span className="text-sm">📂</span> Load Image
                </button>

                {/* AI Description — start image only */}
                {field === 'startImagePath' && (
                    <button 
                        onClick={() => { closePopover(); onGetImageDescription?.(card.id); }}
                        disabled={!card.startImagePath || !comfyConnected || card.isDescribing}
                        className={`flex items-center gap-3 px-4 py-3 transition-all border-b border-indigo-500/10 text-left uppercase tracking-widest ${
                            !card.startImagePath || !comfyConnected || card.isDescribing
                                ? 'text-gray-600 cursor-not-allowed opacity-50'
                                : 'hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 font-black text-[10px]'
                        }`}
                    >
                        <span className="text-sm">🔍</span> {card.isDescribing ? 'Describing...' : 'Get Description'}
                    </button>
                )}

                {/* Start image: copy end frame from previous video */}
                {field === 'startImagePath' && (
                    <>
                        <button 
                            onClick={() => { closePopover(); onCopyEndFrameFromPrev?.(card.id, false); }}
                            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-indigo-600/20 text-[10px] font-black text-gray-300 hover:text-white transition-all border-b border-indigo-500/10 text-left uppercase tracking-widest group/item"
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-sm">⏮️</span> Prev Video End Frame
                            </div>
                            {prevClipEndImage ? (
                                <img 
                                    src={pathToMediaUrl(prevClipEndImage)} 
                                    alt="Preview" 
                                    className="w-10 h-6 object-cover rounded border border-indigo-500/30 group-hover/item:border-indigo-400 transition-all" 
                                />
                            ) : (
                                <span className="text-[8px] text-gray-500 italic lowercase tracking-normal">no video</span>
                            )}
                        </button>
                        <button 
                            onClick={() => { closePopover(); onCopyEndFrameFromPrev?.(card.id, true); }}
                            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-indigo-600/20 text-[10px] font-black text-gray-300 hover:text-white transition-all border-b border-indigo-500/10 text-left uppercase tracking-widest group/item"
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-sm">⏱️</span> Prev Beat Frame
                            </div>
                        </button>
                    </>
                )}

                {/* End image: copy start image from next clip */}
                {field === 'endImagePath' && (
                    <button 
                        onClick={() => { closePopover(); onCopyImageFromNext?.(card.id, field); }}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-indigo-600/20 text-[10px] font-black text-gray-300 hover:text-white transition-all border-b border-indigo-500/10 text-left uppercase tracking-widest group/item"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-sm">⏭️</span> Next Clip Start
                        </div>
                        {nextClipStartImage ? (
                            <img 
                                src={pathToMediaUrl(nextClipStartImage)} 
                                alt="Preview" 
                                className="w-10 h-6 object-cover rounded border border-indigo-500/30 group-hover/item:border-indigo-400 transition-all" 
                            />
                        ) : (
                            <span className="text-[8px] text-gray-500 italic lowercase tracking-normal">no image</span>
                        )}
                    </button>
                )}

                {/* Remove image */}
                <button 
                    onClick={() => { closePopover(); onUpdate(card.id, { [field]: undefined }); }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-red-600/20 text-[10px] font-black text-gray-300 hover:text-red-400 transition-all text-left uppercase tracking-widest"
                >
                    <span className="text-sm">🗑️</span> Remove Image
                </button>
            </div>
        );
    };

    return (
        <div 
            ref={cardRef}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`bg-[#1a1a2e] border rounded-xl shadow-2xl transition-all group flex flex-col h-full ${isHovered ? 'border-indigo-400 ring-1 ring-indigo-500/20 scale-[1.01]' : 'border-gray-700/50 hover:border-gray-600'}`}
            style={{ padding: '5px', overflow: 'hidden' }}
        >
            {/* Header: Scene/Shot Info */}
            <div className="px-4 py-3 bg-black/40 border-b border-gray-700/30 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none">Shot</span>
                    <input 
                        className="bg-transparent border-none text-[11px] font-bold text-indigo-400 uppercase tracking-widest w-32 focus:ring-0 p-0" 
                        value={card.label || ''} 
                        onChange={(e) => onUpdate(card.id, { label: e.target.value })}
                        placeholder="UNNAMED SHOT"
                    />
                </div>
                <AppTooltip content="Remove this shot from the timeline." placement="top" offset={[0, 48]}>
                    <span>
                        <button 
                            onClick={() => onDelete(card.id)}
                            className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            ✕
                        </button>
                    </span>
                </AppTooltip>
            </div>

            {/* Visual Previews & Video Selector */}
            <div className="space-y-2 p-4 bg-black/20">
                <div className="flex gap-2 aspect-[32/9]">
                    {/* Start Image */}
                    <AppPopover 
                        content={renderImageOptions('startImagePath')} 
                        placement="bottom"
                        open={isStartPopoverOpen}
                        onOpenChange={setIsStartPopoverOpen}
                    >
                        <div 
                            className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all"
                        >
                        {card.startImagePath ? (
                            <img src={pathToMediaUrl(card.startImagePath)} alt="Start Frame" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center opacity-30">
                                <span className="text-xl">🎬</span>
                                <span className="text-[8px] font-black uppercase">Start</span>
                            </div>
                        )}
                        <div className="absolute top-1 left-1 px-1 bg-black/60 rounded text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Start</div>
                    </div>
                </AppPopover>

                    {/* End Image */}
                    <AppPopover 
                        content={renderImageOptions('endImagePath')} 
                        placement="bottom"
                        open={isEndPopoverOpen}
                        onOpenChange={setIsEndPopoverOpen}
                    >
                        <div 
                            className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img cursor-pointer hover:ring-2 hover:ring-indigo-500 transition-all"
                        >
                        {Boolean(card.endImagePath) ? (
                            <img src={pathToMediaUrl(card.endImagePath!)} alt="End Frame" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center opacity-30">
                                <span className="text-xl">🏁</span>
                                <span className="text-[8px] font-black uppercase">End</span>
                            </div>
                        )}
                        <div className="absolute top-1 left-1 px-1 bg-black/60 rounded text-[8px] font-bold text-gray-400 uppercase tracking-tighter">End</div>
                    </div>
                </AppPopover>
            </div>

                {/* Video Preview & Selector Dropdown */}
                {((card.generatedVideos && card.generatedVideos.length > 0) || card.videoPath) && (
                    <div className="mt-3 space-y-2">
                        {/* Video Preview Area */}
                        {card.videoPath && (
                            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-indigo-500/20 shadow-inner group/video">
                                <video 
                                    src={pathToMediaUrl(card.videoPath)} 
                                    className="w-full h-full object-cover"
                                    controls={false}
                                    loop
                                    onMouseOver={(e) => e.currentTarget.play()}
                                    onMouseOut={(e) => {
                                        e.currentTarget.pause();
                                        e.currentTarget.currentTime = 0;
                                    }}
                                />
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-indigo-600/80 rounded text-[7px] font-black text-white uppercase tracking-tighter shadow-lg pointer-events-none opacity-0 group-hover/video:opacity-100 transition-opacity">
                                    Preview
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 px-1">
                            <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Clip Version</span>
                            <select 
                                className="flex-1 bg-black/40 border border-gray-700/50 rounded-md text-[10px] text-indigo-300 py-1 px-2 focus:ring-1 focus:ring-indigo-500/30"
                                value={card.videoPath || ''}
                                onChange={(e) => onUpdate(card.id, { videoPath: e.target.value })}
                            >
                                {card.videoPath && !card.generatedVideos?.includes(card.videoPath) && (
                                    <option value={card.videoPath}>Active: {card.videoPath.split(/[\\/]/).pop()}</option>
                                )}
                                {card.generatedVideos?.map((path, idx) => (
                                    <option key={idx} value={path}>
                                        Version {idx + 1}: {path.split(/[\\/]/).pop()}
                                    </option>
                                ))}
                                {(!card.videoPath && (!card.generatedVideos || card.generatedVideos.length === 0)) && (
                                    <option value="">No videos generated</option>
                                )}
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Areas */}
            <div className="p-5 space-y-5 flex-1">
                {/* 
                  IMAGE DESCRIPTION is moved to the top.
                  WHY: It acts as the "source" material (AI-generated) that informs the 
                  Clip Action prompt below it. Putting it first matches the workflow.
                */}
                {/* Image Description Box */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Image description</label>
                        <div className="flex gap-1">
                            <AppTooltip content={comfyConnected && card.startImagePath ? "Generate an AI description of the start image." : (!card.startImagePath ? "Start image required." : "ComfyUI not connected.")} placement="top" offset={[0, 48]}>
                                <span>
                                    <button 
                                        onClick={() => onGetImageDescription?.(card.id)}
                                        disabled={!card.startImagePath || !comfyConnected || card.isDescribing}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                            card.isDescribing
                                                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20 animate-pulse'
                                                : (comfyConnected && card.startImagePath)
                                                    ? 'bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border-blue-500/20'
                                                    : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                        }`}
                                    >
                                        <span>🔍</span> {card.isDescribing ? 'Describing...' : 'Get Description'}
                                    </button>
                                </span>
                            </AppTooltip>
                        </div>
                    </div>
                    <div className="relative">
                        <textarea 
                            className={`w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed overflow-hidden ${card.isDescribing ? 'opacity-50' : ''}`}
                            style={{ height: `${Math.min(200, Math.max(60, getTextHeight(card.actionDescription || '', assumedWidth) + 16))}px` }}
                            title="Right-click to open large editor"
                            placeholder="AI generated image description will appear here..."
                            value={card.actionDescription || ''}
                            onChange={(e) => onUpdate(card.id, { actionDescription: e.target.value })}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditorConfig({
                                    title: "Edit Image Description",
                                    initialValue: card.actionDescription || '',
                                    onSave: (val) => onUpdate(card.id, { actionDescription: val })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                        {card.isDescribing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-lg">
                                <span className="text-[10px] font-bold text-indigo-400 animate-pulse">Describing...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Clip Action Box */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Clip Action</label>
                        <div className="flex gap-1">
                            {/* Reword / Magic Button */}
                            <AppTooltip content={`Expand into a cinematic LTX prompt using ${llmProvider === 'vino' ? '🍷 Intel NPU (Vino)' : '🏢 LM Studio'}.`} placement="top" offset={[0, 48]}>
                                <span>
                                    <button 
                                        onClick={() => onRewordPrompt?.(card.id)}
                                        disabled={card.isExpanding || card.expandedPromptLocked}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                            card.isExpanding 
                                                ? 'bg-purple-600/20 text-purple-400 border-purple-500/20 animate-pulse'
                                                : card.expandedPromptLocked
                                                    ? 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed opacity-50'
                                                    : 'bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white border-indigo-500/20'
                                        }`}
                                    >
                                        <span>✨</span> {card.isExpanding ? 'Expanding...' : 'Reword'}
                                    </button>
                                </span>
                            </AppTooltip>

                            <AppTooltip content={comfyConnected ? "Generate video for this shot." : "ComfyUI not connected."} placement="top" offset={[0, 48]}>
                                <span>
                                    <button 
                                        onClick={() => onGenerateVideo?.(card.id)}
                                        disabled={!comfyConnected || card.status === 'generating' || card.status === 'queued'}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                            card.status === 'generating' 
                                                ? 'bg-amber-600/20 text-amber-500 border-amber-500/20 animate-pulse'
                                                : card.status === 'queued'
                                                    ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20 animate-pulse'
                                                    : comfyConnected
                                                        ? 'bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white border-purple-500/20'
                                                        : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                        }`}
                                    >
                                        <span>🎬</span> {card.status === 'generating' ? 'Generating...' : card.status === 'queued' ? 'Queued...' : 'Generate'}
                                    </button>
                                </span>
                            </AppTooltip>
                        </div>
                    </div>
                    <textarea 
                        className="w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed overflow-hidden"
                        style={{ height: `${Math.min(200, Math.max(60, getTextHeight(actionPromptValue, assumedWidth) + 16))}px` }}
                        title="Right-click to open large editor"
                        placeholder="Describe the clip action for video generation..."
                        value={actionPromptValue}
                        onChange={(e) => onUpdate(card.id, { 
                            notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), action: e.target.value } 
                        })}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditorConfig({
                                title: "Edit Clip Action",
                                initialValue: actionPromptValue,
                                onSave: (val) => onUpdate(card.id, { 
                                    notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), action: val } 
                                })
                            });
                            setIsEditorOpen(true);
                        }}
                    />
                </div>

                {/* AI Expanded Prompt Box (The "Target" for LTX) */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <div className="flex items-center gap-2">
                            <label className="text-[9px] font-bold text-purple-400/80 uppercase tracking-widest pl-1">AI Expanded Prompt</label>
                            {/* Lock Toggle */}
                            <button 
                                onClick={() => onUpdate(card.id, { expandedPromptLocked: !card.expandedPromptLocked })}
                                className={`text-[10px] transition-all hover:scale-110 ${card.expandedPromptLocked ? 'text-amber-500' : 'text-gray-600 hover:text-gray-400'}`}
                                title={card.expandedPromptLocked ? "Locked: Prompt will not be overwritten by AI" : "Unlocked: AI can overwrite this prompt"}
                            >
                                {card.expandedPromptLocked ? '🔒' : '🔓'}
                            </button>
                        </div>
                        <div className="flex gap-1">
                            {card.aiExpandedPrompt && (
                                <span className="text-[8px] font-bold text-gray-600 uppercase bg-black/40 px-1.5 py-0.5 rounded border border-gray-800/50">
                                    LTX Target
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="relative">
                        <textarea 
                            className={`w-full bg-purple-900/5 border border-purple-500/10 rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-purple-500/30 p-2 leading-relaxed overflow-hidden ${card.isExpanding ? 'opacity-50' : ''} ${card.expandedPromptLocked ? 'border-amber-500/20 bg-amber-900/5' : ''}`}
                            style={{ height: `${Math.min(250, Math.max(80, getTextHeight(card.aiExpandedPrompt || '', assumedWidth) + 16))}px` }}
                            title="Right-click to open large editor"
                            placeholder="Rich cinematic expansion will appear here..."
                            value={card.aiExpandedPrompt || ''}
                            onChange={(e) => onUpdate(card.id, { aiExpandedPrompt: e.target.value })}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditorConfig({
                                    title: "Edit AI Expanded Prompt",
                                    initialValue: card.aiExpandedPrompt || '',
                                    onSave: (val) => onUpdate(card.id, { aiExpandedPrompt: val })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                        {card.isExpanding && (
                            <div className="absolute inset-0 flex items-center justify-center bg-purple-900/10 rounded-lg">
                                <span className="text-[10px] font-bold text-purple-400 animate-pulse italic">Thinking...</span>
                            </div>
                        )}
                        {card.expandedPromptLocked && !card.isExpanding && !card.aiExpandedPrompt && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-tighter opacity-30 italic">Locked Empty</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Dialogue</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-indigo-300 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            title="Right-click to open large editor"
                            placeholder="..." 
                            value={dialogueValue}
                            onChange={(e) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), dialogue: e.target.value } 
                            })}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditorConfig({
                                    title: "Edit Dialogue",
                                    initialValue: dialogueValue,
                                    onSave: (val) => onUpdate(card.id, { 
                                        notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), dialogue: val } 
                                    })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Sound Cues</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-amber-500/80 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            title="Right-click to open large editor"
                            placeholder="..." 
                            value={soundValue}
                            onChange={(e) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), sound: e.target.value } 
                            })}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditorConfig({
                                    title: "Edit Sound Cues",
                                    initialValue: soundValue,
                                    onSave: (val) => onUpdate(card.id, { 
                                        notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), sound: val } 
                                    })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                    </div>
                </div>

                {/* Timing Row */}
                <div className="pt-2 border-t border-gray-700/30 flex justify-between items-center text-[10px]">
                    <div className="flex gap-4">
                        <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Start</span>
                            <span className="text-gray-400 font-mono italic">{formatTime(card.startTime)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">End</span>
                            <span className="text-gray-400 font-mono italic">{formatTime(card.endTime)}</span>
                        </div>
                    </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Frames</span>
                            <span className="text-[#f59e0b] font-mono font-black italic">
                                {Math.round((card.duration || 0) * frameRate)}
                            </span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Duration</span>
                            <div className="flex items-center gap-0.5">
                                <input
                                    type="number"
                                    step={8 / frameRate}
                                    min="0.1"
                                    value={(card.duration || 0).toFixed(1)}
                                    onChange={(e) => {
                                        const rawDur = parseFloat(e.target.value) || 0.1;
                                        const alignedDur = getLtxAlignedDuration(rawDur, frameRate);
                                        onUpdate(card.id, { duration: alignedDur, endTime: card.startTime + alignedDur });
                                    }}
                                    className="bg-transparent border-b border-transparent hover:border-indigo-500/50 focus:border-indigo-500 text-indigo-400/80 font-bold w-12 text-right outline-none p-0 transition-all text-[10px]"
                                />
                                <span className="text-indigo-400/80 font-bold">s</span>
                            </div>
                        </div>
                </div>
            </div>

            <PromptEditorModal 
                isOpen={isEditorOpen}
                title={editorConfig.title}
                initialValue={editorConfig.initialValue}
                onSave={(val) => {
                    editorConfig.onSave(val);
                    setIsEditorOpen(false);
                }}
                onCancel={() => setIsEditorOpen(false)}
            />
        </div>
    );
};

export default StoryboardCardComponent;
