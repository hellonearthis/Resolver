import { useState, useEffect } from 'react';
import useProjectStorage, { type BeatProject } from './hooks/useProjectStorage';
import Layout from './components/Layout';
import BeatExtractionModule from './modules/BeatExtractionModule';
import ScriptManagerModule from './modules/ScriptManagerModule';
import StemSeparationModule from './modules/StemSeparationModule';
import SettingsModule from './modules/SettingsModule';
import DropZone from './components/DropZone';
import BeatVisualizer from './components/BeatVisualizer';
import { analyzeBeats } from './services/essentiaService';



// Define types for Electron IPC
declare global {
  interface Window {
    require: any;
  }
}

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// Video Sync Module (legacy functionality)
function VideoSyncModule() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [beats, setBeats] = useState<number[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState('');

  const handleAudioDrop = async (files: File[]) => {
    if (files.length > 0) {
      const file = files[0];
      setAudioFile(file);

      // Revoke previous object URL to prevent memory leak
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setBeats([]);

      setIsAnalyzing(true);
      setStatus('Analyzing audio for beats...');

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const result = await analyzeBeats(audioBuffer);

        if (result.bpm) {
          console.log('Detected BPM:', result.bpm, 'Beats:', result.beats.length);
          setStatus(`Detected BPM: ${Math.round(result.bpm)}`);
          setBeats(result.beats);
        }
      } catch (err) {
        console.error('Beat detection failed:', err);
        setStatus('Beat detection failed.');
      } finally {
        setIsAnalyzing(false);
        audioContext.close().catch(() => { /* already closed */ });
      }
    }
  };

  const handleVideoDrop = (files: File[]) => {
    setVideoFiles((prev) => [...prev, ...files]);
  };

  const handleSync = () => {
    if (!audioFile || videoFiles.length === 0) {
      setStatus('Please select audio and video files.');
      return;
    }

    if (ipcRenderer) {
      setStatus('Sending to Resolve...');
      ipcRenderer.send('sync-to-resolve', {
        audioPath: (audioFile as any).path,
        videoPaths: videoFiles.map(f => (f as any).path),
        beats: beats
      });
    } else {
      console.log('IPC not available (not in Electron?)');
      setStatus('IPC not available. Run in Electron.');
    }
  };

  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.on('sync-complete', (_event: any, message: string) => {
        setStatus(message);
      });
      ipcRenderer.on('sync-error', (_event: any, error: string) => {
        setStatus(`Error: ${error}`);
      });
    }
    return () => {
      if (ipcRenderer) {
        ipcRenderer.removeAllListeners('sync-complete');
        ipcRenderer.removeAllListeners('sync-error');
      }
    };
  }, []);

  return (
    <div className="module-container">
      <div className="module-header">
        <h2 className="module-title">🎬 Video Sync</h2>
        <p className="module-description">
          Sync video clips to the beat of your music in DaVinci Resolve.
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">1. Music</h3>
          </div>
          <DropZone onFilesDropped={handleAudioDrop} accept="audio/*" label="Drop Music Here" />
          {audioFile && <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>📁 {audioFile.name}</p>}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">2. Videos</h3>
          </div>
          <DropZone onFilesDropped={handleVideoDrop} accept="video/*" label="Drop Videos Here" />
          <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Selected: {videoFiles.length} clips</p>
          <ul className="file-list">
            {videoFiles.slice(0, 5).map((f, i) => <li key={i}>{f.name}</li>)}
            {videoFiles.length > 5 && <li>...and {videoFiles.length - 5} more</li>}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">3. Preview & Sync</h3>
          {beats.length > 0 && (
            <div className="beat-count">
              <span className="beat-count-number">{beats.length}</span>
              <span className="beat-count-label">beats</span>
            </div>
          )}
        </div>
        {isAnalyzing ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
            Analyzing...
          </div>
        ) : (
          <BeatVisualizer audioUrl={audioUrl} beats={beats} />
        )}

        <div style={{ marginTop: '20px' }}>
          <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>{status}</p>
          <button
            className="btn btn-primary"
            onClick={handleSync}
            disabled={beats.length === 0 || videoFiles.length === 0}
          >
            Sync in DaVinci Resolve
          </button>

          <button
            className="btn btn-secondary"
            style={{ marginLeft: '10px' }}
            onClick={async () => {
              if (!audioFile || videoFiles.length === 0) return;
              if (!ipcRenderer) {
                setStatus('IPC not available.');
                return;
              }

              setStatus('Generating script...');
              try {
                const result = await ipcRenderer.invoke('stage-video-sync', {
                  audioPath: (audioFile as any).path,
                  videoPaths: videoFiles.map(f => (f as any).path),
                  beats: beats
                });

                if (result.success) {
                  setStatus(`Script staged! Run: Workspace > Scripts > ${result.scriptPath.split(/[\\/]/).pop()}`);
                } else {
                  setStatus(`Error: ${result.error}`);
                }
              } catch (err: any) {
                setStatus(`Failed: ${err.message}`);
              }
            }}
            disabled={beats.length === 0 || videoFiles.length === 0}
            title="Generate a Python script to run manually (for Resolve Free)"
          >
            🎬 Stage for Resolve
          </button>

        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeModule, setActiveModule] = useState('beat-extraction');

  // --- Global Project State ---
  const { projects, saveProject, updateProject, deleteProject } = useProjectStorage();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : undefined;

  // Triage state (legacy-ish, but useful for direct "Analyze" button from Stem Separation)
  const [triageAudioPath, setTriageAudioPath] = useState<string | undefined>(undefined);
  const [triageStemType, setTriageStemType] = useState<string | undefined>(undefined);

  const handleCreateProject = (file: File) => {
    const newProject = saveProject({
      name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
      audioPath: (file as any).path,
      audioFileName: file.name,
      frameRate: 24, // Default
      stemType: 'master', // Default
      stems: []
    });
    setActiveProjectId(newProject.id);
    return newProject;
  };

  const handleUpdateProject = (id: string, updates: Partial<BeatProject>) => {
    updateProject(id, updates);
  };

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    // If switching to a project, ensure we are on a relevant module?
    // For now, just setting ID is enough, modules will react.
  };

  // ---------------------------

  const handleAnalyzeStem = (path: string, type: string) => {
    console.log(`Analyzing stem: ${type} -> ${path}`);
    setTriageAudioPath(path);
    setTriageStemType(type);
    setActiveModule('beat-extraction');
  };

  const renderModule = () => {
    switch (activeModule) {
      case 'beat-extraction':
        return (
          <BeatExtractionModule
            // Legacy props for direct analysis from stem player
            initialAudioPath={triageAudioPath}
            initialStemType={triageStemType}
            // Global Project Props
            projects={projects}
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={deleteProject}
          />
        );
      case 'script-manager':
        return <ScriptManagerModule />;
      case 'video-sync':
        return <VideoSyncModule />;
      case 'stem-separation':
        return (
          <StemSeparationModule
            onAnalyzeStem={handleAnalyzeStem}
            // Global Project Props
            activeProject={activeProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            // New Props for Embedded
            projects={projects}
            onSelectProject={handleSelectProject}
            onDeleteProject={deleteProject}
          />
        );
      case 'settings':
        return <SettingsModule />;
      default:
        return <BeatExtractionModule initialAudioPath={triageAudioPath} initialStemType={triageStemType} />;
    }
  };

  return (
    <Layout activeModule={activeModule} onModuleChange={setActiveModule}>
      {activeProject && (
        <div className="bg-blue-900/30 border-b border-blue-900/50 px-4 py-2 text-xs text-blue-200 flex justify-between items-center">
          <span>📂 Active Project: <strong>{activeProject.name}</strong></span>
          <button
            onClick={() => setActiveProjectId(null)}
            className="hover:text-white"
          >
            ✖ Close
          </button>
        </div>
      )}
      {renderModule()}
    </Layout>
  );
}

export default App;
