import React from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';
import type { VideoClip } from '../../types/assembler';
import { formatTime, pathToMediaUrl, getLtxAlignedDuration } from '../../utils/timelineUtils';

interface CardProps {
    card: VideoClip;
    onUpdate: (id: string, updates: Partial<VideoClip>) => void;
    onDelete: (id: string) => void;
    onGenerateVideo?: (clipId: string) => Promise<void>;
    comfyConnected?: boolean;
    frameRate?: number;
}

const StoryboardCardComponent: React.FC<CardProps> = ({ 
    card, 
    onUpdate, 
    onDelete, 
    onGenerateVideo,
    comfyConnected,
    frameRate = 20
}) => {
    const [isHovered, setIsHovered] = React.useState(false);

    React.useEffect(() => {
        if (!isHovered) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't intercept if an input is focused (handled natively)
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

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

    // Legacy Fallback Helper
    const actionPromptValue = card.notes?.action || (card as any).actionNotes || (card as any).promptText || '';
    const dialogueValue = card.notes?.dialogue || (card as any).dialogue || '';
    const soundValue = card.notes?.sound || (card as any).soundCues || '';
    return (
        <div 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`bg-[#1a1a2e] border rounded-xl overflow-hidden shadow-2xl transition-all group flex flex-col h-full ${isHovered ? 'border-indigo-400 ring-1 ring-indigo-500/20 scale-[1.01]' : 'border-gray-700/50 hover:border-gray-600'}`}
            style={{ padding: '5px' }}
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
                <Tippy content="Remove this shot from the timeline." placement="top" offset={[0, 48]}>
                    <span>
                        <button 
                            onClick={() => onDelete(card.id)}
                            className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            ✕
                        </button>
                    </span>
                </Tippy>
            </div>

            {/* Visual Previews & Video Selector */}
            <div className="space-y-2 p-4 bg-black/20">
                <div className="flex gap-2 aspect-[32/9]">
                    {/* Start Image */}
                    <div className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img">
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

                    {/* End Image */}
                    <div className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img">
                        {card.endImagePath ? (
                            <img src={pathToMediaUrl(card.endImagePath)} alt="End Frame" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center opacity-30">
                                <span className="text-xl">🏁</span>
                                <span className="text-[8px] font-black uppercase">End</span>
                            </div>
                        )}
                        <div className="absolute top-1 left-1 px-1 bg-black/60 rounded text-[8px] font-bold text-gray-400 uppercase tracking-tighter">End</div>
                    </div>
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
                                    muted
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
            <div className="p-5 space-y-5 flex-1 overflow-y-auto">
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Action Prompt</label>
                        <div className="flex gap-1">
                            <Tippy content={comfyConnected ? "Generate video for this shot." : "ComfyUI not connected."} placement="top" offset={[0, 48]}>
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
                            </Tippy>
                        </div>
                    </div>
                    <textarea 
                        className="w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed"
                        placeholder="Describe the shot prompt..."
                        value={actionPromptValue}
                        onChange={(e) => onUpdate(card.id, { 
                            notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), action: e.target.value } 
                        })}
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Dialogue</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-indigo-300 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            placeholder="..." 
                            value={dialogueValue}
                            onChange={(e) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), dialogue: e.target.value } 
                            })}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Sound Cues</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-amber-500/80 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            placeholder="..." 
                            value={soundValue}
                            onChange={(e) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), sound: e.target.value } 
                            })}
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
        </div>
    );
};

export default StoryboardCardComponent;
