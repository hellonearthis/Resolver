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

import {
  checkComfyConnection, 
  queuePrompt, 
  uploadFileToComfyUI, 
  waitForPromptWebSocket,
  convertAudioForComfyUI
} from './services/comfyService';

import type { VideoClip } from './types/assembler';
import workflowJsonTemplate from '../comfyui_workflows/minimax_image_to_video_api.json';
import imageDescriptionWorkflow from '../comfyui_workflows/llm_qwen3_image_discription_api.json';
import { TooltipProvider } from './components/ui/Tooltip';

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
  type?: 'video' | 'description' | 'reword';
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
  const [llmProvider, setLlmProvider] = useState<'lmstudio' | 'vino'>('lmstudio');

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
      // @ts-ignore
      const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
      if (ipcRenderer) {
        const res = await ipcRenderer.invoke('get-config');
        if (res.success && res.config) {
          if (res.config.comfyOutputDir) setComfyOutputDir(res.config.comfyOutputDir);
          if (res.config.llmProvider) setLlmProvider(res.config.llmProvider);
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
  }, [activeProjectId]); // Only run when changing project IDs

  const handleUpdateProject = (id: string, updates: Partial<BeatProject> | ((prev: BeatProject) => Partial<BeatProject>)) => {
    updateProject(id, updates);
  };

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
  const handleAddToQueue = useCallback((clipId: string, projectId: string, label: string, type: 'video' | 'description' | 'reword' = 'video') => {
    setVideoQueue(prev => {
      if (prev.find(item => item.clipId === clipId && item.type === type && (item.status === 'queued' || item.status === 'processing'))) {
        return prev;
      }
      const newItem: QueueItem = {
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        clipId,
        projectId,
        status: 'queued',
        label: type === 'description' ? `Description: ${label}` : label,
        addedAt: Date.now(),
        type
      };
      
      // Update clip status in project
      handleUpdateProject(projectId, (prevProject: BeatProject) => {
        const updatedClips = prevProject.clips?.map(c => {
          if (c.id === clipId) {
            if (type === 'video') return { ...c, status: 'queued' as const };
            if (type === 'description') return { ...c, isDescribing: true };
            if (type === 'reword') return { ...c, isExpanding: true };
          }
          return c;
        });
        return { clips: updatedClips };
      });

      return [...prev, newItem];
    });
    addLog(`Added ${type === 'description' ? 'description task' : 'clip'} "${label}" to generation queue.`);
  }, [projects, handleUpdateProject]);

  const handleRemoveFromQueue = useCallback((id: string) => {
    setVideoQueue(prev => {
      const itemToRemove = prev.find(item => item.id === id);
      if (itemToRemove) {
        const project = projects.find(p => p.id === itemToRemove.projectId);
        if (project) {
          const updatedClips = project.clips?.map(c => 
            (c.id === itemToRemove.clipId)
              ? (itemToRemove.type === 'description' 
                   ? { ...c, isDescribing: false } 
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
                   ? { ...c, isDescribing: false } 
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
        let updated = { ...c };
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

        // STEP 3: Upload Audio File
        // HOW: We determine if we need a specific stem or the master audio.
        // We also perform a conversion to WAV (handled in comfyService) if needed
        // to ensure compatibility with the ComfyUI audio nodes.
        // let finalAudioName = "audio.wav";
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

        // --- NEW: Convert to WAV if it's an MP3 or other format to avoid header errors ---
        let finalPathToUpload = absoluteAudioPath;
        const ext = path.extname(absoluteAudioPath).toLowerCase();
        if (ext === '.mp3' || ext === '.m4a' || ext === '.aac' || ext === '.ogg') {
            const wavPath = await convertAudioForComfyUI(absoluteAudioPath);
            if (wavPath) finalPathToUpload = wavPath;
            else console.warn(`Failed to convert ${absoluteAudioPath} to WAV, trying raw upload.`);
        }

        const uploadResult = await uploadFileToComfyUI(finalPathToUpload);
        if (!uploadResult?.name) throw new Error(`Failed to upload audio to ComfyUI.`);
      }

      // STEP 4: Inject Workflow Data
      const workflow = JSON.parse(JSON.stringify(workflowJsonTemplate));

      if (workflow["114"]?.inputs) workflow["114"].inputs.image = finalImageName;
      if (workflow["105:104"]?.inputs) {
        let combinedText = '';

        if (clipToUpdate.aiExpandedPrompt?.trim()) {
          combinedText = clipToUpdate.aiExpandedPrompt.trim();
          console.log("🎥 [Generate Video] Using AI Expanded Prompt:", combinedText);
        } else {
          const actionText = (clipToUpdate.notes?.action || (clipToUpdate as any).actionNotes || (clipToUpdate as any).promptText || '')?.trim() || '';
          const descText = clipToUpdate.actionDescription?.trim() || '';
          
          const promptParts = [];
          if (descText) promptParts.push(descText);
          if (actionText) promptParts.push(`action: ${actionText}`);
          
          combinedText = promptParts.length > 0 ? promptParts.join(", ") : clipToUpdate.label;
          console.log("🎥 [Generate Video] Using Legacy Combined Prompt:", combinedText);
        }
        
        workflow["105:104"].inputs.prompt = combinedText;
      }
      const rng_seed = Math.floor(Math.random() * 1000000000000000);
      if (workflow["105:15"]?.inputs) workflow["105:15"].inputs.noise_seed = rng_seed;
      if (workflow["105:111"]?.inputs) workflow["105:111"].inputs.value = clipToUpdate.duration;
      if (workflow["105:91"]?.inputs) workflow["105:91"].inputs.fps = frameRate;

      // Note: Minimax model handles audio internally if passed, 
      // but this API JSON does not have a LoadAudio node.
      
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
      // @ts-ignore
      const fs = window.require('fs');
      // @ts-ignore
      const path = window.require('path');

      let latestSourcePath = "";
      const videoOutDir = path.join(comfyOutputDir, 'video');

      // Attempt to extract exact filename from history outputs
      let exactFileName = "";
      let subfolder = "";
      const saveNodeOutput = historyOutputs?.["92"];
      if (saveNodeOutput) {
        const mediaArr = saveNodeOutput.gifs || saveNodeOutput.images || saveNodeOutput.videos || saveNodeOutput.filenames || [];
        if (mediaArr.length > 0) {
          exactFileName = mediaArr[0].filename || mediaArr[0];
          subfolder = mediaArr[0].subfolder || "";
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
        const finalClips = prev.clips?.map((c: any) => {
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

    } catch (err: any) {
      console.error('Generation Error:', err);
      addLog(`Error generating clip: ${err.message}`);
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const errorClips = prev.clips?.map((c: any) => 
          c.id === clipId ? { ...c, status: 'error' as const } : c
        );
        return { clips: errorClips };
      });
      return { success: false, error: err.message };
    }
  }, [projects, comfyConnected, comfyOutputDir, handleUpdateProject]);

  // --- Shared Image Description Logic ---
  const handleGenerateDescription = useCallback(async (queueItem: QueueItem) => {
    const { clipId, projectId } = queueItem;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    const clipToUpdate = project.clips?.find((c: VideoClip) => c.id === clipId);
    if (!clipToUpdate || !clipToUpdate.startImagePath) {
      addLog(`Error: Clip ${clipId} missing or has no start image.`);
      return { success: false, error: "Missing start image" };
    }

    if (!comfyConnected) {
      addLog('Cannot generate: ComfyUI is not connected.');
      return { success: false, error: "ComfyUI not connected" };
    }

    try {
      addLog(`[Queue] Describing "${clipToUpdate.label}"...`);

      // 1. Upload image to ComfyUI
      const uploadResult = await uploadFileToComfyUI(clipToUpdate.startImagePath);
      if (!uploadResult) {
        throw new Error("Failed to upload image to AI service.");
      }

      // 2. Prepare workflow
      const workflow = JSON.parse(JSON.stringify(imageDescriptionWorkflow));
      workflow["13"].inputs.image = uploadResult.name;

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
      let description = "";
      
      if (outputNode?.text && Array.isArray(outputNode.text) && outputNode.text.length > 0) {
        description = outputNode.text[0];
      } else if (typeof outputNode?.text === 'string') {
        description = outputNode.text;
      }

      if (!description) throw new Error("AI returned an empty description.");

      // 5. Update project with result
      handleUpdateProject(project.id, (prevProject: BeatProject) => {
        const updatedClips = (prevProject.clips || []).map(c => {
          if (c.id === clipId) {
            /**
             * DATA CLEANUP: 
             * If the AI description was previously (mis)stored in notes.action, 
             * we clear that field now that we have a proper actionDescription slot.
             */
            const currentNotes = c.notes || { action: '', dialogue: '', sound: '' };
            const cleanNotes = (currentNotes.action === description) 
              ? { ...currentNotes, action: '' } 
              : currentNotes;

            return { 
              ...c, 
              actionDescription: description, 
              notes: cleanNotes,
              isDescribing: false 
            };
          }
          return c;
        });
        return { clips: updatedClips };
      });
      addLog(`Successfully generated description for "${clipToUpdate.label}"`);
      return { success: true };

    } catch (err: any) {
      console.error('Description Error:', err);
      addLog(`Error generating description: ${err.message}`);
      handleUpdateProject(project.id, (prev: BeatProject) => {
        const errorClips = prev.clips?.map((c: any) => 
          c.id === clipId ? { ...c, isDescribing: false } : c
        );
        return { clips: errorClips };
      });
      return { success: false, error: err.message };
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
      // @ts-ignore
      const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
      if (!ipcRenderer) throw new Error("Electron IPC not available.");

      const systemPrompt = `You are a MiniMax H3 Video Prompt Writer. Your ONLY job is to create a written text prompt for the MiniMax H3 video model in I2VA (Image-to-Video-with-Audio) mode.

REQUIRED OUTPUT FORMAT — Every prompt MUST contain exactly these three fields:

integrated_multimodal_description: ...
overall_soundscape: ...
non_diegetic_music: ...

I2VA RULES:
- The input image is the actual first frame. The description MUST begin from the visible image and develop forward.
- Always begin with the image-alignment instruction on its own line, followed by a blank line.
- Use this motion structure: First-frame anchor + action onset + continuous development + result or reaction.
- At the beginning of Shot 1: establish the style shown in Picture 1, identify the subject, preserve the opening composition, clothing, colors, objects, and spatial relationships, then begin the requested action naturally.
- Focus mainly on what CHANGES after the first frame.

SHOT AND TIMESTAMP RULES:
- The first shot NEVER receives a timestamp. Later shots begin with strictly increasing cut times in 00:SS.mmm format.
- Only use timestamps when there are multiple shots AND a duration is provided.
- Do NOT use timestamps to describe ordinary actions within a continuous shot.

CAMERA MOVEMENT — Write camera movement naturally inside integrated_multimodal_description. Use specific terminology: Zoom In/Out, Push In, Pull Out, Pan Left/Right, Truck Left/Right, Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly/Strongly, POV, Roll. Include amplitude (small/large) and speed (slow/fast) when meaningful.

MOTION WRITING — Every action must describe something visible or audible. Use: Starting state + action + direction + speed + physical response + result. Describe cause and effect. Do NOT use vague phrases like "realistic physics" or "cinematic animation."

DIALOGUE — If the scene involves singing, talking, or speaking lyrics, describe that action explicitly. Use speaker IDs (S1), (S2) etc. Format dialogue as: The character with a [voice description] (S1) says: <d>[English] exact words here</d>. CRITICAL: Preserve all lyrics or dialogue VERBATIM. Never reword them.

SOUNDSCAPE — overall_soundscape summarizes ambient and physical sounds across the full video. Do NOT repeat dialogue, singing, or music here.

MUSIC — non_diegetic_music describes background music heard only by the audience. Describe actual instruments, tempo, rhythm, intensity. Use "N/A" when there is no background music. Diegetic music (from objects in the scene) goes in integrated_multimodal_description instead.

RESTRICTIONS:
- Output ONLY the prompt text. No introductions, explanations, notes, or commentary.
- Do not use JSON.
- Do not invent or assume a video duration unless one is provided.
- Use natural English, not technical codes.
- Prefer positive precise descriptions over negative keyword lists.`;

      const parts = [];
      if (clip.actionDescription) parts.push(`Image Description: ${clip.actionDescription}`);
      if (clip.notes?.action) parts.push(`Action Intent: ${clip.notes.action}`);
      if (clip.notes?.dialogue) parts.push(`Dialogue/Lyrics: ${clip.notes.dialogue}`);
      if (clip.notes?.sound) parts.push(`Sound Notes: ${clip.notes.sound}`);
      if (clip.duration) parts.push(`Duration: ${clip.duration.toFixed(2)} seconds`);
      const userPrompt = parts.join('\n\n');

      const result = await ipcRenderer.invoke('llm-generate', { systemPrompt, userPrompt });

      if (result.success) {
        const expandedText = String(result.text || '').trim();
        handleUpdateProject(project.id, (prev: BeatProject) => {
          const updated = prev.clips?.map(c => c.id === clipId ? { 
            ...c, 
            aiExpandedPrompt: expandedText,
            isExpanding: false 
          } : c);
          return { clips: updated };
        });
        addLog(`Successfully expanded prompt for "${clip.label}"`);
        return { success: true };
      } else {
        throw new Error(result.error || "Unknown LLM error");
      }

    } catch (err: any) {
      console.error('Reword Error:', err);
      addLog(`Error expanding prompt: ${err.message}`);
      return { success: false, error: err.message };
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
      if (isVinoProcessing) return;

      const nextItem = videoQueue.find(item => item.status === 'queued' && item.type === 'reword');
      if (!nextItem) return;

      setIsVinoProcessing(true);
      
      // Update item to processing
      setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'processing' } : item));

      // Update clip state
      handleUpdateProject(nextItem.projectId, (prev: BeatProject) => {
        const updatedClips = prev.clips?.map((c: any) => 
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
  }, [videoQueue, isVinoProcessing, handleRewordTask]);

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
        const updatedClips = prev.clips?.map((c: any) => {
          if (c.id === nextItem.clipId) {
            return nextItem.type === 'description' ? { ...c, isDescribing: true } : { ...c, status: 'generating' as const };
          }
          return c;
        });
        return { clips: updatedClips };
      });

      // Health Check
      const isAlive = await checkComfyConnection();
      if (!isAlive) {
        addLog("Queue paused: ComfyUI connection lost.");
        setIsQueuePaused(true);
        setVideoQueue(prev => prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' } : item));
        
        handleUpdateProject(nextItem.projectId, (prev: BeatProject) => {
          const resetClips = prev.clips?.map(c => 
            c.id === nextItem.clipId 
              ? (nextItem.type === 'description' ? { ...c, isDescribing: false } : { ...c, status: 'queued' as const })
              : c
          );
          return { clips: resetClips };
        });

        setIsComfyProcessing(false);
        return;
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
  }, [videoQueue, isQueuePaused, isComfyProcessing, handleGenerateVideo, handleGenerateDescription]);

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
    const onPickImage = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
      if (!activeProject?.outputDir) {
        addLog('No project folder available. Save the project first.');
        return;
      }

      try {
        const { ipcRenderer } = window.require('electron');
        const path = window.require('path');
        const imagesDir = path.join(activeProject.outputDir, 'images');

        const filePath = await ipcRenderer.invoke('open-image-dialog', imagesDir);

        if (filePath) {
          handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
            const updatedClips = prevProject.clips?.map(c => c.id === clipId ? { ...c, [field]: filePath } : c);
            return { clips: updatedClips };
          });
          addLog(`Updated ${field === 'startImagePath' ? 'Start' : 'End'} Image for clip.`);
        }
      } catch (err) {
        console.error("Failed to pick image:", err);
        addLog("Error opening image dialog.");
      }
    };

    const onCopyImageFromNext = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
      if (!activeProject?.clips) return;
      const currentClip = activeProject.clips.find(c => c.id === clipId);
      if (!currentClip) return;
      const nextClip = activeProject.clips
        .filter(c => c.startTime > currentClip.startTime)
        .sort((a, b) => a.startTime - b.startTime)[0];
      if (nextClip?.startImagePath) {
        handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
          const updatedClips = (prevProject.clips || []).map(c => 
            c.id === clipId ? { ...c, [field]: nextClip.startImagePath } : c
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

      const currentClip = activeProject.clips.find(c => c.id === clipId);
      if (!currentClip) return;
      
      const prevClip = activeProject.clips
        .filter(c => c.startTime < currentClip.startTime)
        .sort((a, b) => b.startTime - a.startTime)[0];

      if (!prevClip || !prevClip.videoPath) {
        addLog("No generated video found in the preceding clip.");
        return;
      }

      addLog(`Extracting end frame from previous clip's video (${exactBeat ? 'exact beat' : 'video end'})...`);

      try {
        const { ipcRenderer } = window.require('electron');
        const infoResult = await ipcRenderer.invoke('get-video-info', prevClip.videoPath);
        
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

        const result = await ipcRenderer.invoke('save-video-frame', {
            filePath: prevClip.videoPath,
            time: targetTime,
            outputDir: activeProject.outputDir,
            filename: `endframe_${prevClip.id}_${Date.now()}.png`
        });

        if (result.success && result.framePath) {
            handleUpdateProject(activeProject.id, (prevProject: BeatProject) => {
                const updatedClips = (prevProject.clips || []).map(c => 
                    c.id === clipId ? { ...c, startImagePath: result.framePath } : c
                );
                return { ...prevProject, clips: updatedClips };
            });
            addLog(`Successfully extracted and applied end frame from previous clip.`);
        } else {
            addLog(`Failed to extract end frame: ${result.error}`);
        }
      } catch (err: any) {
          console.error("Error extracting end frame:", err);
          addLog("Error extracting end frame.");
      }
    };

    const onGetImageDescription = async (clipId: string): Promise<void> => {
      if (!activeProject?.clips || !comfyConnected) return;
      
      const clip = activeProject.clips.find(c => c.id === clipId);
      if (!clip || !clip.startImagePath) {
        addLog("No start image to describe.");
        return;
      }

      handleAddToQueue(clip.id, activeProject.id, clip.label, 'description');
    };

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
        return <SettingsModule onSave={() => { refreshProjects(); refreshGlobalConfig(); }} />;
      case 'workflow-analyzer':
        return <WorkflowAnalyzerModule onStatusChange={addLog} />;
      case 'storyboard':
        return (
          <StoryboardModule
            activeProject={activeProject}
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
