import React from 'react';
import Sidebar from './Sidebar';

interface LayoutProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    statusLogs?: { time: Date, msg: string }[];
    activeProjectName?: string;
    children: React.ReactNode;
    panelVisibility: any;
    onToggleVisibility: (key: any) => void;
}

const Layout: React.FC<LayoutProps> = ({ activeModule, onModuleChange, statusLogs, activeProjectName, panelVisibility, onToggleVisibility, children }) => {
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
                {children}
            </main>
        </div>
    );
};

export default Layout;
