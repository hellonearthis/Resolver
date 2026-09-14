/**
 * App.tsx
 * 
 * The root component and state coordinator for the Resolver application.
 * It manages the global generation queue, project selection, and coordinates
 * interactions between the UI modules and the ComfyUI service layer.
 */
import { useState, useCallback, useEffect } from 'react';
import useProjectStorage, { type BeatProject } from './hooks/useProjectStorage';
import Layout from './components/Layout';
import ScriptManagerModule from './modules/ScriptManagerModule';

import MusicVideoAssemblerModule from './modules/MusicVideoAssemblerModule';
import SettingsModule from './modules/SettingsModule';
import WorkflowAnalyzerModule from './modules/WorkflowAnalyzerModule';
import StoryboardModule from './modules/StoryboardModule';
import McpControlModule from './modules/McpControlModule';

import {
  checkComfyConnection, 
  queuePrompt, 
  uploadFileToComfyUI, 
  waitForPromptWebSocket,
  convertAudioForComfyUI,
  type ComfyWorkflow
} from './services/comfyService';

import type { VideoClip, ImageFunction } from './types/assembler';
import workflowJsonTemplate from '../comfyui_workflows/minimax_image_to_video_api.json';
import r2vWorkflowJsonTemplate from '../comfyui_workflows/video_minimax_h3_r2v_api.json';
import imageDescriptionWorkflow from '../comfyui_workflows/llm_qwen3_image_discription_api.json';
import { 
  buildQwenVisionPromptForFunction, 
  getImageFunctionConfiguration,
  buildMiniMaxH3SystemPrompt,
  buildMiniMaxH3UserPrompt,
  buildMiniMaxH3DirectBrief
} from './services/qwenPromptService';
import { TooltipProvider } from './components/ui/Tooltip';

import type { FileWithPath } from './components/DropZone';

interface NodeFsModule {
  existsSync: (file_path: string) => boolean;
  readFileSync: (file_path: string, encoding: string) => string;
  writeFileSync: (file_path: string, content: string) => void;
  copyFileSync: (source_path: string, destination_path: string) => void;
  mkdirSync: (directory_path: string, options?: { recursive?: boolean }) => void;
  readdirSync: (directory_path: string) => string[];
  statSync: (file_path: string) => { mtimeMs: number };
}

interface NodePathModule {
  join: (...path_segments: string[]) => string;
  resolve: (...path_segments: string[]) => string;
  basename: (file_path: string, file_extension?: string) => string;
  dirname: (file_path: string) => string;
  extname: (file_path: string) => string;
  isAbsolute: (file_path: string) => boolean;
}

interface ElectronIpcRenderer {
  invoke: (channel_name: string, ...arguments_list: unknown[]) => Promise<{ success: boolean; config?: { comfyOutputDir?: string; llmProvider?: 'llama-server' | 'vino'; projectOutputDir?: string }; error?: string; [key: string]: unknown }>;
  send: (channel_name: string, ...arguments_list: unknown[]) => void;
  on: (channel_name: string, callback_listener: (...arguments_list: unknown[]) => void) => void;
}

interface WindowWithElectronRequire {
  require?: (module_name: string) => unknown;
  ipcRenderer?: ElectronIpcRenderer;
}

const getElectronIpc = (): ElectronIpcRenderer | null => {
  const electron_window = window as unknown as WindowWithElectronRequire;
  if (electron_window.ipcRenderer) return electron_window.ipcRenderer;
  if (electron_window.require) {
    const electron_module = electron_window.require('electron') as { ipcRenderer?: ElectronIpcRenderer } | null;
    return electron_module?.ipcRenderer ?? null;
  }
  return null;
};

const getNodeFs = (): NodeFsModule | null => {
  const electron_window = window as unknown as WindowWithElectronRequire;
  return electron_window.require ? (electron_window.require('fs') as NodeFsModule) : null;
};

const getNodePath = (): NodePathModule | null => {
  const electron_window = window as unknown as WindowWithElectronRequire;
  return electron_window.require ? (electron_window.require('path') as NodePathModule) : null;
};

interface LegacyClipFields {
  actionNotes?: string;
  promptText?: string;
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
  type?: 'video' | 'description' | 'reword';
  imageSlot?: 'startImagePath' | 'endImagePath';
}

