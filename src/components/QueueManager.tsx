import React from 'react';
import type { QueueItem } from '../App';

interface QueueManagerProps {
    queue: QueueItem[];
    isPaused: boolean;
    onTogglePause: () => void;
    onRemove: (id: string) => void;
    onClear: () => void;
    onResetStuck: () => void;
}

const QueueManager: React.FC<QueueManagerProps> = ({ queue, isPaused, onTogglePause, onRemove, onClear, onResetStuck }) => {
    const processingItem = queue.find(item => item.status === 'processing');
    const pendingItems = queue.filter(item => item.status === 'queued');
    const completedItems = queue.filter(item => item.status === 'done' || item.status === 'error');

    return (
        <div className="flex flex-col h-full bg-[#0d0d15] border-l border-gray-800/50 w-80 shadow-2xl z-30">
            <div className="p-4 border-b border-gray-800/50 flex justify-between items-center bg-[#1a1a25]/30">
                <div className="flex items-center gap-2">
                    <span className="text-lg">📋</span>
                    <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-400">Queue</h3>
                </div>
                <div className="flex gap-1.5 font-bold">
                    <button 
                        onClick={onResetStuck}
                        className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-500/20 transition-all text-[10px]"
                        title="Reset Stuck 'Generating' Statuses"
                    >
                        🛠️
                    </button>
                    <button 
                        onClick={onTogglePause}
                        className={`p-1.5 rounded-md transition-all flex items-center gap-1 text-[10px] uppercase tracking-widest ${isPaused ? 'bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-white border border-green-500/30' : 'bg-amber-600/20 text-amber-400 hover:bg-amber-600 hover:text-white border border-amber-500/30'}`}
                        title={isPaused ? "Resume Queue" : "Pause Queue"}
                    >
                        {isPaused ? '▶️' : '⏸️'}
                    </button>
                    <button 
                        onClick={onClear}
                        className="p-1.5 rounded-md bg-red-600/10 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/20 transition-all"
                        title="Clear Completed"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {/* Active Item */}
                {processingItem && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                            Active Task
                        </label>
                        <div className="bg-indigo-600/10 border border-indigo-500/30 rounded-lg p-3 space-y-2 relative overflow-hidden group">
                            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                            <div className="flex justify-between items-start">
                                <span className="text-xs font-semibold text-white truncate pr-2">{processingItem.label}</span>
                                <span className="text-[10px] font-bold text-indigo-400 uppercase bg-indigo-500/10 px-1 rounded italic">Running</span>
                            </div>
                            <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5">
                                <div 
                                    className="bg-gradient-to-r from-indigo-600 to-purple-500 h-full transition-all duration-300" 
                                    style={{ width: `${processingItem.progress || 0}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-400 uppercase font-bold">
                                <span className="animate-pulse">Generating...</span>
                                <span>{processingItem.progress || 0}%</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Pending Items */}
                {pendingItems.length > 0 && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">
                            Pending ({pendingItems.length})
                        </label>
                        <div className="space-y-2">
                            {pendingItems.map(item => (
                                <div key={item.id} className="bg-gray-800/20 border border-gray-700/50 rounded-lg p-3 flex justify-between items-center group hover:border-gray-600/50 transition-all">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10px] text-gray-600 font-mono">#{item.id.split('-')[1]}</span>
                                        <span className="text-xs font-medium text-gray-300 truncate pr-2">{item.label}</span>
                                    </div>
                                    <button 
                                        onClick={() => onRemove(item.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-gray-500 transition-all text-sm"
                                        title="Remove from queue"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Completed/Error Items */}
                {completedItems.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-center pl-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">History</label>
                        </div>
                        <div className="space-y-2">
                            {completedItems.sort((a,b) => b.addedAt - a.addedAt).slice(0, 10).map(item => (
                                <div key={item.id} className={`bg-black/20 border rounded-lg p-3 flex justify-between items-center ${item.status === 'done' ? 'border-green-500/10' : 'border-red-500/10'}`}>
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-1 h-1 rounded-full ${item.status === 'done' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                            <span className={`text-[11px] font-medium truncate ${item.status === 'done' ? 'text-green-500/70' : 'text-red-500/70'}`}>{item.label}</span>
                                        </div>
                                        {item.error && <span className="text-[9px] text-red-500/50 truncate mt-1 pl-3">{item.error}</span>}
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-tight shrink-0 px-1.5 py-0.5 rounded ${item.status === 'done' ? 'bg-green-500/10 text-green-500/40' : 'bg-red-500/10 text-red-500/40'}`}>
                                        {item.status === 'done' ? 'Success' : 'Failed'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {queue.length === 0 && (
                    <div className="h-60 flex flex-col items-center justify-center text-gray-600/40 gap-4">
                        <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-800 flex items-center justify-center text-2xl">⚡</div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-center">No active tasks</p>
                    </div>
                )}
            </div>
            
            <div className="p-4 bg-black/40 border-t border-gray-800/30">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-gray-600">
                    <span>Sequential Processor</span>
                    <span className={isPaused ? "text-amber-500" : "text-green-500"}>{isPaused ? "Paused" : "Active"}</span>
                </div>
            </div>
        </div>
    );
};

export default QueueManager;
