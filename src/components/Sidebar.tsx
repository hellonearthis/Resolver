import React from 'react';

interface SidebarProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
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
];

const Sidebar: React.FC<SidebarProps> = ({ activeModule, onModuleChange }) => {
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

            <div className="sidebar-footer">
                <div className="sidebar-status">
                    <span className="status-dot"></span>
                    <span>Ready</span>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
