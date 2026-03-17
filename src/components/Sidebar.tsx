import React, { useRef, useEffect } from 'react';

interface SidebarProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    statusLogs?: { time: Date, msg: string }[];
    activeProjectName?: string;
    panelVisibility?: {
        showMainTrack: boolean;
        showStems: boolean;
        showVideo: boolean;
        showVideoSource: boolean;
        showAudioSource: boolean;
        showProjectSelection: boolean;
        showAudioAnalysis: boolean;
    };
    onToggleVisibility?: (key: string) => void;
}

interface ModuleItem {
    id: string;
    label: string;
    icon: string;
    enabled: boolean;
}

const modules: ModuleItem[] = [
    { id: 'script-manager', label: 'Script Manager', icon: '📜', enabled: true },
    { id: 'music-video-assembler', label: 'Video Assembler', icon: '🎸', enabled: true },
    { id: 'storyboard', label: 'Story Board', icon: '🎨', enabled: true },
    { id: 'workflow-analyzer', label: 'Workflow Analyzer', icon: '🔀', enabled: true },
    { id: 'settings', label: 'Settings', icon: '⚙️', enabled: true },
];

const Sidebar: React.FC<SidebarProps> = ({ activeModule, onModuleChange, statusLogs, activeProjectName, panelVisibility, onToggleVisibility }) => {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of logs on new message
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [statusLogs]);

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="sidebar-title">
                    <span className="sidebar-icon">🎯</span>
                    Resolve Tools
                </h1>
            </div>

            <nav className="sidebar-nav">
                {modules.map((module) => (
                    <button
                        key={module.id}
                        className={`sidebar-item ${activeModule === module.id ? 'active' : ''} ${!module.enabled ? 'disabled' : ''}`}
                        onClick={() => module.enabled && onModuleChange(module.id)}
                        disabled={!module.enabled}
                    >
                        <span className="sidebar-item-icon">{module.icon}</span>
                        <span className="sidebar-item-label">{module.label}</span>
                        {!module.enabled && <span className="sidebar-item-badge">Soon</span>}
                    </button>
                ))}

                {activeProjectName && (
                    <div className="mt-6 mb-4 bg-indigo-900/20 border border-indigo-800/40 p-2 rounded-md text-xs text-indigo-200">
                        <div className="opacity-70 text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1 font-semibold">
                            <span>📂</span> Active Project
                        </div>
                        <div className="font-bold truncate text-[13px] text-indigo-100" title={activeProjectName}>
                            {activeProjectName}
                        </div>
                    </div>
                )}

                {activeModule === 'music-video-assembler' && panelVisibility && onToggleVisibility && (
                    <div className="mb-4 bg-gray-800/40 border border-gray-700/50 p-3 rounded-md">
                        <div className="opacity-70 text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1 font-semibold text-gray-400">
                            <span>👁</span> Panel Visibility
                        </div>
                        <div className="flex flex-col gap-2">
                            <button 
                                onClick={() => onToggleVisibility('showAudioSource')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showAudioSource ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🔈 Audio Source</span>
                                <span>{panelVisibility.showAudioSource ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showVideoSource')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showVideoSource ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>📁 Video Source</span>
                                <span>{panelVisibility.showVideoSource ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showProjectSelection')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showProjectSelection ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🗂 Project Selection</span>
                                <span>{panelVisibility.showProjectSelection ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showAudioAnalysis')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showAudioAnalysis ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🎛 Audio Analysis</span>
                                <span>{panelVisibility.showAudioAnalysis ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showVideo')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showVideo ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🎥 Video Timeline</span>
                                <span>{panelVisibility.showVideo ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showMainTrack')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showMainTrack ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🌊 Main Track</span>
                                <span>{panelVisibility.showMainTrack ? 'ON' : 'OFF'}</span>
                            </button>
                            <button 
                                onClick={() => onToggleVisibility('showStems')}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-all ${panelVisibility.showStems ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-900/40 text-gray-500 opacity-60'}`}
                            >
                                <span>🥁 Stems Area</span>
                                <span>{panelVisibility.showStems ? 'ON' : 'OFF'}</span>
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            <div className="sidebar-footer" style={{ borderTop: '1px solid #334155', paddingTop: '10px', marginTop: 'auto' }}>
                <div className="mb-4 bg-indigo-900/20 border border-indigo-800/40 p-2 rounded-md text-xs text-indigo-200"></div>

                <div className="sidebar-status mb-2">
                    <span className="status-dot"></span>
                    <span>System Log</span>
                </div>
                <div
                    className="status-log-window bg-gray-900/50 rounded p-2 overflow-y-auto font-mono text-gray-400"
                    style={{ maxHeight: '150px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9px' }}
                >
                    {(!statusLogs || statusLogs.length === 0) && <span>No messages yet...</span>}
                    {statusLogs?.map((log, i) => (
                        <div key={i} className="break-words">
                            <span className="text-gray-600 mr-1">[{log.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                            <span className="text-indigo-300">{log.msg}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
