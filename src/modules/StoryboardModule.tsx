import React, { useState } from 'react';
import type { VideoClip } from '../types/assembler';
import { PacingBenchmarks } from '../types/storyboard';
import { getLtxAlignedDuration } from '../utils/timelineUtils';
import StoryboardCardComponent from '../components/storyboard/StoryboardCard';
import AnimaticTimeline from '../components/storyboard/AnimaticTimeline';
import StoryboardPaddingCard from '../components/storyboard/StoryboardPaddingCard';
import type { BeatProject } from '../hooks/useProjectStorage';

interface StoryboardModuleProps {
    activeProject?: BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onStatusChange?: (msg: string) => void;
}

const StoryboardModule: React.FC<StoryboardModuleProps> = ({ activeProject, onUpdateProject, onStatusChange }) => {
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

    const cards = (activeProject?.clips || []) as VideoClip[];
    const elements = activeProject?.elementTray || [];

    const handleFillPadding = (startTime: number, duration: number) => {
        if (!activeProject) return;
        const frameRate = activeProject.frameRate || 20;
        const alignedDuration = getLtxAlignedDuration(duration, frameRate);
        const nextIndex = cards.length + 1;

        const newCard: VideoClip = {
            id: `card-${Date.now()}`,
            startTime: startTime,
            duration: alignedDuration,
            endTime: startTime + alignedDuration,
            track: 1,
            status: 'pending',
            source: 'main',
            label: `Shot ${nextIndex}`,
            sceneNumber: '1',
            shotLetter: 'A',
            notes: { action: '', dialogue: '', sound: '' },
            paceWpm: PacingBenchmarks.CONVERSATIONAL
        };

        const updatedCards = [...cards, newCard];
        // Sort clips by start time just in case, though usually they are appended
        updatedCards.sort((a, b) => a.startTime - b.startTime);
        onUpdateProject(activeProject.id, { clips: updatedCards });
    };

    const handleUpdateCard = (id: string, updates: any) => {
        if (!activeProject) return;
        
        let newClips = [...cards];
        const clipIndex = newClips.findIndex(c => c.id === id);
        if (clipIndex === -1) return;

        // Apply update to the targeted clip
        let currentClip = newClips[clipIndex];
        let updatedClip: VideoClip;

        // Custom handling for nested notes to prevent overwriting other note fields
        if ('notes' in updates && updates.notes) {
            updatedClip = {
                ...currentClip,
                notes: {
                    ...(currentClip.notes || { action: '', dialogue: '', sound: '' }),
                    ...updates.notes
                }
            };
        } else {
            updatedClip = { ...currentClip, ...updates };
        }
        
        // Handle duration auto-calc
        if (updates.notes?.dialogue !== undefined || updates.paceWpm !== undefined) {
            const dialogue = updatedClip.notes?.dialogue || '';
            const words = dialogue.trim().split(/\s+/).filter((w: string) => w.length > 0);
            const wordCount = words.length;
            const rawDuration = Math.max(1.5, (wordCount / (updatedClip.paceWpm || PacingBenchmarks.CONVERSATIONAL)) * 60);
            const frameRate = activeProject.frameRate || 20;
            updatedClip.duration = getLtxAlignedDuration(rawDuration, frameRate);
        }
        updatedClip.endTime = updatedClip.startTime + updatedClip.duration;
        newClips[clipIndex] = updatedClip;

        // Rippling Effect: Sync sequential timing for all subsequent clips
        for (let i = clipIndex + 1; i < newClips.length; i++) {
            const prev = newClips[i - 1];
            newClips[i] = {
                ...newClips[i],
                startTime: prev.endTime,
                endTime: prev.endTime + newClips[i].duration
            };
        }
        
        onUpdateProject(activeProject.id, { clips: newClips });
    };

    const handleDeleteCard = (id: string) => {
        if (!activeProject) return;
        let newClips = cards.filter(c => c.id !== id);
        
        // Rippling Effect: Re-calculate all timings to close the gap after deletion
        let currentTime = 0;
        newClips = newClips.map(c => {
            const updated = {
                ...c,
                startTime: currentTime,
                endTime: currentTime + c.duration
            };
            currentTime = updated.endTime;
            return updated;
        });

        onUpdateProject(activeProject.id, { clips: newClips });
        if (selectedCardId === id) setSelectedCardId(null);
    };

    const handleGenerateImage = (id: string, prompt: string) => {
        onStatusChange?.(`Queuing generation for card ${id}: "${prompt.substring(0, 30)}..."`);
        // Integration with AI generation service would go here
    };

    // Calculate Interleaved Timeline Items (Clips + Gaps/Padding)
    const projectDuration = activeProject?.duration || 0;
    const sortedClips = [...cards].sort((a, b) => a.startTime - b.startTime);
    
    interface TimelineItem {
        type: 'clip' | 'padding';
        startTime: number;
        duration: number;
        data: any; 
    }

    const timelineItems: TimelineItem[] = [];
    
    if (activeProject && projectDuration > 0) {
        let currentTime = 0;
        
        for (const clip of sortedClips) {
            // Check for gap before this clip
            if (clip.startTime > currentTime + 0.01) {
                timelineItems.push({
                    type: 'padding',
                    startTime: currentTime,
                    duration: clip.startTime - currentTime,
                    data: { startTime: currentTime, duration: clip.startTime - currentTime }
                });
            }
            // Add the clip itself
            timelineItems.push({
                type: 'clip',
                startTime: clip.startTime,
                duration: clip.duration,
                data: clip
            });
            currentTime = Math.max(currentTime, clip.endTime);
        }
        
        // Final gap at end
        if (currentTime < projectDuration - 0.01) {
            timelineItems.push({
                type: 'padding',
                startTime: currentTime,
                duration: projectDuration - currentTime,
                data: { startTime: currentTime, duration: projectDuration - currentTime }
            });
        }
    } else {
        // Fallback for no duration: just show clips
        sortedClips.forEach(clip => {
            timelineItems.push({
                type: 'clip',
                startTime: clip.startTime,
                duration: clip.duration,
                data: clip
            });
        });
    }

    if (!activeProject) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500 gap-4">
                <span className="text-6xl opacity-20">📂</span>
                <p className="text-xl font-medium">Please select or create a project to start storyboarding.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0a0a0f] text-white">
            {/* Toolbar */}
            <div className="p-6 border-b border-gray-800/50 flex justify-between items-center bg-[#0d0d15]">
                <div className="flex items-center gap-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                             <span className="text-indigo-500">🎨</span> Story Board
                        </h2>
                        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold mt-1">Project: {activeProject.name}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Simplified header - padding cards now handle shot creation */}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-auto p-8">
                {/* Grid View - Interleaved Clips and Padding */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {timelineItems.map((item, idx) => (
                        item.type === 'clip' ? (
                            <StoryboardCardComponent 
                                key={item.data.id}
                                card={item.data}
                                onUpdate={handleUpdateCard}
                                onDelete={handleDeleteCard}
                                onGenerateImage={handleGenerateImage}
                            />
                        ) : (
                            <StoryboardPaddingCard 
                                key={`padding-${idx}-${item.startTime}`}
                                startTime={item.startTime}
                                duration={item.duration}
                                onAdd={handleFillPadding}
                            />
                        )
                    ))}
                </div>
            </div>

            {/* Persistent Animatic Timeline */}
            <div className="h-44 border-t border-gray-800/30 px-4 py-2 bg-[#050508]/50">
                <AnimaticTimeline 
                    cards={cards} 
                    onSelectCard={setSelectedCardId}
                    compact={true}
                />
            </div>

            {/* Element Tray (Side Panel placeholder) */}
            <div className="h-24 border-t border-gray-800/50 bg-[#0d0d15] p-4 flex items-center gap-6">
                <div className="flex flex-col min-w-[120px]">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Element Tray</span>
                    <span className="text-[9px] text-gray-600">Drag to prompt</span>
                </div>
                <div className="flex items-center gap-4 overflow-x-auto pb-1 flex-1">
                    <button className="h-14 w-14 rounded-full border-2 border-dashed border-gray-800 flex items-center justify-center text-gray-600 hover:border-emerald-500/50 hover:text-emerald-400 transition-all">
                        <span className="text-xl">➕</span>
                    </button>
                    {elements.map(asset => (
                        <div key={asset.id} className="group relative">
                            <div className="h-14 w-14 rounded-full bg-indigo-900/30 border border-indigo-500/30 flex items-center justify-center text-xl cursor-move hover:scale-105 transition-all">
                                👤
                            </div>
                            <span className="absolute -top-1 -right-1 bg-indigo-600 text-[8px] px-1 rounded font-bold shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                {asset.name}
                            </span>
                        </div>
                    ))}
                    {elements.length === 0 && (
                        <p className="text-[11px] text-gray-700 font-medium italic">No characters or locations defined yet...</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StoryboardModule;
