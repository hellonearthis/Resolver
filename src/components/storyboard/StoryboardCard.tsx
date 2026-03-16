import React from 'react';
import type { StoryboardCard } from '../../types/storyboard';

interface CardProps {
    card: StoryboardCard;
    onUpdate: (id: string, updates: Partial<StoryboardCard>) => void;
    onDelete: (id: string) => void;
    onGenerateImage: (id: string, prompt: string) => void;
}

const StoryboardCardComponent: React.FC<CardProps> = ({ card, onUpdate, onDelete, onGenerateImage }) => {
    const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

    return (
        <div className="bg-[#1a1a2e] border border-gray-700/50 rounded-xl overflow-hidden shadow-2xl transition-all hover:border-indigo-500/50 group flex flex-col h-full">
            {/* Header: Scene/Shot Info */}
            <div className="px-3 py-2 bg-black/40 border-b border-gray-700/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <input 
                        className="bg-transparent border-none text-[10px] font-bold text-indigo-400 uppercase tracking-widest w-12 focus:ring-0" 
                        value={card.sceneNumber} 
                        onChange={(e) => onUpdate(card.id, { sceneNumber: e.target.value })}
                        placeholder="SCENE"
                    />
                    <input 
                        className="bg-transparent border-none text-[10px] font-bold text-emerald-400 uppercase tracking-widest w-12 focus:ring-0" 
                        value={card.shotLetter} 
                        onChange={(e) => onUpdate(card.id, { shotLetter: e.target.value })}
                        placeholder="SHOT"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 font-mono">{card.calculatedDuration.toFixed(1)}s</span>
                    <button 
                        onClick={() => onDelete(card.id)}
                        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Frame / Image Generation */}
            <div className="relative aspect-video bg-black/60 flex items-center justify-center overflow-hidden">
                {card.imageUrl ? (
                    <img src={card.imageUrl} alt="Storyboard Frame" className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-600">
                        <span className="text-3xl">🖼️</span>
                        <span className="text-[10px] uppercase tracking-tighter">No Image</span>
                    </div>
                )}
                
                {/* Inline Prompt & Magic Wand */}
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                    <div className="flex items-center gap-2 bg-gray-900/80 rounded-lg p-1 border border-indigo-500/30">
                        <input 
                            className="bg-transparent border-none text-white text-[11px] flex-1 px-2 focus:ring-0 placeholder-gray-500"
                            placeholder="Describe the shot..."
                            value={card.aiPrompt}
                            onChange={(e) => onUpdate(card.id, { aiPrompt: e.target.value })}
                        />
                        <button 
                            onClick={() => onGenerateImage(card.id, card.aiPrompt)}
                            className="p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs shadow-lg transition-colors"
                            title="Generate Frame"
                        >
                            ✨
                        </button>
                    </div>
                </div>
            </div>

            {/* Core Data Fields */}
            <div className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Action Notes</label>
                    <textarea 
                        className="bg-transparent border-none text-xs text-gray-200 resize-none p-0 focus:ring-0 min-h-[40px]"
                        placeholder="Describe the physical movement..."
                        value={card.actionNotes}
                        onChange={(e) => onUpdate(card.id, { actionNotes: e.target.value })}
                    />
                </div>

                <div className="flex flex-col gap-1 border-t border-gray-700/30 pt-3">
                    <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Dialogue</label>
                    <textarea 
                        className="bg-transparent border-none text-xs text-indigo-200/90 font-medium italic resize-none p-0 focus:ring-0"
                        placeholder="Lines of speech..."
                        value={card.dialogue}
                        onChange={(e) => onUpdate(card.id, { dialogue: e.target.value })}
                    />
                </div>

                <div className="flex flex-col gap-1 border-t border-gray-700/30 pt-3">
                    <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Sound Cues</label>
                    <input 
                        className="bg-transparent border-none text-xs text-emerald-400/80 p-0 focus:ring-0"
                        placeholder="SFX, music..."
                        value={card.soundCues}
                        onChange={(e) => onUpdate(card.id, { soundCues: e.target.value })}
                    />
                </div>
            </div>

            {/* Metadata Drawer Toggle */}
            <button 
                onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                className="w-full py-1.5 bg-gray-800/50 hover:bg-gray-800 text-[9px] font-bold text-gray-500 uppercase tracking-widest transition-colors flex items-center justify-center gap-1"
            >
                {isDrawerOpen ? '🔼 Close Props' : '🔽 Production Props'}
            </button>

            {/* Metadata Drawer content */}
            {isDrawerOpen && (
                <div className="p-4 bg-black/40 border-t border-gray-700/50 grid grid-cols-2 gap-3 animate-slide-down">
                    <div className="flex flex-col gap-1">
                        <label className="text-[8px] text-gray-500 font-bold uppercase">Shot Size</label>
                        <select 
                            className="bg-gray-900 border border-gray-700 rounded text-[10px] p-1 text-white"
                            value={card.shotSize}
                            onChange={(e) => onUpdate(card.id, { shotSize: e.target.value })}
                        >
                            <option value="WS">WS (Wide)</option>
                            <option value="MS">MS (Medium)</option>
                            <option value="CU">CU (Close-up)</option>
                            <option value="EWS">EWS (Ext Wide)</option>
                            <option value="ECU">ECU (Ext Close)</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[8px] text-gray-500 font-bold uppercase">Camera Angle</label>
                        <select 
                            className="bg-gray-900 border border-gray-700 rounded text-[10px] p-1 text-white"
                            value={card.shotTypeAngle}
                            onChange={(e) => onUpdate(card.id, { shotTypeAngle: e.target.value })}
                        >
                            <option value="Eye-level">Eye-level</option>
                            <option value="High Angle">High Angle</option>
                            <option value="Low Angle">Low Angle</option>
                            <option value="Dutch Tilt">Dutch Tilt</option>
                            <option value="OTS">OTS</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[8px] text-gray-500 font-bold uppercase">Movement</label>
                        <select 
                            className="bg-gray-900 border border-gray-700 rounded text-[10px] p-1 text-white"
                            value={card.cameraMovement}
                            onChange={(e) => onUpdate(card.id, { cameraMovement: e.target.value })}
                        >
                            <option value="Static">Static</option>
                            <option value="Pan">Pan</option>
                            <option value="Tilt">Tilt</option>
                            <option value="Dolly">Dolly</option>
                            <option value="Handheld">Handheld</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[8px] text-gray-500 font-bold uppercase">Pace (WPM)</label>
                        <input 
                            type="number"
                            className="bg-gray-900 border border-gray-700 rounded text-[10px] p-1 text-white"
                            value={card.paceWpm}
                            onChange={(e) => onUpdate(card.id, { paceWpm: Number(e.target.value) })}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoryboardCardComponent;
