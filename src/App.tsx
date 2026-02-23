import { useState } from 'react';
import useProjectStorage, { type BeatProject } from './hooks/useProjectStorage';
import Layout from './components/Layout';
import ScriptManagerModule from './modules/ScriptManagerModule';
import StemSeparationModule from './modules/StemSeparationModule';
import MusicVideoAssemblerModule from './modules/MusicVideoAssemblerModule';
import SettingsModule from './modules/SettingsModule';



// Define types for Electron IPC
declare global {
  interface Window {
    require: any;
  }
}




function App() {
  const [activeModule, setActiveModule] = useState('stem-separation');

  // --- Global Project State ---
  const { projects, saveProject, updateProject, deleteProject } = useProjectStorage();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : undefined;

  const handleCreateProject = (file: File) => {
    // Try to calculate an initial outputDir if possible (useful for Electron)
    let initialOutputDir = undefined;
    try {
      // @ts-ignore
      const path = window.require ? window.require('path') : null;
      if (path && (file as any).path) {
        initialOutputDir = path.dirname((file as any).path);
      }
    } catch (e) {
      console.warn("Could not determine default output dir during project creation", e);
    }

    const newProject = saveProject({
      name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
      audioPath: (file as any).path,
      audioFileName: file.name,
      frameRate: 24, // Default
      stemType: 'master', // Default
      stems: [],
      outputDir: initialOutputDir
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

  const renderModule = () => {
    switch (activeModule) {
      case 'script-manager':
        return <ScriptManagerModule />;
      case 'stem-separation':
        return (
          <StemSeparationModule
            activeProject={activeProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
          />
        );
      case 'settings':
        return <SettingsModule />;
      case 'music-video-assembler':
        return (
          <MusicVideoAssemblerModule
            projects={projects}
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={deleteProject}
          />
        );
      default:
        return (
          <StemSeparationModule
            activeProject={activeProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
          />
        );
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
