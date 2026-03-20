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
    onGenerateVideo?: (clipId: string) => Promise<void>;
    onPickImage?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    onCopyImageFromNext?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    comfyConnected?: boolean;
}

const StoryboardModule: React.FC<StoryboardModuleProps> = ({ 
    activeProject, 
    onUpdateProject, 
    onGenerateVideo,
    onPickImage,
    onCopyImageFromNext,
    comfyConnected
}) => {
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

    const cards = (activeProject?.clips || []) as VideoClip[];

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
        const hasDialogueUpdate = updates.notes && 'dialogue' in updates.notes && updates.notes.dialogue !== currentClip.notes?.dialogue;
        const hasPaceUpdate = updates.paceWpm !== undefined && updates.paceWpm !== currentClip.paceWpm;

        if (hasDialogueUpdate || hasPaceUpdate) {
            const dialogue = updatedClip.notes?.dialogue || '';
            const words = dialogue.trim().split(/\s+/).filter((w: string) => w.length > 0);
            const wordCount = words.length;
            
            // Only recalculate duration if there are words, or if there were words and they were just deleted
            if (wordCount > 0 || (wordCount === 0 && currentClip.notes?.dialogue)) {
                const rawDuration = Math.max(1.5, (wordCount / (updatedClip.paceWpm || PacingBenchmarks.CONVERSATIONAL)) * 60);
                const frameRate = activeProject.frameRate || 20;
                updatedClip.duration = getLtxAlignedDuration(rawDuration, frameRate);
            }
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

    // handleGenerateImage removed as requested

    const handleSyncGeneratedVideos = async () => {
        if (!activeProject?.outputDir) return;

        const fs = window.require('fs');
        const path = window.require('path');
        const videosDir = path.join(activeProject.outputDir, 'videos');

        if (!fs.existsSync(videosDir)) return;

        try {
            const files = fs.readdirSync(videosDir).filter((f: string) => f.endsWith('.mp4'));
            let updateCount = 0;

            const updatedClips = cards.map(clip => {
                const safeLabel = clip.label.replace(/[^a-z0-9]/gi, '_');
                
                // 1. Identify which videos currently exist in the videos folder for this clip
                const matchingFiles = files.filter((f: string) => {
                    const regex = new RegExp(`^${safeLabel}_take(\\d+)\\.mp4$`, 'i');
                    return regex.test(f);
                }).map((f: string) => {
                    const takeNum = parseInt(f.match(/_take(\d+)\.mp4$/i)?.[1] || "0", 10);
                    return {
                        fullPath: path.join(videosDir, f),
                        take: takeNum
                    };
                }).sort((a: any, b: any) => b.take - a.take);

                const foundPaths = matchingFiles.map((m: any) => m.fullPath);
                
                // 2. Cross-reference with existing project data to catch deleted or manual additions
                const existingVideos = clip.generatedVideos || [];
                // Only keep existing videos that still exist on disk
                const stillExisting = existingVideos.filter((p: string) => fs.existsSync(p));
                
                // Combine and deduplicate
                const combinedVideos = Array.from(new Set([...stillExisting, ...foundPaths]));
                
                // 3. Check active video path
                let currentVideoPath = clip.videoPath;
                const activeExists = currentVideoPath ? fs.existsSync(currentVideoPath) : false;

                // Determine if we need an update
                const videosChanged = combinedVideos.length !== existingVideos.length;
                const activeMissing = currentVideoPath && !activeExists;
                const statusUpdate = (combinedVideos.length > 0 && clip.status !== 'done');

                if (videosChanged || activeMissing || statusUpdate) {
                    updateCount++;
                    
                    // If active video is missing, try to pick the latest take
                    if (activeMissing || !currentVideoPath) {
                        currentVideoPath = matchingFiles.length > 0 ? matchingFiles[0].fullPath : (combinedVideos.length > 0 ? combinedVideos[0] : undefined);
                    }

                    return {
                        ...clip,
                        status: combinedVideos.length > 0 ? 'done' as const : (clip.status === 'done' ? 'pending' : clip.status),
                        videoPath: currentVideoPath,
                        generatedVideos: combinedVideos
                    };
                }
                return clip;
            });

            if (updateCount > 0) {
                onUpdateProject(activeProject.id, { clips: updatedClips });
            }
        } catch (err) {
            console.error("Sync error:", err);
        }
    };

    // Calculate Interleaved Timeline Items (Clips + Gaps/Padding)
    const projectDuration = activeProject?.duration || 0;
    const sortedClips = [...cards].sort((a, b) => a.startTime - b.startTime);
    
    const timelineItems: any[] = []; // Using any[] temporarily or align with TimelineRow
    
    if (activeProject && projectDuration > 0) {
        let currentTime = 0;
        
        for (const clip of sortedClips) {
            // Check for gap before this clip
            if (clip.startTime > currentTime + 0.01) {
                timelineItems.push({
                    type: 'unselected',
                    startTime: currentTime,
                    endTime: clip.startTime,
                    duration: clip.startTime - currentTime,
                    label: 'Gap'
                });
            }
            // Add the clip itself
            timelineItems.push({
                type: 'clip',
                startTime: clip.startTime,
                endTime: clip.endTime,
                duration: clip.duration,
                clip: clip,
                label: clip.label
            });
            currentTime = Math.max(currentTime, clip.endTime);
        }
        
        // Final gap at end
        if (currentTime < projectDuration - 0.01) {
            timelineItems.push({
                type: 'unselected',
                startTime: currentTime,
                endTime: projectDuration,
                duration: projectDuration - currentTime,
                label: 'Gap'
            });
        }
    } else {
        // Fallback for no duration: just show clips
        sortedClips.forEach(clip => {
            timelineItems.push({
                type: 'clip',
                startTime: clip.startTime,
                endTime: clip.endTime,
                duration: clip.duration,
                clip: clip,
                label: clip.label
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
                    <button 
                        onClick={handleSyncGeneratedVideos}
                        className="flex items-center gap-2 px-3 py-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded-full border border-indigo-500/30 transition-all text-[10px] font-bold uppercase tracking-widest"
                    >
                        <span>🔄</span> Sync Videos
                    </button>
                    <div className="flex items-center gap-2 px-3 py-1 bg-black/40 rounded-full border border-gray-800/50">
                        <div className={`w-2 h-2 rounded-full ${comfyConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                            {comfyConnected ? 'Comfy Connected' : 'Comfy Offline'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-auto p-8">
                {/* Grid View - Interleaved Clips and Padding */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {timelineItems.map((item, idx) => (
                        item.type === 'clip' ? (() => {
                            const currentIdx = sortedClips.findIndex(c => c.id === item.clip.id);
                            const nextClip = sortedClips[currentIdx + 1];
                            return (
                                <StoryboardCardComponent 
                                    key={item.clip.id}
                                    card={item.clip}
                                    frameRate={activeProject?.frameRate || 20}
                                    onUpdate={handleUpdateCard}
                                    onDelete={handleDeleteCard}
                                    onGenerateVideo={onGenerateVideo}
                                    onPickImage={onPickImage}
                                    onCopyImageFromNext={onCopyImageFromNext}
                                    nextClipStartImage={nextClip?.startImagePath}
                                    comfyConnected={comfyConnected}
                                />
                            );
                        })() : (
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
                    items={timelineItems} 
                    onSelectCard={setSelectedCardId}
                    compact={true}
                    onAddPadding={handleFillPadding}
                />
            </div>

        </div>
    );
};

export default StoryboardModule;
