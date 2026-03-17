import { useState } from 'react';
import useProjectStorage, { type BeatProject } from './hooks/useProjectStorage';
import Layout from './components/Layout';
import ScriptManagerModule from './modules/ScriptManagerModule';

import MusicVideoAssemblerModule from './modules/MusicVideoAssemblerModule';
import SettingsModule from './modules/SettingsModule';
import WorkflowAnalyzerModule from './modules/WorkflowAnalyzerModule';
import StoryboardModule from './modules/StoryboardModule';



// Define types for Electron IPC
declare global {
  interface Window {
    require: any;
  }
}




function App() {
  const [activeModule, setActiveModule] = useState('music-video-assembler');

  // --- Global Status Logs ---
  const [statusLogs, setStatusLogs] = useState<{ time: Date, msg: string }[]>([]);

  const addLog = (msg: string) => {
    setStatusLogs(prev => {
      const newLogs = [...prev, { time: new Date(), msg }];
      if (newLogs.length > 100) return newLogs.slice(newLogs.length - 100);
      return newLogs;
    });
  };

  // --- Global Project State ---
  const { projects, saveProject, updateProject, deleteProject, refreshProjects } = useProjectStorage();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // --- Visibility Settings ---
  const [panelVisibility, setPanelVisibility] = useState({
      showMainTrack: true,
      showStems: true,
      showVideo: true,
      showVideoSource: true,
      showAudioSource: true,
      showProjectSelection: true,
      showAudioAnalysis: true
  });

  const toggleVisibility = (key: string) => {
      setPanelVisibility(prev => ({ ...prev, [key]: !prev[key as keyof typeof panelVisibility] }));
  };

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : undefined;

  const handleCreateBlankProject = async (projectName?: string) => {
    let initialOutputDir = undefined;
    try {
      // @ts-ignore
      const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
      if (ipcRenderer) {
        const configRes = await ipcRenderer.invoke('get-config');
        if (configRes.success && configRes.config.projectOutputDir) {
          initialOutputDir = configRes.config.projectOutputDir;
        }
      }
    } catch (e) {
      console.warn("Could not determine default output dir for blank project", e);
    }

    if (!initialOutputDir) {
      try {
        // @ts-ignore
        const path = window.require('path');
        initialOutputDir = path.resolve('./output');
      } catch (e) { }
    }

    const finalName = projectName || `Blank Project ${new Date().toLocaleDateString().replace(/\//g, '-')}`;
    const newProject = saveProject({
      name: finalName,
      frameRate: 20,
      stemType: 'master',
      stems: [],
      outputDir: initialOutputDir
    });

    setActiveProjectId(newProject.id);
    return newProject;
  };

  const handleCreateProject = (file: File, preferredOutputDir?: string) => {
    // Try to calculate an initial outputDir if possible (useful for Electron)
    let initialOutputDir = preferredOutputDir;
    if (!initialOutputDir) {
      try {
        // @ts-ignore
        const path = window.require ? window.require('path') : null;
        if (path && (file as any).path) {
          initialOutputDir = path.dirname((file as any).path);
        }
      } catch (e) {
        console.warn("Could not determine default output dir during project creation", e);
      }
    }

    const newProject = saveProject({
      name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
      audioPath: (file as any).path, // Temporary absolute path
      audioFileName: file.name,
      frameRate: 20, // Default to 20 fps for cleaner math in LTX
      stemType: 'master', // Default
      stems: [],
      outputDir: initialOutputDir
    });

    // Post-process project bundle: Create the 'source/' directory to hold the original media
    // and copy the user's dropped audio into it. We then save a relative path to keep the project portable.
    if (newProject.outputDir && (file as any).path) {
      try {
        // @ts-ignore
        const fs = window.require('fs');
        // @ts-ignore
        const path = window.require('path');
        const sourceDir = path.join(newProject.outputDir, 'source');
        if (!fs.existsSync(sourceDir)) {
          fs.mkdirSync(sourceDir, { recursive: true });
        }

        // Sanitize the audio file name to prevent broken paths
        const safeAudioName = file.name.replace(/[^a-zA-Z0-9-_\.]/g, '_');
        const destPath = path.join(sourceDir, safeAudioName);
        fs.copyFileSync((file as any).path, destPath);

        // Update the project json with a portable relative path (e.g. "./source/my_song.mp3")
        const relativePath = `./source/${safeAudioName}`;
        handleUpdateProject(newProject.id, { audioPath: relativePath });
        newProject.audioPath = relativePath;
      } catch (e) {
        console.error("Failed to copy source audio into the project bundle:", e);
      }
    }

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

  const renderModule = () => {
    switch (activeModule) {
      case 'script-manager':
        return <ScriptManagerModule />;

      case 'settings':
        return <SettingsModule onSave={refreshProjects} />;
      case 'workflow-analyzer':
        return <WorkflowAnalyzerModule onStatusChange={addLog} />;
      case 'storyboard':
        return (
          <StoryboardModule
            activeProject={activeProject}
            onUpdateProject={handleUpdateProject}
            onStatusChange={addLog}
          />
        );
      case 'music-video-assembler':
        return (
            <MusicVideoAssemblerModule
            projects={projects}
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onCreateBlankProject={handleCreateBlankProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={deleteProject}
            onRefreshProjects={refreshProjects}
            onStatusChange={addLog}
            panelVisibility={panelVisibility}
            onToggleVisibility={toggleVisibility}
          />
        );

      default:
        return (
          <MusicVideoAssemblerModule
            projects={projects}
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onCreateBlankProject={handleCreateBlankProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={deleteProject}
            onRefreshProjects={refreshProjects}
          />
        );
    }
  };

  return (
    <Layout
      activeModule={activeModule}
      onModuleChange={setActiveModule}
      statusLogs={statusLogs}
      activeProjectName={activeProject?.name}
      panelVisibility={panelVisibility}
      onToggleVisibility={toggleVisibility}
    >
      {renderModule()}
    </Layout>
  );
}

export default App;
