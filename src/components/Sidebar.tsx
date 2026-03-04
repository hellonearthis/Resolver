import React, { useRef, useEffect } from 'react';

interface SidebarProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    statusLogs?: { time: Date, msg: string }[];
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
    { id: 'settings', label: 'Settings', icon: '⚙️', enabled: true },
    { id: 'ltx-test', label: 'LTX Video Test', icon: '🎥', enabled: true },
];

const Sidebar: React.FC<SidebarProps> = ({ activeModule, onModuleChange, statusLogs }) => {
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
            </nav>

            <div className="sidebar-footer" style={{ borderTop: '1px solid #334155', paddingTop: '10px', marginTop: 'auto' }}>
                <div className="sidebar-status mb-2">
                    <span className="status-dot"></span>
                    <span>System Log</span>
                </div>
                <div
                    className="status-log-window bg-gray-900/50 rounded p-2 overflow-y-auto text-xs font-mono text-gray-400"
                    style={{ maxHeight: '150px', display: 'flex', flexDirection: 'column', gap: '4px' }}
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
