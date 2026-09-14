import React from 'react';
import type { BeatProject } from '../hooks/useProjectStorage';

interface ProjectsPanelProps {
    projects: BeatProject[];
    onLoad: (selected_project: BeatProject) => void;
    onDelete: (project_identifier: string) => void;
    onRefresh?: () => void;
    currentProjectId?: string;
    onExportAll?: () => Promise<{ success: number; failed: number; errors: string[] }>;
    exportStatus?: string;
    isExporting?: boolean;
    onCreateBlankProject?: (project_name?: string) => Promise<BeatProject>;
}

// WHAT: Interactive panel displaying all saved Resolver projects with metadata badges and disk actions.
// WHY: Allows video creators to quickly switch between songs, backup bundles to disk, and instantiate blank projects.
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

    // WHAT: Triggers full project directory backup to disk as JSON bundles.
    // WHY: Provides safety against data loss and permits easy sharing or archiving of timeline state.
    const handleBackupAll = async (click_event: React.MouseEvent) => {
        click_event.stopPropagation();
        if (!onExportAll) return;

        setIsExporting(true);
        setExportStatus('Backing up...');

        try {
            const backup_result = await onExportAll();
            setExportStatus(`Saved ${backup_result.success} projects!`);
            setTimeout(() => setExportStatus(''), 3000);
        } catch {
            setExportStatus('Backup failed');
        } finally {
            setIsExporting(false);
        }
    };

    // WHAT: Formats ISO timestamp strings into user-friendly localized dates.
    // WHY: Keeps project cards scannable by relative update recency.
    const formatTimestampDisplay = (iso_date_string: string) => {
        const parsed_date = new Date(iso_date_string);
        return parsed_date.toLocaleDateString() + ' ' + parsed_date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="card">
            <div className="card-header flex justify-between items-center">
                <h3 className="card-title">📂 Saved Projects ({projects.length})</h3>
                <div className="flex items-center gap-2">
                    {onRefresh && (
                        <button
                            onClick={(click_event) => { click_event.stopPropagation(); onRefresh(); }}
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
                            onClick={click_event => click_event.stopPropagation()}
                            onMouseDown={mouse_event => mouse_event.stopPropagation()}
                        >
                            <input
                                autoFocus
                                type="text"
                                value={blankProjectName}
                                onChange={(change_event) => setBlankProjectName(change_event.target.value)}
                                onKeyDown={keyboard_event => keyboard_event.stopPropagation()}
                                placeholder="Project Name..."
                                className="bg-transparent border border-transparent hover:border-indigo-800/50 focus:border-indigo-500 rounded text-xs text-indigo-100 px-2 py-1 w-32 focus:outline-none placeholder-indigo-400 transition-colors"
                            />
                            <button
                                onClick={async (click_event) => {
                                    click_event.stopPropagation();
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

            {projects.length === 0 ? (
                <div className="p-6 text-center text-[var(--text-muted)]">
                    <div className="text-4xl mb-2">📭</div>
                    <p className="font-semibold text-[var(--text-primary)]">No saved projects yet.</p>
                    <p className="text-sm mt-1">
                        Use the <strong>➕ Blank Project</strong> field above to start, or analyze an audio file in the drop zone.
                    </p>
                </div>
            ) : (
            <div className="relative">
                {/* TOP FADE */}
                <div className="pointer-events-none absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[var(--bg-primary)] to-transparent z-10 rounded-t-lg"></div>

                {/* SCROLL AREA */}
                <div className="scrollbar max-h-[300px] overflow-y-auto scroll-smooth flex flex-col gap-3 p-2">
                    {projects.map(project_item => (
                        <div
                            key={project_item.id}
                            className={`group flex items-center gap-3 py-3 px-4 rounded-lg cursor-pointer transition-all duration-200 border-l-4 hover:-translate-y-[2px] hover:shadow-md hover:bg-[#62411f] hover:border-l-indigo-400 ${project_item.id === currentProjectId ? 'border-l-indigo-500 bg-[#62411f] shadow-md' : 'border-transparent bg-[var(--bg-tertiary)]'}`}
                            onClick={() => onLoad(project_item)}
                        >
                            <div className={`text-2xl transition-transform duration-200 group-hover:scale-110 ${project_item.id === currentProjectId ? 'playing-icon' : ''}`}>🎵</div>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                                    {project_item.name}
                                </div>
                                <div className="text-xs text-[var(--text-muted)] flex gap-3 mt-1">
                                    <span>{project_item.bpm} BPM</span>
                                    <span>{project_item.beatCount} beats</span>
                                    <span>{project_item.frameRate} fps</span>
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] mt-[2px]">
                                    {formatTimestampDisplay(project_item.updatedAt)}
                                </div>
                            </div>

                            {/* Status Badges */}
                            <div className="flex gap-1 items-center">
                                {/* CSV Badge */}
                                {project_item.csvPath && (
                                    <span
                                        className="status-badge success"
                                        style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                        title="Has exported CSV"
                                    >
                                        CSV
                                    </span>
                                )}

                                {/* Stems Badge */}
                                {project_item.stems && project_item.stems.length > 0 && (
                                    <span
                                        className="status-badge"
                                        style={{
                                            fontSize: '0.65rem',
                                            padding: '2px 6px',
                                            background: 'rgba(99, 102, 241, 0.2)', // Indigo tint
                                            color: '#818cf8',
                                            border: '1px solid rgba(99, 102, 241, 0.3)'
                                        }}
                                        title={`${project_item.stems.length} Stems Available`}
                                    >
                                        STEMS
                                    </span>
                                )}

                                {/* Beat Data Badge */}
                                {(project_item.beatCount && project_item.beatCount > 0) || (project_item.markers && project_item.markers.length > 0) ? (
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
                                onClick={(click_event) => {
                                    click_event.stopPropagation();
                                    onDelete(project_item.id);
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
            )}
        </div>
    );
};

export default ProjectsPanel;