function App() {
  const [activeModule, setActiveModule] = useState('music-video-assembler');

  // --- ComfyUI Shared State ---
  const [comfyConnected, setComfyConnected] = useState<boolean>(false);
  const [comfyOutputDir, setComfyOutputDir] = useState<string>('C:\\ComfyUI_windows_portable\\ComfyUI\\output');

  // --- Video Generation Queue ---
  const [videoQueue, setVideoQueue] = useState<QueueItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);
  const [isVinoProcessing, setIsVinoProcessing] = useState<boolean>(false);
  const [isComfyProcessing, setIsComfyProcessing] = useState<boolean>(false);

  // --- Global Status Logs ---
  const [statusLogs, setStatusLogs] = useState<{ time: Date, msg: string }[]>([]);
  const [llmProvider, setLlmProvider] = useState<'llama-server' | 'vino'>('llama-server');

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

      // Load config for output dir and LLM provider
      await refreshGlobalConfig();
    };
    initComfy();
  }, []);

  const refreshGlobalConfig = async () => {
    try {
      const ipcRenderer = getElectronIpc();
      if (ipcRenderer) {
        const res = await ipcRenderer.invoke('get-config');
        if (res.success && res.config) {
          if (res.config.comfyOutputDir) setComfyOutputDir(res.config.comfyOutputDir);
          if (res.config.llmProvider === 'llama-server' || res.config.llmProvider === 'vino') {
            setLlmProvider(res.config.llmProvider);
          } else if ((res.config.llmProvider as unknown as string) === 'lmstudio') {
            setLlmProvider('llama-server');
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load global config", e);
    }
  };

  /**
   * PROJECT HEALTH CHECK:
   * 
   * WHY: If the app crashes or is closed during a generation, clips might be left 
   * with 'generating' or 'queued' statuses.
   * HOW: On project load, we scan all clips and reset any stuck statuses back to 'pending'.
   */
  useEffect(() => {
    if (activeProject && activeProject.clips) {
      const stuckClips = activeProject.clips.filter(c => 
        c.status === 'generating' || 
        c.status === 'queued' || 
        c.isExpanding || 
        c.isDescribing
      );

      if (stuckClips.length > 0) {
        addLog(`Auto-healing ${stuckClips.length} stuck AI statuses for "${activeProject.name}"`);
        const cleanedClips = activeProject.clips.map(c => ({
          ...c,
          status: (c.status === 'generating' || c.status === 'queued') ? 'pending' as const : c.status,
          isExpanding: false,
          isDescribing: false
        }));
        handleUpdateProject(activeProject.id, { clips: cleanedClips });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]); // Only run when changing project IDs

  const handleUpdateProject = useCallback((id: string, updates: Partial<BeatProject> | ((prev: BeatProject) => Partial<BeatProject>)) => {
    updateProject(id, updates);
  }, [updateProject]);

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
  };

  /**
   * QUEUE MANAGEMENT (Add):
   * 
   * WHY: Video generation is resource-intensive and must be serial. A queue allows 
   * users to 'batch' their work while the AI processes clips one by one.
   * HOW: Tasks are identified by type (video vs description). We prevent duplicates 
   * and update the clip's state in the project to show visual progress immediately.
   */
  const handleAddToQueue = useCallback((
    clipId: string, 
    projectId: string, 
    label: string, 
    type: 'video' | 'description' | 'reword' = 'video',
    imageSlot?: 'startImagePath' | 'endImagePath'
  ) => {
    setVideoQueue(prev => {
      if (prev.find(item => item.clipId === clipId && item.type === type && item.imageSlot === imageSlot && (item.status === 'queued' || item.status === 'processing'))) {
        return prev;
      }
      const newItem: QueueItem = {
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        clipId,
        projectId,
        status: 'queued',
        label: type === 'description' ? `Description (${imageSlot === 'endImagePath' ? 'Img 2' : 'Img 1'}): ${label}` : label,
        addedAt: Date.now(),
        type,
        imageSlot: type === 'description' ? (imageSlot || 'startImagePath') : undefined
      };
      
      // Update clip status in project
      handleUpdateProject(projectId, (prevProject: BeatProject) => {
        const updatedClips = prevProject.clips?.map(c => {
          if (c.id === clipId) {
            if (type === 'video') return { ...c, status: 'queued' as const };
            if (type === 'description') return { ...c, isDescribing: true, isDescribingSlot: imageSlot || 'startImagePath' };
            if (type === 'reword') return { ...c, isExpanding: true };
          }
          return c;
        });
        return { clips: updatedClips };
      });

      return [...prev, newItem];
    });
    addLog(`Added ${type === 'description' ? 'description task' : 'clip'} "${label}" to generation queue.`);
  }, [handleUpdateProject]);

  const handleRemoveFromQueue = useCallback((id: string) => {
    setVideoQueue(prev => {
      const itemToRemove = prev.find(item => item.id === id);
      if (itemToRemove) {
        const project = projects.find(p => p.id === itemToRemove.projectId);
        if (project) {
          const updatedClips = project.clips?.map(c => 
            (c.id === itemToRemove.clipId)
              ? (itemToRemove.type === 'description' 
                   ? { ...c, isDescribing: false, isDescribingSlot: null } 
                   : itemToRemove.type === 'reword'
                     ? { ...c, isExpanding: false }
                     : (c.status === 'queued' || c.status === 'generating') ? { ...c, status: 'pending' as const } : c)
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
            (c.id === item.clipId) 
              ? (item.type === 'description' 
                   ? { ...c, isDescribing: false, isDescribingSlot: null } 
                   : item.type === 'reword'
                     ? { ...c, isExpanding: false }
                     : (c.status === 'queued' ? { ...c, status: 'pending' as const } : c))
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
    const stuckClips = activeProject.clips?.filter(c => c.status === 'generating' || c.status === 'queued' || c.isDescribing) || [];
    
    // Also reset the internal processing state
    setIsVinoProcessing(false);
    setIsComfyProcessing(false);
    
    if (stuckClips.length > 0) {
      addLog(`Manually resetting ${stuckClips.length} stuck statuses for "${activeProject.name}"`);
      const cleanedClips = activeProject.clips?.map(c => {
        const updated = { ...c };
        if (c.status === 'generating' || c.status === 'queued') updated.status = 'pending' as const;
        if (c.isDescribing) updated.isDescribing = false;
        return updated;
      });
      handleUpdateProject(activeProject.id, { clips: cleanedClips });

      // Update queue items too
      setVideoQueue(prev => prev.map(item => 
        (item.status === 'processing' || item.status === 'queued') 
          ? { ...item, status: 'queued' } // Reset to queued so it can retry, or remove if desired
          : item
      ));
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
      handleUpdateProject(project.id, (prev) => {
        const generatingClips = prev.clips?.map((c: VideoClip) => 
          c.id === clipId ? { ...c, status: 'generating' as const } : c
        );
        return { clips: generatingClips };
      });

      // WHAT: Stop llama-server to release all GPU VRAM before ComfyUI video generation starts.
      // WHY: Large video models (MiniMax H3, LTX, Wan) require maximum VRAM to avoid CUDA out-of-memory errors.
      if (llmProvider === 'llama-server') {
        const ipcRenderer = getElectronIpc();
        if (ipcRenderer) {
          addLog('[VRAM Management] Unloading llama-server to free 100% GPU VRAM for ComfyUI video rendering...');
          try {
            await ipcRenderer.invoke('llm-stop-server');
          } catch (stop_err) {
            console.warn('[VRAM Management] Non-critical error stopping llama-server:', stop_err);
          }
        }
      }

      const frameRate = project.frameRate || 20;
      addLog(`[Queue] Processing "${clipToUpdate.label}"...`);

      // Helper to resolve and upload an image file to ComfyUI
      const resolveAndUploadImage = async (imagePathString: string): Promise<string> => {
        let absoluteImagePath = imagePathString.replace(/^file:\/\/\/?/i, '').replace(/%20/g, ' ');
        absoluteImagePath = decodeURI(absoluteImagePath);

        const path = getNodePath();
        const fs = getNodeFs();
        if (!path || !fs) throw new Error('Filesystem module unavailable');

        if (!path.isAbsolute(absoluteImagePath)) {
          const possiblePathImages = path.resolve(project.outputDir || '', 'images', absoluteImagePath);
          const possiblePathRoot = path.resolve(project.outputDir || '', absoluteImagePath);
          if (fs.existsSync(possiblePathImages)) absoluteImagePath = possiblePathImages;
          else if (fs.existsSync(possiblePathRoot)) absoluteImagePath = possiblePathRoot;
        }

        const uploadResult = await uploadFileToComfyUI(absoluteImagePath);
        if (uploadResult?.name) return uploadResult.name;
        throw new Error(`Failed to upload reference image to ComfyUI.`);
      };

      // 2. Upload Reference Images
      const hasBothReferenceImages = Boolean(clipToUpdate.startImagePath && clipToUpdate.endImagePath);
      let finalStartImageName = "";
      let finalEndImageName = "";

      const primaryImagePath = clipToUpdate.startImagePath || clipToUpdate.endImagePath;
      if (!primaryImagePath) {
        throw new Error("At least one reference image is required to generate video.");
      }

      finalStartImageName = await resolveAndUploadImage(primaryImagePath);

      if (hasBothReferenceImages && clipToUpdate.endImagePath) {
        finalEndImageName = await resolveAndUploadImage(clipToUpdate.endImagePath);
      }

      // STEP 3: Upload Audio File
      let sourceAudioPath = project.audioPath;
      if (clipToUpdate.source === 'stem' && clipToUpdate.stemName) {
        const targetStem = project.stems?.find(candidateStem => candidateStem.type === clipToUpdate.stemName);
        if (targetStem) sourceAudioPath = targetStem.path;
      }

      if (sourceAudioPath) {
        let absoluteAudioPath = sourceAudioPath.replace(/^file:\/\/\/?/i, '').replace(/%20/g, ' ');
        absoluteAudioPath = decodeURI(absoluteAudioPath);

        const path = getNodePath();

        if (path && !path.isAbsolute(absoluteAudioPath)) {
          absoluteAudioPath = path.resolve(project.outputDir || '', absoluteAudioPath);
        }

        let finalPathToUpload = absoluteAudioPath;
        const audio_file_extension = path 
            ? path.extname(absoluteAudioPath).toLowerCase() 
            : ('.' + absoluteAudioPath.split('.').pop()?.toLowerCase());
        if (audio_file_extension === '.mp3' || audio_file_extension === '.m4a' || audio_file_extension === '.aac' || audio_file_extension === '.ogg') {
            const wavPath = await convertAudioForComfyUI(absoluteAudioPath);
            if (wavPath) finalPathToUpload = wavPath;
            else console.warn(`Failed to convert ${absoluteAudioPath} to WAV, trying raw upload.`);
        }

        const uploadResult = await uploadFileToComfyUI(finalPathToUpload);
        if (!uploadResult?.name) throw new Error(`Failed to upload audio to ComfyUI.`);
      }

      // STEP 4: Inject Workflow Data
      const rng_seed = Math.floor(Math.random() * 1000000000000000);
      let workflow: ComfyWorkflow;

      if (hasBothReferenceImages) {
        // WHAT: Executing the MiniMax H3 Reference-to-Video (R2V) dual-reference workflow.
        // WHY: The user provided two reference images with defined functions.
        workflow = JSON.parse(JSON.stringify(r2vWorkflowJsonTemplate)) as ComfyWorkflow;

        if (workflow["137"]?.inputs) workflow["137"].inputs.image = finalStartImageName;
        if (workflow["139"]?.inputs) workflow["139"].inputs.image = finalEndImageName;

        let combinedText = '';
        if (clipToUpdate.aiExpandedPrompt?.trim()) {
          combinedText = clipToUpdate.aiExpandedPrompt.trim();
          console.log("🎥 [Generate Video R2V] Using AI Expanded Prompt:", combinedText);
        } else {
          combinedText = buildMiniMaxH3DirectBrief(clipToUpdate, frameRate);
          console.log("🎥 [Generate Video R2V] Using MiniMax H3 Direct Brief Prompt:", combinedText);
        }

        if (workflow["138"]?.inputs) workflow["138"].inputs.value = combinedText;
        if (workflow["132"]?.inputs) workflow["132"].inputs.value = clipToUpdate.duration;
        if (workflow["129"]?.inputs) workflow["129"].inputs.noise_seed = rng_seed;
        if (workflow["130"]?.inputs) workflow["130"].inputs.fps = frameRate;
      } else {
        // WHAT: Executing the standard single-image Image-to-Video workflow.
        // WHY: Only Image 1 is provided, maintaining full backward compatibility.
        workflow = JSON.parse(JSON.stringify(workflowJsonTemplate)) as ComfyWorkflow;

        if (workflow["114"]?.inputs) workflow["114"].inputs.image = finalStartImageName;
        if (workflow["105:104"]?.inputs) {
          let combinedText = '';

          if (clipToUpdate.aiExpandedPrompt?.trim()) {
            combinedText = clipToUpdate.aiExpandedPrompt.trim();
            console.log("🎥 [Generate Video] Using AI Expanded Prompt:", combinedText);
          } else {
            const actionText = (clipToUpdate.notes?.action || (clipToUpdate as LegacyClipFields).actionNotes || (clipToUpdate as LegacyClipFields).promptText || '')?.trim() || '';
            const descText = clipToUpdate.actionDescription || clipToUpdate.startImageDescription || '';
            
            const promptParts = [];
            if (descText) promptParts.push(descText);
            if (actionText) promptParts.push(`action: ${actionText}`);
            
            combinedText = promptParts.length > 0 ? promptParts.join(", ") : clipToUpdate.label;
            console.log("🎥 [Generate Video] Using Combined Prompt:", combinedText);
          }
          
          workflow["105:104"].inputs.prompt = combinedText;
        }

        if (workflow["105:15"]?.inputs) workflow["105:15"].inputs.noise_seed = rng_seed;
        if (workflow["105:111"]?.inputs) workflow["105:111"].inputs.value = clipToUpdate.duration;
        if (workflow["105:91"]?.inputs) workflow["105:91"].inputs.fps = frameRate;
      }

      // 5. Queue and Poll
      const startTimeMs = Date.now();
      const result = await queuePrompt(workflow);
      if (!result?.prompt_id) throw new Error('Failed to queue prompt');

      addLog(`Generating Video (ID: ${result.prompt_id})...`);
      const historyOutputs = await waitForPromptWebSocket(result.prompt_id, workflow, (status, progress) => {
        if (status) addLog(status);
        if (progress !== undefined) {
          setVideoQueue(prev => prev.map(item => item.id === queueItem.id ? { ...item, progress } : item));
        }
      });

      // 6. Move output
      const fs = getNodeFs();
      const path = getNodePath();
      if (!fs || !path) throw new Error('Filesystem access unavailable in web environment.');

      let latestSourcePath = "";
      const videoOutDir = path.join(comfyOutputDir, 'video');

      // Attempt to extract exact filename from history outputs
      let exactFileName = "";
      let subfolder = "";
      const saveNodeOutput = historyOutputs?.["92"];
      if (saveNodeOutput) {
        const mediaArr = saveNodeOutput.gifs || saveNodeOutput.images || saveNodeOutput.videos || saveNodeOutput.filenames || [];
        if (mediaArr.length > 0) {
          const firstMediaItem = mediaArr[0];
          if (typeof firstMediaItem === 'string') {
            exactFileName = firstMediaItem;
          } else if (firstMediaItem && typeof firstMediaItem === 'object') {
            exactFileName = firstMediaItem.filename || "";
            subfolder = firstMediaItem.subfolder || "";
          }
        }
      }

      if (exactFileName && typeof exactFileName === 'string') {
        latestSourcePath = path.join(comfyOutputDir, subfolder, exactFileName);
      } else {
        const findLatest = (dir: string) => {
          if (!fs.existsSync(dir)) return "";
          const files = fs.readdirSync(dir).filter((f: string) => (f.includes('LTX_2') || f.includes('MiniMax')) && f.endsWith('.mp4'));
          if (files.length === 0) return "";
          return files.sort((a: string, b: string) => 
            fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs
          )[0];
        };

        const latestVideo = findLatest(videoOutDir);
        let candidatePath = "";
        if (latestVideo) candidatePath = path.join(videoOutDir, latestVideo);
        else {
          const rootVideo = findLatest(comfyOutputDir);
          if (rootVideo) candidatePath = path.join(comfyOutputDir, rootVideo);
        }

        // Only accept the file if it was created/modified during or after this generation
        if (candidatePath && fs.statSync(candidatePath).mtimeMs >= startTimeMs - 5000) {
          latestSourcePath = candidatePath;
        } else {
          throw new Error(`Video generation failed: ComfyUI completed the prompt, but no new video file was found in the output directory. (Last found file was older than this generation).`);
        }
      }

      if (!latestSourcePath) throw new Error("Generated video file not found.");

      const destVideosDir = path.join(project.outputDir || '', 'videos');
      if (!fs.existsSync(destVideosDir)) fs.mkdirSync(destVideosDir, { recursive: true });

      const existingTakes = clipToUpdate.generatedVideos?.length || 0;
      const safeLabel = clipToUpdate.label.replace(/[^a-z0-9]/gi, '_');
      const destPath = path.join(destVideosDir, `${safeLabel}_take${existingTakes + 1}.mp4`);

      fs.copyFileSync(latestSourcePath, destPath);
      
      // 7. Success Update
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const finalClips = prev.clips?.map((c: VideoClip) => {
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
        return { clips: finalClips };
      });
      addLog(`Successfully generated video for "${clipToUpdate.label}"`);
      return { success: true };

    } catch (err: unknown) {
      const error_message = err instanceof Error ? err.message : String(err);
      console.error('Generation Error:', err);
      addLog(`Error generating clip: ${error_message}`);
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const errorClips = prev.clips?.map((c: VideoClip) => 
          c.id === clipId ? { ...c, status: 'error' as const } : c
        );
        return { clips: errorClips };
      });
      return { success: false, error: error_message };
    }
  }, [projects, comfyConnected, comfyOutputDir, handleUpdateProject]);

  // --- Shared Image Description Logic (Function-Aware Qwen-VL) ---
  const handleGenerateDescription = useCallback(async (queueItem: QueueItem) => {
    const { clipId, projectId, imageSlot = 'startImagePath' } = queueItem;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    const clipToUpdate = project.clips?.find((c: VideoClip) => c.id === clipId);
    const targetImagePath = imageSlot === 'endImagePath' ? clipToUpdate?.endImagePath : clipToUpdate?.startImagePath;

    if (!clipToUpdate || !targetImagePath) {
      addLog(`Error: Clip ${clipId} missing image in ${imageSlot === 'endImagePath' ? 'Image 2' : 'Image 1'}.`);
      return { success: false, error: "Missing image" };
    }

    const assignedFunction: ImageFunction = imageSlot === 'endImagePath' 
      ? (clipToUpdate.endImageFunction || 'end_frame')
      : (clipToUpdate.startImageFunction || 'start_frame');

    const roleConfig = getImageFunctionConfiguration(assignedFunction);

    const specializedPrompt = buildQwenVisionPromptForFunction(assignedFunction, {
      shotLabel: clipToUpdate.label,
      actionIntent: clipToUpdate.notes?.action,
      dialogueOrLyrics: clipToUpdate.notes?.dialogue,
      targetDurationSeconds: clipToUpdate.duration,
    });

    try {
      const providerLabel = llmProvider === 'llama-server' ? 'llama-server (Qwen 3.5 9B)' : 'ComfyUI (Qwen-VL)';
      addLog(`[Queue] Describing "${clipToUpdate.label}" (${roleConfig.displayName}) via ${providerLabel}...`);

      let description = "";

      // WHAT: Route image analysis directly to llama-server when it is the active LLM provider.
      // WHY: Utilizes the local 9B Qwen 3.5 multimodal model for superior cinematic comprehension without ComfyUI overhead.
      if (llmProvider === 'llama-server') {
        if (isComfyProcessing) {
          addLog('[VRAM Management] Postponing vision description: ComfyUI is actively rendering video.');
          return { success: false, error: 'ComfyUI video rendering is currently active. Vision description delayed to prevent GPU out-of-memory.' };
        }

        const ipcRenderer = getElectronIpc();
        if (!ipcRenderer) {
          throw new Error("Electron IPC is not accessible for local vision model execution.");
        }

        const visionResult = (await ipcRenderer.invoke('llm-describe-image', {
          imagePath: targetImagePath,
          prompt: specializedPrompt,
          maxTokens: 1024
        })) as { success: boolean; text?: string; error?: string };

        if (!visionResult.success || !visionResult.text) {
          throw new Error(visionResult.error || "llama-server returned an empty vision description.");
        }

        description = visionResult.text;
      } else {
        if (!comfyConnected) {
          addLog('Cannot generate: ComfyUI is not connected.');
          return { success: false, error: "ComfyUI not connected" };
        }

        // 1. Upload image to ComfyUI
        const uploadResult = await uploadFileToComfyUI(targetImagePath);
        if (!uploadResult) {
          throw new Error("Failed to upload image to AI service.");
        }

        // 2. Prepare workflow and inject tailored Qwen prompt
        const workflow = JSON.parse(JSON.stringify(imageDescriptionWorkflow));
        workflow["13"].inputs.image = uploadResult.name;

        if (workflow["12"]?.inputs) {
          workflow["12"].inputs.custom_prompt = specializedPrompt;
          workflow["12"].inputs.preset_prompt = "Custom";
        }

        // 3. Queue and wait
        const queueResult = await queuePrompt(workflow);
        if (!queueResult) throw new Error("Failed to queue description task.");

        const historyOutputs = await waitForPromptWebSocket(queueResult.prompt_id, workflow, (status, progress) => {
          if (status) addLog(status);
          if (progress !== undefined) {
            setVideoQueue(prev => prev.map(item => item.id === queueItem.id ? { ...item, progress } : item));
          }
        });
        
        // 4. Extract description from Node 14
        const outputNode = historyOutputs["14"];
        
        if (outputNode?.text && Array.isArray(outputNode.text) && outputNode.text.length > 0) {
          description = outputNode.text[0];
        } else if (typeof outputNode?.text === 'string') {
          description = outputNode.text;
        }
      }

      if (!description) throw new Error("AI returned an empty description.");

      // 5. Update project with result for the specific slot
      handleUpdateProject(project.id, (prevProject: BeatProject) => {
        const updatedClips = (prevProject.clips || []).map(c => {
          if (c.id === clipId) {
            if (imageSlot === 'endImagePath') {
              return {
                ...c,
                endImageDescription: description,
                isDescribing: false,
                isDescribingSlot: null,
              };
            } else {
              const currentNotes = c.notes || { action: '', dialogue: '', sound: '' };
              const cleanNotes = (currentNotes.action === description) 
                ? { ...currentNotes, action: '' } 
                : currentNotes;

              return { 
                ...c, 
                actionDescription: description,
                startImageDescription: description,
                notes: cleanNotes,
                isDescribing: false,
                isDescribingSlot: null,
              };
            }
          }
          return c;
        });
        return { clips: updatedClips };
      });
      addLog(`Successfully generated ${roleConfig.displayName} description for "${clipToUpdate.label}"`);
      return { success: true };

    } catch (err: unknown) {
      const error_message = err instanceof Error ? err.message : String(err);
      console.error('Description Error:', err);
      addLog(`Error generating description: ${error_message}`);
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const errorClips = prev.clips?.map((c: VideoClip) => 
          c.id === clipId ? { ...c, isDescribing: false, isDescribingSlot: null } : c
        );
        return { clips: errorClips };
      });
      return { success: false, error: error_message };
    }
  }, [projects, comfyConnected, handleUpdateProject]);

  // --- Queueable AI Expansion Logic ---
  const handleRewordTask = useCallback(async (queueItem: QueueItem) => {
    const { clipId, projectId } = queueItem;
    const project = projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };
    
    const clip = project.clips?.find(c => c.id === clipId);
    if (!clip) return { success: false, error: 'Clip not found' };

    if (clip.expandedPromptLocked) {
      addLog(`Expansion skipped: "${clip.label}" prompt is locked.`);
      return { success: true };
    }

    try {
      const ipcRenderer = getElectronIpc();
      if (!ipcRenderer) throw new Error("Electron IPC not available.");

      const isDualReference = Boolean(clip.startImagePath && clip.endImagePath);
      const systemPrompt = buildMiniMaxH3SystemPrompt({
        isDualReference,
        startRole: clip.startImageFunction,
        endRole: clip.endImageFunction,
      });

      const userPrompt = buildMiniMaxH3UserPrompt(clip, project.frameRate || 24);

      const result = await ipcRenderer.invoke('llm-generate', { systemPrompt, userPrompt });

      if (result.success) {
        const expandedText = String(result.text || '').trim();
        handleUpdateProject(project.id, (prev: BeatProject) => {
          const updated = prev.clips?.map(candidateClip => candidateClip.id === clipId ? { 
            ...candidateClip, 
            aiExpandedPrompt: expandedText,
            isExpanding: false 
          } : candidateClip);
          return { clips: updated };
        });
        addLog(`Successfully expanded prompt for "${clip.label}"`);
        return { success: true };
      } else {
        throw new Error(result.error || "Unknown LLM error");
      }

    } catch (err: unknown) {
      const error_message = err instanceof Error ? err.message : String(err);
      console.error('Reword Error:', err);
      addLog(`Error expanding prompt: ${error_message}`);
      return { success: false, error: error_message };
    } finally {
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const updated = prev.clips?.map(c => c.id === clipId ? { ...c, isExpanding: false } : c);
        return { clips: updated };
      });
    }
  }, [projects, handleUpdateProject]);

  const handleRewordPrompt = useCallback(async (clipId: string) => {
    const project = activeProject;
    if (!project) return;
    const clip = project.clips?.find(c => c.id === clipId);
    if (!clip || !activeProject) return;

    handleAddToQueue(clipId, activeProject.id, clip.label, 'reword');
  }, [activeProject, handleAddToQueue]);

  /**
   * QUEUE PROCESSOR:
   * 
   * WHY: This is the engine that drives the serial execution of tasks.
   * HOW: It runs as a side-effect whenever the queue or processing state changes.
   * It identifies the next 'queued' item, marks it as 'processing', and 
   * coordinates the hand-off to the generation handlers.
   */
  /**
   * VINO QUEUE PROCESSOR (NPU):
   * 
   * WHY: AI expansion uses system RAM/NPU and can run independently of ComfyUI.
   */
  useEffect(() => {
    const processNextVino = async () => {
      if (isVinoProcessing || isComfyProcessing) return;

      // WHAT: Check if any ComfyUI video tasks are currently queued or actively rendering.
      // WHY: If ComfyUI video jobs are in the queue, keep the LLM unloaded to conserve 100% GPU VRAM.
      const isComfyVideoActive = videoQueue.some(item => item.type === 'video' && (item.status === 'processing' || item.status === 'queued'));
      if (isComfyVideoActive) return;

      const nextItem = videoQueue.find(item => item.status === 'queued' && item.type === 'reword');
      if (!nextItem) return;

      setIsVinoProcessing(true);
      
      // Update item to processing
      setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'processing' } : item));

      // Update clip state
      handleUpdateProject(nextItem.projectId, (prev: BeatProject) => {
        const updatedClips = prev.clips?.map((c: VideoClip) => 
          c.id === nextItem.clipId ? { ...c, isExpanding: true } : c
        );
        return { clips: updatedClips };
      });

      const result = await handleRewordTask(nextItem);
      
      setVideoQueue(prev => prev.map(item => 
        item.id === nextItem.id 
          ? { ...item, status: (result?.success ? 'done' : 'error'), error: result?.error } 
          : item
      ));
      setIsVinoProcessing(false);
    };

    processNextVino();
  }, [videoQueue, isVinoProcessing, handleRewordTask, handleUpdateProject]);

  /**
   * COMFYUI QUEUE PROCESSOR (GPU):
   * 
   * WHY: Video generation is GPU-bound and must wait for pending AI expansions.
   */
  useEffect(() => {
    const processNextComfy = async () => {
      if (isComfyProcessing || isQueuePaused) return;

      // Dependency Check: Find a queued Comfy task that isn't blocked by a pending Reword
      const nextItem = videoQueue.find((item) => {
        if (item.status !== 'queued') return false;
        if (item.type !== 'video' && item.type !== 'description') return false;
        
        // If it's a video task, ensure no REWORD is currently happening or queued for this clip
        const isBlocked = videoQueue.some(q => 
          q.clipId === item.clipId && 
          q.type === 'reword' && 
          (q.status === 'queued' || q.status === 'processing')
        );
        return !isBlocked;
      });
      
      if (!nextItem) return;

      setIsComfyProcessing(true);
      
      // Update item to processing
      setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'processing' } : item));

      // Update clip state
      handleUpdateProject(nextItem.projectId, (prev: BeatProject) => {
        const updatedClips = prev.clips?.map((c: VideoClip) => {
          if (c.id === nextItem.clipId) {
            return nextItem.type === 'description' 
              ? { ...c, isDescribing: true, isDescribingSlot: nextItem.imageSlot || 'startImagePath' } 
              : { ...c, status: 'generating' as const };
          }
          return c;
        });
        return { clips: updatedClips };
      });

      // Health Check: only enforce ComfyUI connection for video generation or ComfyUI vision tasks
      const requiresComfyConnection = nextItem.type !== 'description' || llmProvider !== 'llama-server';
      if (requiresComfyConnection) {
        const isAlive = await checkComfyConnection();
        if (!isAlive) {
          addLog("Queue paused: ComfyUI connection lost.");
          setIsQueuePaused(true);
          setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' } : item));
          
          handleUpdateProject(nextItem.projectId, (prev: BeatProject) => {
            const resetClips = prev.clips?.map(c => 
              c.id === nextItem.clipId 
                ? (nextItem.type === 'description' ? { ...c, isDescribing: false, isDescribingSlot: null } : { ...c, status: 'queued' as const })
                : c
            );
            return { clips: resetClips };
          });

          setIsComfyProcessing(false);
          return;
        }
      }

      const result = nextItem.type === 'description' 
        ? await handleGenerateDescription(nextItem)
        : await handleGenerateVideo(nextItem);
      
      setVideoQueue(prev => prev.map(item => 
        item.id === nextItem.id 
          ? { ...item, status: (result?.success ? 'done' : 'error'), error: result?.error } 
          : item
      ));
      setIsComfyProcessing(false);
    };

    processNextComfy();
  }, [videoQueue, isComfyProcessing, isQueuePaused, handleGenerateVideo, handleGenerateDescription, handleUpdateProject]);

  const handleCreateBlankProject = async (projectName?: string) => {
    let initialOutputDir = undefined;
    try {
      const ipcRenderer = getElectronIpc();
      if (ipcRenderer) {
        const configRes = await ipcRenderer.invoke('get-config');
        if (configRes.success && configRes.config?.projectOutputDir) {
          initialOutputDir = configRes.config.projectOutputDir;
        }
      }
    } catch (e) {
      console.warn("Could not determine default output dir for blank project", e);
    }

    if (!initialOutputDir) {
      try {
        const path = getNodePath();
        if (path) initialOutputDir = path.resolve('./output');
      } catch {
        /* ignore fallback error */
      }
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

  const handleCreateProject = (file: FileWithPath, preferredOutputDir?: string) => {
    // Try to calculate an initial outputDir if possible (useful for Electron)
    let initialOutputDir = preferredOutputDir;
    if (!initialOutputDir) {
      try {
        const path = getNodePath();
        if (path && file.path) {
          initialOutputDir = path.dirname(file.path);
        }
      } catch (e) {
        console.warn("Could not determine default output dir during project creation", e);
      }
    }

    const newProject = saveProject({
      name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
      audioPath: file.path, // Temporary absolute path
      audioFileName: file.name,
      frameRate: 20, // Default to 20 fps for cleaner math in LTX
      stemType: 'master', // Default
      stems: [],
      outputDir: initialOutputDir
    });

    // Post-process project bundle
    if (newProject.outputDir && file.path) {
      try {
        const fs = getNodeFs();
        const path = getNodePath();
        if (fs && path) {
          const sourceDir = path.join(newProject.outputDir, 'source');
          if (!fs.existsSync(sourceDir)) {
            fs.mkdirSync(sourceDir, { recursive: true });
          }

          const safe_audio_filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const destination_audio_path = path.join(sourceDir, safe_audio_filename);
          fs.copyFileSync(file.path, destination_audio_path);

          const relative_audio_path = `./source/${safe_audio_filename}`;
          handleUpdateProject(newProject.id, { audioPath: relative_audio_path });
          newProject.audioPath = relative_audio_path;
        }
      } catch (audio_copy_error) {
        console.error("Failed to copy source audio into the project bundle:", audio_copy_error);
      }
    }

    setActiveProjectId(newProject.id);
    return newProject;
  };

  const renderModule = () => {
    const onPickImage = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
      if (!activeProject?.outputDir) {
        addLog('No project folder available. Save the project first.');
        return;
      }

      try {
        const ipcRenderer = getElectronIpc();
        const path_module = getNodePath();
        if (!ipcRenderer || !path_module) {
          addLog('Electron runtime unavailable for picking images.');
          return;
        }
        const imagesDir = path_module.join(activeProject.outputDir, 'images');

        const filePath = (await ipcRenderer.invoke('open-image-dialog', imagesDir)) as unknown as string | null;

        if (filePath) {
          handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
            const updatedClips = prevProject.clips?.map(clip_item => clip_item.id === clipId ? { ...clip_item, [field]: filePath } : clip_item);
            return { clips: updatedClips };
          });
          addLog(`Updated ${field === 'startImagePath' ? 'Start' : 'End'} Image for clip.`);
        }
      } catch (caught_error) {
        console.error("Failed to pick image:", caught_error);
        addLog("Error opening image dialog.");
      }
    };

    const onCopyImageFromNext = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
      if (!activeProject?.clips) return;
      const currentClip = activeProject.clips.find(clip_item => clip_item.id === clipId);
      if (!currentClip) return;
      const nextClip = activeProject.clips
        .filter(clip_item => clip_item.startTime > currentClip.startTime)
        .sort((earlier_clip, later_clip) => earlier_clip.startTime - later_clip.startTime)[0];
      if (nextClip?.startImagePath) {
        handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
          const updatedClips = (prevProject.clips || []).map(clip_item => 
            clip_item.id === clipId ? { ...clip_item, [field]: nextClip.startImagePath } : clip_item
          );
          return { ...prevProject, clips: updatedClips };
        });
        addLog(`Copied Start Image from next clip to ${field === 'startImagePath' ? 'Start' : 'End'} field.`);
      } else {
        addLog("No start image found in the next clip.");
      }
    };

    const onCopyEndFrameFromPrev = async (clipId: string, exactBeat: boolean = false): Promise<void> => {
      if (!activeProject?.clips || !activeProject.outputDir) return;

      const currentClip = activeProject.clips.find(clip_item => clip_item.id === clipId);
      if (!currentClip) return;
      
      const prevClip = activeProject.clips
        .filter(clip_item => clip_item.startTime < currentClip.startTime)
        .sort((earlier_clip, later_clip) => later_clip.startTime - earlier_clip.startTime)[0];

      if (!prevClip || !prevClip.videoPath) {
        addLog("No generated video found in the preceding clip.");
        return;
      }

      addLog(`Extracting end frame from previous clip's video (${exactBeat ? 'exact beat' : 'video end'})...`);

      try {
        const ipcRenderer = getElectronIpc();
        if (!ipcRenderer) {
          addLog('Electron runtime unavailable.');
          return;
        }
        const infoResult = (await ipcRenderer.invoke('get-video-info', prevClip.videoPath)) as { success: boolean; info?: { duration?: number } };
        
        let targetTime = prevClip.duration;
        
        if (exactBeat) {
            // Use the exact planned duration (which corresponds to the beat markers)
            targetTime = prevClip.duration;
            // Bound it slightly just in case the video is physically shorter than planned
            if (infoResult.success && infoResult.info?.duration) {
                targetTime = Math.min(targetTime, Math.max(0, infoResult.info.duration - 0.1));
            }
        } else {
            // Use the physical end of the generated wrapper video
            if (infoResult.success && infoResult.info?.duration) {
                targetTime = Math.max(0, infoResult.info.duration - 0.1);
            } else {
                targetTime = Math.max(0, prevClip.duration - 0.1);
            }
        }

        const result = (await ipcRenderer.invoke('save-video-frame', {
            filePath: prevClip.videoPath,
            time: targetTime,
            outputDir: activeProject.outputDir,
            filename: `endframe_${prevClip.id}_${Date.now()}.png`
        })) as { success: boolean; framePath?: string; error?: string };

        if (result.success && result.framePath) {
            handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
                const updatedClips = (prevProject.clips || []).map(clip_item => 
                    clip_item.id === clipId ? { ...clip_item, startImagePath: result.framePath } : clip_item
                );
                return { ...prevProject, clips: updatedClips };
            });
            addLog(`Successfully extracted and applied end frame from previous clip.`);
        } else {
            addLog(`Failed to extract end frame: ${result.error}`);
        }
      } catch (caught_error: unknown) {
          console.error("Error extracting end frame:", caught_error);
          addLog("Error extracting end frame.");
      }
    };

    const onGetImageDescription = async (clipId: string, slot: 'startImagePath' | 'endImagePath' = 'startImagePath'): Promise<void> => {
      const isVisionCapable = (llmProvider === 'llama-server') || comfyConnected;
      if (!activeProject?.clips || !isVisionCapable) return;
      
      const clip = activeProject.clips.find(clip_item => clip_item.id === clipId);
      const targetImagePath = slot === 'endImagePath' ? clip?.endImagePath : clip?.startImagePath;
      if (!clip || !targetImagePath) {
        addLog(`No image found in ${slot === 'endImagePath' ? 'Image 2' : 'Image 1'} to describe.`);
        return;
      }

      handleAddToQueue(clip.id, activeProject.id, clip.label, 'description', slot);
    };

    const onGenerateVideo = async (clipId: string): Promise<void> => {
      if (activeProject) {
        const clip = activeProject.clips?.find(clip_item => clip_item.id === clipId);
        handleAddToQueue(clipId, activeProject.id, clip?.label || 'Untitled Clip');
      }
    };

    switch (activeModule) {
      case 'script-manager':
        return <ScriptManagerModule />;

      case 'settings':
        return <SettingsModule onSave={() => { refreshProjects(); refreshGlobalConfig(); }} />;
      case 'workflow-analyzer':
        return <WorkflowAnalyzerModule onStatusChange={addLog} />;
      case 'mcp-control':
        return <McpControlModule onStatusChange={addLog} />;
      case 'storyboard':
        return (
          <StoryboardModule
            activeProject={activeProject}
            projects={projects}
            onSelectProject={handleSelectProject}
            onCreateBlankProject={handleCreateBlankProject}
            onUpdateProject={handleUpdateProject}
            onGenerateVideo={onGenerateVideo}
            onPickImage={onPickImage}
            onCopyImageFromNext={onCopyImageFromNext}
            onCopyEndFrameFromPrev={onCopyEndFrameFromPrev}
            onGetImageDescription={onGetImageDescription}
            onRewordPrompt={handleRewordPrompt}
            llmProvider={llmProvider}
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
            onPickImage={onPickImage}
            onCopyImageFromNext={onCopyImageFromNext}
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
            onPickImage={onPickImage}
            onCopyImageFromNext={onCopyImageFromNext}
            comfyConnected={comfyConnected}
            comfyOutputDir={comfyOutputDir}
          />
        );
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
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
    </TooltipProvider>
  );
}

export default App;
