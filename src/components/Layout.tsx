import React from 'react';
import Sidebar from './Sidebar';

interface LayoutProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    statusLogs?: { time: Date, msg: string }[];
    activeProjectName?: string;
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ activeModule, onModuleChange, statusLogs, activeProjectName, children }) => {
    return (
        <div className="dashboard-layout">
            <Sidebar activeModule={activeModule} onModuleChange={onModuleChange} statusLogs={statusLogs} activeProjectName={activeProjectName} />
            <main className="main-content">
                {children}
            </main>
        </div>
    );
};

export default Layout;
