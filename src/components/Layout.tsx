import React from 'react';
import Sidebar from './Sidebar';
import QueueManager from './QueueManager';
import type { QueueItem } from '../App';

export interface PanelVisibilityState {
    showMainTrack: boolean;
    showStems: boolean;
    showVideo: boolean;
    showVideoSource: boolean;
    showAudioSource: boolean;
    showProjectSelection: boolean;
    showAudioAnalysis: boolean;
    showQueue: boolean;
}

interface LayoutProps {
    activeModule: string;
    onModuleChange: (module_identifier: string) => void;
    statusLogs?: { time: Date; msg: string }[];
    activeProjectName?: string;
    children: React.ReactNode;
    panelVisibility: PanelVisibilityState;
    onToggleVisibility: (panel_key: string) => void;
    videoQueue: QueueItem[];
    isQueuePaused: boolean;
    onTogglePauseQueue: () => void;
    onRemoveFromQueue: (queue_item_identifier: string) => void;
    onClearQueue: () => void;
    onResetStuck: () => void;
}

// WHAT: Main layout wrapper encapsulating navigation sidebar, main content body, and sticky queue drawer.
// WHY: Ensures consistent layout framing across all audio, storyboard, assembler, and settings modules.
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
