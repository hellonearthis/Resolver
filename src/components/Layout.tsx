import React from 'react';
import Sidebar from './Sidebar';

interface LayoutProps {
    activeModule: string;
    onModuleChange: (module: string) => void;
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ activeModule, onModuleChange, children }) => {
    return (
        <div className="dashboard-layout">
            <Sidebar activeModule={activeModule} onModuleChange={onModuleChange} />
            <main className="main-content">
                {children}
            </main>
        </div>
    );
};

export default Layout;
