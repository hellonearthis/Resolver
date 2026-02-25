import React, { useState } from 'react';

interface CollapsibleCardProps {
    title: string | React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    headerRight?: React.ReactNode;
}

const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
    title,
    children,
    defaultOpen = true,
    className = '',
    headerRight
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

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
                onClick={() => setIsOpen(!isOpen)}
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
            {isOpen && (
                <div className="card-body mt-4 animate-fade-in">
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleCard;
