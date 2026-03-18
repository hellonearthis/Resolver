import { useState, useCallback, useEffect } from 'react';
import useProjectStorage, { type BeatProject } from './hooks/useProjectStorage';
import Layout from './components/Layout';
import ScriptManagerModule from './modules/ScriptManagerModule';

import MusicVideoAssemblerModule from './modules/MusicVideoAssemblerModule';
import SettingsModule from './modules/SettingsModule';
import WorkflowAnalyzerModule from './modules/WorkflowAnalyzerModule';
import StoryboardModule from './modules/StoryboardModule';

import { 
  checkComfyConnection, 
  queuePrompt, 
  uploadFileToComfyUI, 
  waitForPromptWebSocket 
} from './services/comfyService';
import { getValidLtxFrameCount } from './utils/timelineUtils';
import type { VideoClip } from './types/assembler';
import workflowJsonTemplate from '../comfyui_workflows/video_ltx2_i2v.json';

// Define types for Electron IPC
declare global {
  interface Window {
    require: any;
  }
}

export interface QueueItem {
  id: string;
  clipId: string;
  projectId: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  error?: string;
  progress?: number;
  label: string;
  addedAt: number;
}

function App() {
  const [activeModule, setActiveModule] = useState('music-video-assembler');

  // --- ComfyUI Shared State ---
  const [comfyConnected, setComfyConnected] = useState<boolean>(false);
  const [comfyOutputDir, setComfyOutputDir] = useState<string>('C:\\ComfyUI_windows_portable\\ComfyUI\\output');

  // --- Video Generation Queue ---
  const [videoQueue, setVideoQueue] = useState<QueueItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

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
      showAudioAnalysis: true,
      showQueue: true
  });

  const toggleVisibility = (key: string) => {
      setPanelVisibility(prev => ({ ...prev, [key]: !prev[key as keyof typeof panelVisibility] }));
  };

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : undefined;

  useEffect(() => {
    const initComfy = async () => {
      const connected = await checkComfyConnection();
      setComfyConnected(connected);

      // Load config for output dir
      try {
        // @ts-ignore
        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
        if (ipcRenderer) {
          const res = await ipcRenderer.invoke('get-config');
          if (res.success && res.config.comfyOutputDir) {
            setComfyOutputDir(res.config.comfyOutputDir);
          }
        }
      } catch (e) {
        console.warn("Failed to load ComfyUI config in App", e);
      }
    };
    initComfy();
  }, []);

  // --- Project Health Check Effect ---
  // Resets stuck "generating" or "queued" statuses when a project is loaded
  useEffect(() => {
    if (activeProject && activeProject.clips) {
      const stuckClips = activeProject.clips.filter(c => c.status === 'generating' || c.status === 'queued');
      if (stuckClips.length > 0) {
        addLog(`Auto-cleaning ${stuckClips.length} stuck generation statuses for "${activeProject.name}"`);
        const cleanedClips = activeProject.clips.map(c => 
          (c.status === 'generating' || c.status === 'queued') ? { ...c, status: 'pending' as const } : c
        );
        handleUpdateProject(activeProject.id, { clips: cleanedClips });
      }
    }
  }, [activeProjectId]); // Only run when changing project IDs

  const handleUpdateProject = (id: string, updates: Partial<BeatProject>) => {
    updateProject(id, updates);
  };

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
  };

  // --- Queue Management Handlers ---
  const handleAddToQueue = useCallback((clipId: string, projectId: string, label: string) => {
    setVideoQueue(prev => {
      if (prev.find(item => item.clipId === clipId && (item.status === 'queued' || item.status === 'processing'))) {
        return prev;
      }
      const newItem: QueueItem = {
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        clipId,
        projectId,
        status: 'queued',
        label,
        addedAt: Date.now()
      };
      
      // Update clip status in project
      const project = projects.find(p => p.id === projectId);
      if (project) {
        const updatedClips = project.clips?.map(c => c.id === clipId ? { ...c, status: 'queued' as const } : c);
        handleUpdateProject(projectId, { clips: updatedClips });
      }

      return [...prev, newItem];
    });
    addLog(`Added clip "${label}" to generation queue.`);
  }, [projects, handleUpdateProject]);

  const handleRemoveFromQueue = useCallback((id: string) => {
    setVideoQueue(prev => {
      const itemToRemove = prev.find(item => item.id === id);
      if (itemToRemove) {
        const project = projects.find(p => p.id === itemToRemove.projectId);
        if (project) {
          const updatedClips = project.clips?.map(c => 
            (c.id === itemToRemove.clipId && (c.status === 'queued' || c.status === 'generating'))
              ? { ...c, status: 'pending' as const } 
              : c
          );
          handleUpdateProject(itemToRemove.projectId, { clips: updatedClips });
        }
      }
      return prev.filter(item => item.id !== id);
    });
  }, [projects, handleUpdateProject]);

  const handleTogglePauseQueue = useCallback(() => {
    setIsQueuePaused(prev => !prev);
  }, []);

  const handleClearQueue = useCallback(() => {
    setVideoQueue(prev => {
      const itemsToClear = prev.filter(item => item.status !== 'processing');
      itemsToClear.forEach(item => {
        const project = projects.find(p => p.id === item.projectId);
        if (project) {
          const updatedClips = project.clips?.map(c => 
            (c.id === item.clipId && c.status === 'queued') 
              ? { ...c, status: 'pending' as const } 
              : c
          );
          handleUpdateProject(item.projectId, { clips: updatedClips });
        }
      });
      return prev.filter(item => item.status === 'processing');
    });
  }, [projects, handleUpdateProject]);

  const handleResetStuckStatuses = useCallback(() => {
    if (!activeProject) return;
    const stuckClips = activeProject.clips?.filter(c => c.status === 'generating' || c.status === 'queued') || [];
    if (stuckClips.length > 0) {
      addLog(`Manually resetting ${stuckClips.length} stuck statuses for "${activeProject.name}"`);
      const cleanedClips = activeProject.clips?.map(c => 
        (c.status === 'generating' || c.status === 'queued') ? { ...c, status: 'pending' as const } : c
      );
      handleUpdateProject(activeProject.id, { clips: cleanedClips });
    } else {
      addLog("No stuck statuses found in current project.");
    }
  }, [activeProject, handleUpdateProject]);

  // --- Shared Video Generation Logic ---
  const handleGenerateVideo = useCallback(async (queueItem: QueueItem) => {
    const { clipId, projectId } = queueItem;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    const clipToUpdate = project.clips?.find((c: VideoClip) => c.id === clipId);
    if (!clipToUpdate) {
      addLog(`Error: Clip ${clipId} not found.`);
      return;
    }

    if (!comfyConnected) {
      addLog('Cannot generate: ComfyUI is not connected.');
      return;
    }

    try {
      // 1. Update status to processing (already set in queue, but sync to project)
      const generatingClips = project.clips?.map((c: VideoClip) => 
        c.id === clipId ? { ...c, status: 'generating' as const } : c
      );
      handleUpdateProject(project.id, { clips: generatingClips });

      const frameRate = project.frameRate || 20;
      addLog(`[Queue] Processing "${clipToUpdate.label}"...`);

      // 2. Upload Start Image
      let finalImageName = "";
      if (clipToUpdate.startImagePath) {
        let absoluteImagePath = clipToUpdate.startImagePath;
        absoluteImagePath = absoluteImagePath.replace(/^file:\/\/\/?/i, '').replace(/%20/g, ' ');
        absoluteImagePath = decodeURI(absoluteImagePath);

        // @ts-ignore
        const path = window.require('path');
        // @ts-ignore
        const fs = window.require('fs');

        if (!path.isAbsolute(absoluteImagePath)) {
          const possiblePathImages = path.resolve(project.outputDir || '', 'images', absoluteImagePath);
          const possiblePathRoot = path.resolve(project.outputDir || '', absoluteImagePath);
          if (fs.existsSync(possiblePathImages)) absoluteImagePath = possiblePathImages;
          else if (fs.existsSync(possiblePathRoot)) absoluteImagePath = possiblePathRoot;
        }

        const uploadResult = await uploadFileToComfyUI(absoluteImagePath);
        if (uploadResult?.name) finalImageName = uploadResult.name;
        else throw new Error(`Failed to upload start image to ComfyUI.`);
      } else {
        throw new Error("Start image missing. Aborting generation.");
      }

      // 3. Upload Audio File
      let finalAudioName = "audio.wav";
      let sourceAudioPath = project.audioPath;

      if (clipToUpdate.source === 'stem' && clipToUpdate.stemName) {
        const targetStem = project.stems?.find(s => s.type === clipToUpdate.stemName);
        if (targetStem) sourceAudioPath = targetStem.path;
      }

      if (sourceAudioPath) {
        let absoluteAudioPath = sourceAudioPath.replace(/^file:\/\/\/?/i, '').replace(/%20/g, ' ');
        absoluteAudioPath = decodeURI(absoluteAudioPath);

        // @ts-ignore
        const path = window.require('path');
        // @ts-ignore
        const fs = window.require('fs');

        if (!path.isAbsolute(absoluteAudioPath)) {
          absoluteAudioPath = path.resolve(project.outputDir || '', absoluteAudioPath);
        }

        const uploadResult = await uploadFileToComfyUI(absoluteAudioPath);
        if (uploadResult?.name) finalAudioName = uploadResult.name;
        else throw new Error(`Failed to upload audio to ComfyUI.`);
      }

      // 4. Inject Workflow
      const workflow = JSON.parse(JSON.stringify(workflowJsonTemplate));
      const frames = getValidLtxFrameCount(clipToUpdate.duration, frameRate);

      if (workflow["98"]?.inputs) workflow["98"].inputs.image = finalImageName;
      if (workflow["92:3"]?.inputs) {
        workflow["92:3"].inputs.text = clipToUpdate.notes?.action || clipToUpdate.label;
      }
      const rng_seed = Math.floor(Math.random() * 1000000000000000);
      if (workflow["92:11"]?.inputs) workflow["92:11"].inputs.noise_seed = rng_seed;
      if (workflow["92:67"]?.inputs) workflow["92:67"].inputs.noise_seed = rng_seed;
      if (workflow["92:62"]?.inputs) workflow["92:62"].inputs.value = frames;
      if (workflow["92:97"]?.inputs) workflow["92:97"].inputs.fps = frameRate;
      if (workflow["92:22"]?.inputs) workflow["92:22"].inputs.frame_rate = frameRate;
      if (workflow["92:115"]?.inputs) {
        workflow["92:115"].inputs.start_index = clipToUpdate.startTime;
        workflow["92:115"].inputs.duration = clipToUpdate.duration;
      }
      if (workflow["92:113"]?.inputs) workflow["92:113"].inputs.audio = finalAudioName;

      // 5. Queue and Poll
      const result = await queuePrompt(workflow);
      if (!result?.prompt_id) throw new Error('Failed to queue prompt');

      addLog(`Generating Video (ID: ${result.prompt_id})...`);
      await waitForPromptWebSocket(result.prompt_id, workflow, (status, progress) => {
        if (status) addLog(status);
        if (progress !== undefined) {
          setVideoQueue(prev => prev.map(item => item.id === queueItem.id ? { ...item, progress } : item));
        }
      });

      // 6. Move output
      // @ts-ignore
      const fs = window.require('fs');
      // @ts-ignore
      const path = window.require('path');

      let latestSourcePath = "";
      const videoOutDir = path.join(comfyOutputDir, 'video');
      
      const findLatest = (dir: string) => {
        if (!fs.existsSync(dir)) return "";
        const files = fs.readdirSync(dir).filter((f: string) => f.includes('LTX_2.0_i2v') && f.endsWith('.mp4'));
        if (files.length === 0) return "";
        return files.sort((a: string, b: string) => 
          fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs
        )[0];
      };

      const latestVideo = findLatest(videoOutDir);
      if (latestVideo) latestSourcePath = path.join(videoOutDir, latestVideo);
      else {
        const rootVideo = findLatest(comfyOutputDir);
        if (rootVideo) latestSourcePath = path.join(comfyOutputDir, rootVideo);
      }

      if (!latestSourcePath) throw new Error("Generated video file not found.");

      const destVideosDir = path.join(project.outputDir || '', 'videos');
      if (!fs.existsSync(destVideosDir)) fs.mkdirSync(destVideosDir, { recursive: true });

      const existingTakes = clipToUpdate.generatedVideos?.length || 0;
      const safeLabel = clipToUpdate.label.replace(/[^a-z0-9]/gi, '_');
      const destPath = path.join(destVideosDir, `${safeLabel}_take${existingTakes + 1}.mp4`);

      fs.copyFileSync(latestSourcePath, destPath);
      
      // 7. Success Update
      const finalClips = project.clips?.map((c: VideoClip) => {
        if (c.id === clipId) {
          return {
            ...c,
            status: 'done' as const,
            videoPath: destPath,
            generatedVideos: [...(c.generatedVideos || []), destPath]
          };
        }
        return c;
      });

      handleUpdateProject(project.id, { clips: finalClips });
      addLog(`Successfully generated video for "${clipToUpdate.label}"`);
      return { success: true };

    } catch (err: any) {
      console.error('Generation Error:', err);
      addLog(`Error generating clip: ${err.message}`);
      const errorClips = project.clips?.map((c: VideoClip) => 
        c.id === clipId ? { ...c, status: 'error' as const } : c
      );
      handleUpdateProject(project.id, { clips: errorClips });
      return { success: false, error: err.message };
    }
  }, [projects, comfyConnected, comfyOutputDir, handleUpdateProject]);

  // --- Queue Processor Effect ---
  useEffect(() => {
    let active = true;
    const processNext = async () => {
      if (isProcessing || isQueuePaused) return;

      const nextItem = videoQueue.find(item => item.status === 'queued');
      if (!nextItem) return;

      setIsProcessing(true);
      
      // Update item to processing
      setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'processing' } : item));

      // Update clip status in project to 'generating'
      const project = projects.find(p => p.id === nextItem.projectId);
      if (project) {
        const updatedClips = project.clips?.map(c => c.id === nextItem.clipId ? { ...c, status: 'generating' as const } : c);
        handleUpdateProject(nextItem.projectId, { clips: updatedClips });
      }

      // Health check ComfyUI before starting
      const isAlive = await checkComfyConnection();
      if (!isAlive) {
        addLog("Queue paused: ComfyUI connection lost.");
        setIsQueuePaused(true);
        setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' } : item));
        
        // Reset clip status back to 'queued'
        if (project) {
          const resetClips = project.clips?.map(c => c.id === nextItem.clipId ? { ...c, status: 'queued' as const } : c);
          handleUpdateProject(nextItem.projectId, { clips: resetClips });
        }

        setIsProcessing(false);
        return;
      }

      const result = await handleGenerateVideo(nextItem);
      
      if (active) {
        setVideoQueue(prev => prev.map(item => 
          item.id === nextItem.id 
            ? { ...item, status: (result?.success ? 'done' : 'error'), error: result?.error } 
            : item
        ));
        setIsProcessing(false);
      }
    };

    processNext();
    return () => { active = false; };
  }, [videoQueue, isQueuePaused, isProcessing, handleGenerateVideo]);

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

    // Post-process project bundle
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

        const safeAudioName = file.name.replace(/[^a-zA-Z0-9-_\.]/g, '_');
        const destPath = path.join(sourceDir, safeAudioName);
        fs.copyFileSync((file as any).path, destPath);

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

  const renderModule = () => {
    const onGenerateVideo = async (clipId: string): Promise<void> => {
      if (activeProject) {
        const clip = activeProject.clips?.find(c => c.id === clipId);
        handleAddToQueue(clipId, activeProject.id, clip?.label || 'Untitled Clip');
      }
    };

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
            onGenerateVideo={onGenerateVideo}
            comfyConnected={comfyConnected}
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
            onGenerateVideo={onGenerateVideo}
            comfyConnected={comfyConnected}
            comfyOutputDir={comfyOutputDir}
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
            onStatusChange={addLog}
            onGenerateVideo={onGenerateVideo}
            comfyConnected={comfyConnected}
            comfyOutputDir={comfyOutputDir}
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
      videoQueue={videoQueue}
      isQueuePaused={isQueuePaused}
      onTogglePauseQueue={handleTogglePauseQueue}
      onRemoveFromQueue={handleRemoveFromQueue}
      onClearQueue={handleClearQueue}
      onResetStuck={handleResetStuckStatuses}
    >
      {renderModule()}
    </Layout>
  );
}

export default App;
