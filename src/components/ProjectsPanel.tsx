import React from 'react';
import type { BeatProject } from '../hooks/useProjectStorage';

interface ProjectsPanelProps {
    projects: BeatProject[];
    onLoad: (project: BeatProject) => void;
    onDelete: (id: string) => void;
    currentProjectId?: string;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
    projects,
    onLoad,
    onDelete,
    currentProjectId
}) => {
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (projects.length === 0) {
        return (
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">📂 Saved Projects</h3>
                </div>
                <div style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--text-muted)'
                }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📭</div>
                    <p>No saved projects yet.</p>
                    <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                        Analyze an audio file and click "Save Project" to store it here.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">📂 Saved Projects ({projects.length})</h3>
            </div>
            <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                {projects.map(project => (
                    <div
                        key={project.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            background: project.id === currentProjectId
                                ? 'var(--accent-primary)'
                                : 'var(--bg-tertiary)',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onClick={() => onLoad(project)}
                    >
                        <div style={{ fontSize: '1.5rem' }}>🎵</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {project.name}
                            </div>
                            <div style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-muted)',
                                display: 'flex',
                                gap: '12px',
                                marginTop: '4px'
                            }}>
                                <span>{project.bpm} BPM</span>
                                <span>{project.beatCount} beats</span>
                                <span>{project.frameRate} fps</span>
                            </div>
                            <div style={{
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)',
                                marginTop: '2px'
                            }}>
                                {formatDate(project.updatedAt)}
                            </div>
                        </div>
                        {project.csvPath && (
                            <span
                                className="status-badge success"
                                style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                            >
                                CSV
                            </span>
                        )}
                        <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(project.id);
                            }}
                            style={{
                                padding: '6px 10px',
                                fontSize: '0.85rem',
                                minWidth: 'auto'
                            }}
                            title="Delete project"
                        >
                            🗑️
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ProjectsPanel;
