import React from 'react';
import type { BeatProject } from '../hooks/useProjectStorage';

interface ProjectsPanelProps {
    projects: BeatProject[];
    onLoad: (project: BeatProject) => void;
    onDelete: (id: string) => void;
    currentProjectId?: string;
    onExportAll?: () => Promise<{ success: number; failed: number }>;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
    projects,
    onLoad,
    onDelete,
    currentProjectId,
    onExportAll
}) => {
    const [exportStatus, setExportStatus] = React.useState<string>('');
    const [isExporting, setIsExporting] = React.useState(false);

    const handleBackupAll = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onExportAll) return;

        setIsExporting(true);
        setExportStatus('Backing up...');

        try {
            const result = await onExportAll();
            setExportStatus(`Saved ${result.success} projects!`);
            setTimeout(() => setExportStatus(''), 3000);
        } catch (e) {
            setExportStatus('Backup failed');
        } finally {
            setIsExporting(false);
        }
    };

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
            <div className="card-header flex justify-between items-center">
                <h3 className="card-title">📂 Saved Projects ({projects.length})</h3>
                {onExportAll && (
                    <div className="flex items-center gap-2">
                        {exportStatus && <span className="text-xs text-green-400 fade-in">{exportStatus}</span>}
                        <button
                            onClick={handleBackupAll}
                            disabled={isExporting}
                            className="text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2 py-1 rounded transition-colors"
                            title="Save all projects to disk (JSON)"
                        >
                            {isExporting ? '⏳' : '💾 Backup All'}
                        </button>
                    </div>
                )}
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

                        {/* Status Badges */}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {/* CSV Badge */}
                            {project.csvPath && (
                                <span
                                    className="status-badge success"
                                    style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                    title="Has exported CSV"
                                >
                                    CSV
                                </span>
                            )}

                            {/* Stems Badge */}
                            {project.stems && project.stems.length > 0 && (
                                <span
                                    className="status-badge"
                                    style={{
                                        fontSize: '0.65rem',
                                        padding: '2px 6px',
                                        background: 'rgba(99, 102, 241, 0.2)', // Indigo tint
                                        color: '#818cf8',
                                        border: '1px solid rgba(99, 102, 241, 0.3)'
                                    }}
                                    title={`${project.stems.length} Stems Available`}
                                >
                                    STEMS
                                </span>
                            )}

                            {/* Beat Data Badge */}
                            {(project.beatCount && project.beatCount > 0) || (project.markers && project.markers.length > 0) ? (
                                <span
                                    className="status-badge"
                                    style={{
                                        fontSize: '0.65rem',
                                        padding: '2px 6px',
                                        background: 'rgba(16, 185, 129, 0.15)', // Green tint
                                        color: '#34d399', // Green text
                                        border: '1px solid rgba(16, 185, 129, 0.2)'
                                    }}
                                    title="Has Beat Detection Data"
                                >
                                    BEATS
                                </span>
                            ) : null}
                        </div>
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
                ))
                }
            </div >
        </div >
    );
};

export default ProjectsPanel;
