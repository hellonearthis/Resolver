import React, { useState } from 'react';

interface CollapsibleCardProps {
    title: string | React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    headerRight?: React.ReactNode;
}

const CollapsibleCard: React.FC<CollapsibleCardProps & { isOpen?: boolean; onToggle?: () => void }> = ({
    title,
    children,
    defaultOpen = true,
    className = '',
    headerRight,
    isOpen: controlledIsOpen,
    onToggle
}) => {
    const [localIsOpen, setLocalIsOpen] = useState(defaultOpen);
    const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : localIsOpen;

    const handleToggle = () => {
        if (onToggle) {
            onToggle();
        } else {
            setLocalIsOpen(!localIsOpen);
        }
    };

    return (
        <div
            className={`card ${className}`}
            style={{
                padding: isOpen ? '24px' : '14px',
                marginBottom: isOpen ? '24px' : '4px'
            }}
        >
            <div
                className="card-header cursor-pointer select-none flex justify-between items-center"
                style={{ marginBottom: isOpen ? '20px' : '0' }}
                onClick={handleToggle}
                title={isOpen ? "Click to collapse" : "Click to expand"}
            >
                <div className="flex items-center gap-2">
                    <span className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                        ▶
                    </span>
                    <h3 className="card-title mb-0">{title}</h3>
                </div>
                {headerRight && <div onClick={e => e.stopPropagation()}>{headerRight}</div>}
            </div>
            <div 
                className={`card-body mt-4 animate-fade-in`}
                style={{ display: isOpen ? 'block' : 'none' }}
            >
                {children}
            </div>
        </div>
    );
};

export default CollapsibleCard;
