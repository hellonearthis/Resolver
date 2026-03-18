import React from 'react';
import Sidebar from './Sidebar';
import QueueManager from './QueueManager';
import type { QueueItem } from '../App';

interface LayoutProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    statusLogs?: { time: Date, msg: string }[];
    activeProjectName?: string;
    children: React.ReactNode;
    panelVisibility: any;
    onToggleVisibility: (key: any) => void;
    videoQueue: QueueItem[];
    isQueuePaused: boolean;
    onTogglePauseQueue: () => void;
    onRemoveFromQueue: (id: string) => void;
    onClearQueue: () => void;
    onResetStuck: () => void;
}

const Layout: React.FC<LayoutProps> = ({ 
    activeModule, 
    onModuleChange, 
    statusLogs, 
    activeProjectName, 
    panelVisibility, 
    onToggleVisibility, 
    videoQueue,
    isQueuePaused,
    onTogglePauseQueue,
    onRemoveFromQueue,
    onClearQueue,
    onResetStuck,
    children 
}) => {
    return (
        <div className="dashboard-layout">
            <Sidebar 
                activeModule={activeModule} 
                onModuleChange={onModuleChange} 
                statusLogs={statusLogs} 
                activeProjectName={activeProjectName} 
                panelVisibility={panelVisibility}
                onToggleVisibility={onToggleVisibility}
            />
            <main className="main-content">
                <div className="content-area custom-scrollbar">
                    {children}
                </div>
                {panelVisibility.showQueue && (
                    <QueueManager 
                        queue={videoQueue}
                        isPaused={isQueuePaused}
                        onTogglePause={onTogglePauseQueue}
                        onRemove={onRemoveFromQueue}
                        onClear={onClearQueue}
                        onResetStuck={onResetStuck}
                    />
                )}
            </main>
        </div>
    );
};

export default Layout;
