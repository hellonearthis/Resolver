import React from 'react';
import type { BeatProject } from '../hooks/useProjectStorage';

interface ProjectsPanelProps {
    projects: BeatProject[];
    onLoad: (project: BeatProject) => void;
    onDelete: (id: string) => void;
    onRefresh?: () => void;
    currentProjectId?: string;
    onExportAll?: () => Promise<{ success: number; failed: number; errors: string[] }>;
    exportStatus?: string;
    isExporting?: boolean;
    onCreateBlankProject?: (name?: string) => Promise<BeatProject>;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
    projects,
    onLoad,
    onDelete,
    onRefresh,
    currentProjectId,
    onExportAll,
    onCreateBlankProject
}) => {
    const [exportStatus, setExportStatus] = React.useState<string>('');
    const [isExporting, setIsExporting] = React.useState(false);
    const [blankProjectName, setBlankProjectName] = React.useState('');

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
                <div className="p-6 text-center text-[var(--text-muted)]">
                    <div className="text-4xl mb-2">📭</div>
                    <p>No saved projects yet.</p>
                    <p className="text-sm mt-1">
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
                <div className="flex items-center gap-2">
                    {onRefresh && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                            className="text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2 py-1 rounded transition-colors flex items-center gap-1"
                            title="Scan for projects on disk"
                        >
                            🔄 Refresh
                        </button>
                    )}
                    {onExportAll && (
                        <>
                            {exportStatus && <span className="text-xs text-green-400 fade-in">{exportStatus}</span>}
                            <button
                                onClick={handleBackupAll}
                                disabled={isExporting}
                                className="text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2 py-1 rounded transition-colors"
                                title="Save all projects to disk (JSON)"
                            >
                                {isExporting ? '⏳' : '💾 Backup All'}
                            </button>
                        </>
                    )}
                    {onCreateBlankProject && (
                        <div
                            className="flex items-center gap-1 bg-indigo-900/10 border border-indigo-800/30 rounded p-0.5 relative z-20"
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                        >
                            <input
                                autoFocus
                                type="text"
                                value={blankProjectName}
                                onChange={(e) => setBlankProjectName(e.target.value)}
                                onKeyDown={e => e.stopPropagation()}
                                placeholder="Project Name..."
                                className="bg-transparent border border-transparent hover:border-indigo-800/50 focus:border-indigo-500 rounded text-xs text-indigo-100 px-2 py-1 w-32 focus:outline-none placeholder-indigo-400 transition-colors"
                            />
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await onCreateBlankProject(blankProjectName.trim() || undefined);
                                    setBlankProjectName('');
                                }}
                                className="text-xs bg-indigo-600/50 hover:bg-indigo-500/70 border border-indigo-400/50 px-2 py-1 rounded transition-colors"
                                title="Create a new blank project timeline"
                            >
                                ➕ Blank Project
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <div className="relative">
                {/* TOP FADE */}
                <div className="pointer-events-none absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[var(--bg-primary)] to-transparent z-10 rounded-t-lg"></div>

                {/* SCROLL AREA */}
                <div className="scrollbar max-h-[300px] overflow-y-auto scroll-smooth flex flex-col gap-3 p-2">
                    {projects.map(project => (
                        <div
                            key={project.id}
                            className={`group flex items-center gap-3 py-3 px-4 rounded-lg cursor-pointer transition-all duration-200 border-l-4 hover:-translate-y-[2px] hover:shadow-md hover:bg-[#62411f] hover:border-l-indigo-400 ${project.id === currentProjectId ? 'border-l-indigo-500 bg-[#62411f] shadow-md' : 'border-transparent bg-[var(--bg-tertiary)]'}`}
                            onClick={() => onLoad(project)}
                        >
                            <div className={`text-2xl transition-transform duration-200 group-hover:scale-110 ${project.id === currentProjectId ? 'playing-icon' : ''}`}>🎵</div>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                                    {project.name}
                                </div>
                                <div className="text-xs text-[var(--text-muted)] flex gap-3 mt-1">
                                    <span>{project.bpm} BPM</span>
                                    <span>{project.beatCount} beats</span>
                                    <span>{project.frameRate} fps</span>
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] mt-[2px]">
                                    {formatDate(project.updatedAt)}
                                </div>
                            </div>

                            {/* Status Badges */}
                            <div className="flex gap-1 items-center">
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
                                className="btn btn-secondary px-2 py-1 text-sm min-w-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(project.id);
                                }}
                                title="Delete project"
                            >
                                🗑️
                            </button>
                        </div>
                    ))}
                </div>

                {/* BOTTOM FADE */}
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--bg-primary)] to-transparent z-10 rounded-b-lg"></div>
            </div>
        </div>
    );
};

export default ProjectsPanel;
