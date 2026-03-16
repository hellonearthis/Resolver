import React, { useState } from 'react';
import type { VideoClip } from '../types/assembler';
import { PacingBenchmarks } from '../types/storyboard';
import StoryboardCardComponent from '../components/storyboard/StoryboardCard';
import AnimaticTimeline from '../components/storyboard/AnimaticTimeline';
import type { BeatProject } from '../hooks/useProjectStorage';

interface StoryboardModuleProps {
    activeProject?: BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onStatusChange?: (msg: string) => void;
}

const StoryboardModule: React.FC<StoryboardModuleProps> = ({ activeProject, onUpdateProject, onStatusChange }) => {
    const [isAnimaticView, setIsAnimaticView] = useState(activeProject?.animaticEnabled || false);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

    const cards = (activeProject?.clips || []) as VideoClip[];
    const elements = activeProject?.elementTray || [];

    const handleAddCard = () => {
        if (!activeProject) return;
        
        const lastCard = cards[cards.length - 1];
        const lastLetterCode = lastCard?.shotLetter ? lastCard.shotLetter.charCodeAt(0) : 64; // '@' before 'A'
        const nextShotLetter = String.fromCharCode(lastLetterCode + 1);
        const sceneNum = lastCard?.sceneNumber || '1';
        const startTime = lastCard ? (lastCard.startTime + lastCard.duration) : 0;

        const newCard: VideoClip = {
            id: `card-${Date.now()}`,
            startTime: startTime,
            duration: 2.0,
            endTime: startTime + 2.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: `Shot ${sceneNum}${nextShotLetter}`,
            sceneNumber: sceneNum,
            shotLetter: nextShotLetter.length > 1 ? 'A' : nextShotLetter, 
            actionNotes: '',
            dialogue: '',
            soundCues: '',
            promptText: '',
            taggedElementIds: [],
            shotSize: 'MS',
            shotTypeAngle: 'Eye-level',
            cameraMovement: 'Static',
            optics: '35mm',
            equipment: '',
            locationType: 'INT',
            vfxNotes: '',
            paceWpm: PacingBenchmarks.CONVERSATIONAL
        };

        const updatedCards = [...cards, newCard];
        onUpdateProject(activeProject.id, { clips: updatedCards });
        onStatusChange?.(`Added new shot ${sceneNum}${newCard.shotLetter}`);
    };

    const handleUpdateCard = (id: string, updates: Partial<VideoClip>) => {
        if (!activeProject) return;
        
        const updatedCards = cards.map(c => {
            if (c.id === id) {
                const merged = { ...c, ...updates };
                
                // Recalculate duration if dialogue or pace changed
                if ('dialogue' in updates || 'paceWpm' in updates) {
                    const words = (merged.dialogue || '').trim().split(/\s+/).filter(w => w.length > 0);
                    const wordCount = words.length;
                    merged.duration = Math.max(1.5, (wordCount / (merged.paceWpm || PacingBenchmarks.CONVERSATIONAL)) * 60);
                    merged.endTime = merged.startTime + merged.duration;
                }
                
                return merged;
            }
            return c;
        });
        
        onUpdateProject(activeProject.id, { clips: updatedCards });
    };

    const handleDeleteCard = (id: string) => {
        if (!activeProject) return;
        const updatedCards = cards.filter(c => c.id !== id);
        onUpdateProject(activeProject.id, { clips: updatedCards });
        if (selectedCardId === id) setSelectedCardId(null);
    };

    const handleGenerateImage = (id: string, prompt: string) => {
        onStatusChange?.(`Queuing generation for card ${id}: "${prompt.substring(0, 30)}..."`);
        // Integration with AI generation service would go here
    };

    const toggleView = () => {
        const newState = !isAnimaticView;
        setIsAnimaticView(newState);
        if (activeProject) {
            onUpdateProject(activeProject.id, { animaticEnabled: newState });
        }
    };

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
                    
                    <button 
                        onClick={toggleView}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all font-bold text-sm ${isAnimaticView ? 'bg-indigo-600 border-indigo-400 shadow-indigo-500/20 shadow-lg' : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                    >
                        {isAnimaticView ? '🎞️ Animatic Timeline' : '🔳 Storyboard Grid'}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleAddCard}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
                    >
                        <span>➕</span> Add Shot
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-auto p-8">
                {!isAnimaticView ? (
                    /* Grid View */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
                        {cards.map(card => (
                            <StoryboardCardComponent 
                                key={card.id}
                                card={card}
                                onUpdate={handleUpdateCard}
                                onDelete={handleDeleteCard}
                                onGenerateImage={handleGenerateImage}
                            />
                        ))}
                        
                        {/* Empty/Add card placeholder */}
                        <div 
                            onClick={handleAddCard}
                            className="aspect-[4/5] border-2 border-dashed border-gray-800 rounded-xl flex flex-col items-center justify-center gap-4 text-gray-600 hover:border-indigo-500/50 hover:text-indigo-400 cursor-pointer transition-all group"
                        >
                            <span className="text-4xl group-hover:scale-110 transition-transform">➕</span>
                            <span className="text-xs font-bold uppercase tracking-widest">Add New Panel</span>
                        </div>
                    </div>
                ) : (
                    /* Animatic Timeline View */
                    <div className="flex flex-col h-full gap-8">
                        <div className="h-[400px]">
                            <AnimaticTimeline 
                                cards={cards} 
                                onSelectCard={setSelectedCardId}
                            />
                        </div>

                        {/* Selected Card Focus */}
                        {selectedCardId && (
                             <div className="flex-1 flex justify-center animate-fade-in">
                                 <div className="w-full max-w-sm">
                                     {cards.find(c => c.id === selectedCardId) && (
                                         <StoryboardCardComponent 
                                             card={cards.find(c => c.id === selectedCardId)!}
                                             onUpdate={handleUpdateCard}
                                             onDelete={handleDeleteCard}
                                             onGenerateImage={handleGenerateImage}
                                         />
                                     )}
                                 </div>
                             </div>
                        )}
                        
                        {!selectedCardId && cards.length > 0 && (
                            <div className="flex-1 flex items-center justify-center text-gray-600 italic text-sm">
                                Select a shot on the timeline to edit details...
                            </div>
                        )}
                    </div>
                )}
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
