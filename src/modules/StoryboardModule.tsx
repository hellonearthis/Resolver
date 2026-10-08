/**
 * StoryboardModule
 * 
 * The main container for the Storyboard interface. It orchestrates the rendering of panels,
 * manages the timing relationship between clips (the 'rippling' effect), and synchronizes
 * project data with external assets like generated videos.
 */

import React, { useState } from 'react';
import type { VideoClip } from '../types/assembler';
import { PacingBenchmarks } from '../types/storyboard';
import { getAlignedDuration } from '../utils/timelineUtils';
import StoryboardCardComponent from '../components/storyboard/StoryboardCard';
import AnimaticTimeline from '../components/storyboard/AnimaticTimeline';
import StoryboardPaddingCard from '../components/storyboard/StoryboardPaddingCard';
import StoryboardContextMenu from '../components/storyboard/StoryboardContextMenu';
import type { BeatProject } from '../hooks/useProjectStorage';
import { parseFountainScript } from '../services/fountainParser';
import { SECTION_TYPE_COLOR_MAP } from '../types/sections';
import { generateMusicVideoManifest } from '../services/manifestService';
import { 
    evaluateProjectRevisions, 
    buildResolveRevisionMarkers, 
    filterClipsForGeneration 
} from '../services/revisionDiffService';
import { ResolveBridgeClient } from '../services/resolveBridgeClient';

// WHAT: Strict types for storyboard timeline items distinguishing active video shots from timeline gaps.
// WHY: Replaces `any[]` with a type-safe discriminated union that feeds both the card grid and the bottom animatic bar.
export interface TimelineClipItem {
    type: 'clip';
    startTime: number;
    endTime: number;
    duration: number;
    clip: VideoClip;
    label: string;
}

export interface TimelineGapItem {
    type: 'unselected';
    startTime: number;
    endTime: number;
    duration: number;
    label: string;
}

export type StoryboardTimelineItem = TimelineClipItem | TimelineGapItem;

// WHAT: Minimal duck-typed interfaces for Node.js fs and path in Electron environment.
// WHY: Avoids strict Node import errors in client Vite build while allowing native filesystem access in desktop runtime.
interface NodeFsModule {
    existsSync: (file_path: string) => boolean;
    readdirSync: (directory_path: string) => string[];
}

interface NodePathModule {
    join: (...path_segments: string[]) => string;
}

interface ElectronIpcRenderer {
    invoke: <T = unknown>(channel_name: string, ...arguments_list: unknown[]) => Promise<T>;
}

interface ElectronWindowExtended {
    require?: (module_name: string) => unknown;
    ipcRenderer?: ElectronIpcRenderer;
}

const getElectronIpc = (): ElectronIpcRenderer | null => {
    try {
        const win = window as unknown as ElectronWindowExtended;
        if (win.require) {
            const electron_module = win.require('electron') as { ipcRenderer?: ElectronIpcRenderer } | null;
            return electron_module?.ipcRenderer ?? null;
        }
        return win.ipcRenderer ?? null;
    } catch {
        return null;
    }
};

interface StoryboardModuleProps {
    activeProject?: BeatProject;
    projects?: BeatProject[];
    onSelectProject?: (project_identifier: string) => void;
    onCreateBlankProject?: (project_name?: string) => Promise<BeatProject>;
    onUpdateProject: (project_identifier: string, project_updates: Partial<BeatProject>) => void;
    onGenerateVideo?: (clip_identifier: string) => Promise<void>;
    onPickImage?: (clip_identifier: string, image_field_name: 'startImagePath' | 'endImagePath') => void;
    onCopyImageFromNext?: (clip_identifier: string, image_field_name: 'startImagePath' | 'endImagePath') => void;
    onCopyEndFrameFromPrev?: (clip_identifier: string, align_to_exact_beat?: boolean) => void;
    onGetImageDescription?: (clip_identifier: string, image_slot?: 'startImagePath' | 'endImagePath') => Promise<void>;
    onRewordPrompt?: (clip_identifier: string) => Promise<void>;
    llmProvider?: 'llama-server' | 'vino';
    comfyConnected?: boolean;
}

const StoryboardModule: React.FC<StoryboardModuleProps> = ({ 
    activeProject, 
    projects,
    onSelectProject,
    onCreateBlankProject,
    onUpdateProject, 
    onGenerateVideo,
    onPickImage,
    onCopyImageFromNext,
    onCopyEndFrameFromPrev,
    onGetImageDescription,
    onRewordPrompt,
    llmProvider,
    comfyConnected
}) => {
    const [, setSelectedCardId] = useState<string | null>(null);
    const [newStoryboardTitleInput, setNewStoryboardTitleInput] = useState<string>('');
    const [isCreatingStoryboardState, setIsCreatingStoryboardState] = useState<boolean>(false);
    const [viewMode, setViewMode] = useState<'outline' | 'grid'>('outline');
    const [importStatusMessage, setImportStatusMessage] = useState<string>('');
    const [contextMenu, setContextMenu] = useState<{ card: VideoClip; position: { x: number; y: number } } | null>(null);
    const fountainFileInputRef = React.useRef<HTMLInputElement>(null);

    const handleImportFountainClick = () => {
        fountainFileInputRef.current?.click();
    };

    const handleFountainFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const file_text = await file.text();
            const parsed = parseFountainScript(file_text, {
                frameRate: activeProject?.frameRate || 24,
                existingClips: activeProject?.clips
            });

            if (activeProject) {
                const updated_duration = parsed.clips.length > 0 
                    ? parsed.clips[parsed.clips.length - 1].endTime 
                    : (activeProject.duration || 0);

                onUpdateProject(activeProject.id, {
                    sections: parsed.sections,
                    clips: parsed.clips,
                    duration: Math.max(activeProject.duration || 0, updated_duration),
                    name: (activeProject.name.startsWith('PRJ_') || activeProject.name === 'Untitled Project') && parsed.title !== 'Untitled Storyboard'
                        ? parsed.title
                        : activeProject.name
                });
                setImportStatusMessage(`Imported ${parsed.sections.length} sections and ${parsed.clips.length} shots from "${file.name}"`);
                setTimeout(() => setImportStatusMessage(''), 5000);
            } else if (onCreateBlankProject) {
                const newProj = await onCreateBlankProject(parsed.title);
                if (newProj) {
                    const updated_duration = parsed.clips.length > 0 
                        ? parsed.clips[parsed.clips.length - 1].endTime 
                        : 0;
                    onUpdateProject(newProj.id, {
                        sections: parsed.sections,
                        clips: parsed.clips,
                        duration: updated_duration
                    });
                }
            }
        } catch (err: unknown) {
            console.error('Failed to parse Fountain script:', err);
            window.alert('Failed to parse Fountain screenplay: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            if (event.target) event.target.value = '';
        }
    };

    const handleExportManifest = async () => {
        if (!activeProject) return;
        const manifest = generateMusicVideoManifest(activeProject, storyboard_cards);
        
        const ipcRenderer = getElectronIpc();
        if (ipcRenderer) {
            try {
                const saveResult = await ipcRenderer.invoke<{ success: boolean; path?: string; error?: string }>('save-manifest', manifest);
                if (saveResult && saveResult.success) {
                    setImportStatusMessage(`Manifest exported with ${manifest.clips.length} stable-ID shots to ${saveResult.path}`);
                    setTimeout(() => setImportStatusMessage(''), 5000);
                    return;
                }
            } catch (err) {
                console.error("IPC save-manifest failed, falling back to download:", err);
            }
        }

        // Web download fallback
        const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${activeProject.name || 'project'}_manifest.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setImportStatusMessage(`Manifest downloaded with ${manifest.clips.length} stable-ID shots`);
        setTimeout(() => setImportStatusMessage(''), 5000);
    };

    const raw_storyboard_cards = (activeProject?.clips || []) as VideoClip[];

    // WHAT: Synthesizes initial storyboard cards from detected musical sections if no explicit clips exist yet.
    // WHY: Guarantees that users immediately see interactive storyboard cards in both Outline and Flat Grid views
    // matching the verses, choruses, and bridges detected from their music audio.
    const synthesized_section_cards: VideoClip[] = React.useMemo(() => {
        if (!activeProject?.sections || activeProject.sections.length === 0) return [];
        const project_fps = activeProject.frameRate || 20;
        return activeProject.sections.map((section, index) => {
            const raw_duration = Math.max(0.1, section.endTime - section.startTime);
            const aligned_duration = getAlignedDuration(raw_duration, project_fps);
            return {
                id: `clip-section-${section.id || index}`,
                startTime: section.startTime,
                endTime: section.startTime + aligned_duration,
                duration: aligned_duration,
                track: 1,
                status: 'pending' as const,
                source: 'main' as const,
                label: section.name || `Shot ${index + 1}`,
                sceneNumber: `${index + 1}`,
                shotLetter: 'A',
                sectionId: section.id,
                sectionName: section.name,
                sectionType: section.type,
                notes: {
                    action: `${section.name} (${section.type.toUpperCase()})`,
                    dialogue: '',
                    sound: ''
                },
                paceWpm: PacingBenchmarks.CONVERSATIONAL
            };
        });
    }, [activeProject?.sections, activeProject?.frameRate]);

    const effective_raw_clips = raw_storyboard_cards.length > 0
        ? raw_storyboard_cards
        : synthesized_section_cards;

    // Auto-persist initial section cards to project storage so user edits, divisions, and image assignments persist
    React.useEffect(() => {
        if (
            activeProject &&
            activeProject.sections &&
            activeProject.sections.length > 0 &&
            (!activeProject.clips || activeProject.clips.length === 0) &&
            synthesized_section_cards.length > 0
        ) {
            onUpdateProject(activeProject.id, { clips: synthesized_section_cards });
        }
    }, [activeProject?.id, activeProject?.sections, activeProject?.clips, synthesized_section_cards, onUpdateProject]);

    // WHAT: Adds a new shot card directly within a specific musical section outline.
    // WHY: Lets creators add coverage, B-roll, or close-ups directly into Verse 1 or Chorus without manual time arithmetic.
    const handleAddShotToSection = (section: MusicSection) => {
        if (!activeProject) return;
        const timeline_frame_rate = activeProject.frameRate || 20;
        const section_duration = Math.max(0.1, section.endTime - section.startTime);
        const default_duration = Math.min(4.0, section_duration);
        const aligned_duration = getAlignedDuration(default_duration, timeline_frame_rate);
        
        const existing_section_clips = storyboard_cards.filter(c => 
            c.sectionId === section.id || 
            c.sectionName === section.name ||
            (!c.sectionId && !c.sectionName && c.startTime >= section.startTime && c.startTime < section.endTime)
        );
        const last_clip = existing_section_clips[existing_section_clips.length - 1];
        const start_time = last_clip ? last_clip.endTime : section.startTime;
        const next_index = existing_section_clips.length + 1;
        const next_letter = String.fromCharCode(65 + ((next_index - 1) % 26));

        const new_card: VideoClip = {
            id: `card-${Date.now()}`,
            startTime: start_time,
            duration: aligned_duration,
            endTime: start_time + aligned_duration,
            track: 1,
            status: 'pending',
            source: 'main',
            label: `${section.name} Shot ${next_index}`,
            sceneNumber: section.name,
            shotLetter: next_letter,
            sectionId: section.id,
            sectionName: section.name,
            sectionType: section.type,
            notes: { action: `${section.name} action`, dialogue: '', sound: '' },
            paceWpm: PacingBenchmarks.CONVERSATIONAL
        };

        const updated_cards = [...storyboard_cards, new_card].sort((a, b) => a.startTime - b.startTime);
        onUpdateProject(activeProject.id, { clips: updated_cards });
    };

    const handlePopulateShotsFromSections = () => {
        if (!activeProject || !activeProject.sections || activeProject.sections.length === 0) return;
        onUpdateProject(activeProject.id, { clips: synthesized_section_cards });
        setImportStatusMessage(`Populated ${synthesized_section_cards.length} storyboard cards from song sections`);
        setTimeout(() => setImportStatusMessage(''), 4000);
    };

    // WHAT: Evaluates revision states (new, changed, unchanged) for all storyboard cards dynamically.
    // WHY: Enables visual status badges, selective GPU batch rendering, and DaVinci Resolve marker sync.
    const revisionMap = React.useMemo(() => {
        return evaluateProjectRevisions(effective_raw_clips);
    }, [effective_raw_clips]);

    const storyboard_cards = React.useMemo(() => {
        return effective_raw_clips.map(clip => {
            const rev = revisionMap.get(clip.id);
            return rev ? { ...clip, revisionState: rev.state } : clip;
        });
    }, [effective_raw_clips, revisionMap]);

    const generationPlan = React.useMemo(() => {
        return filterClipsForGeneration(storyboard_cards, revisionMap);
    }, [storyboard_cards, revisionMap]);

    const [isPushingMarkers, setIsPushingMarkers] = useState<boolean>(false);

    // WHAT: Pushes revision markers (Cyan = new, Yellow = changed, Green = unchanged) to DaVinci Resolve.
    const handlePushRevisionMarkers = async () => {
        if (!activeProject || storyboard_cards.length === 0) return;
        setIsPushingMarkers(true);
        try {
            const markers = buildResolveRevisionMarkers(storyboard_cards, revisionMap, activeProject.frameRate || 24);
            const client = new ResolveBridgeClient();
            const result = await client.pushRevisionMarkers(markers);
            if (result.success) {
                const newCount = markers.filter(m => m.color === 'Cyan').length;
                const changedCount = markers.filter(m => m.color === 'Yellow').length;
                const cleanCount = markers.filter(m => m.color === 'Green').length;
                setImportStatusMessage(`Synced ${result.pushed_count} markers to Resolve timeline "${result.timeline_name}" (🔵 ${newCount} new, 🟡 ${changedCount} changed, 🟢 ${cleanCount} clean)`);
            } else {
                setImportStatusMessage(`Resolve marker sync error: ${result.error || 'Bridge offline'}`);
            }
        } catch (err: unknown) {
            setImportStatusMessage(`Resolve marker push failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsPushingMarkers(false);
            setTimeout(() => setImportStatusMessage(''), 6000);
        }
    };

    // WHAT: Queues only changed and new shots for ComfyUI video generation, skipping unchanged shots.
    const handleQueueChangedShots = async () => {
        if (!onGenerateVideo || storyboard_cards.length === 0) return;
        const { clipsToGenerate, skippedClips } = generationPlan;
        if (clipsToGenerate.length === 0) {
            setImportStatusMessage(`All ${storyboard_cards.length} shots are clean & up to date! Nothing to render.`);
            setTimeout(() => setImportStatusMessage(''), 5000);
            return;
        }

        setImportStatusMessage(`Queuing ${clipsToGenerate.length} shots (skipping ${skippedClips.length} unchanged shots)...`);
        for (const clip of clipsToGenerate) {
            await onGenerateVideo(clip.id);
        }
        setImportStatusMessage(`Queued ${clipsToGenerate.length} shots for generation (saved GPU time by skipping ${skippedClips.length} unchanged shots)`);
        setTimeout(() => setImportStatusMessage(''), 6000);
    };

    // WHAT: Auto-heals legacy project schemas by relocating misplaced AI descriptions.
    // WHY: Early project versions placed image descriptions into `notes.action`. This migration ensures
    // descriptions live in `actionDescription` without disturbing custom director dialogue or sound notes.
    React.useEffect(() => {
        if (!activeProject || !activeProject.clips) return;
        
        let needs_auto_heal = false;
        const healed_clips_list = (activeProject.clips as VideoClip[]).map(candidate_clip => {
            const has_legacy_action_text = candidate_clip.notes?.action && candidate_clip.notes.action.length > 50;
            const has_empty_description = !candidate_clip.actionDescription;

            if (has_empty_description && has_legacy_action_text && candidate_clip.notes) {
                needs_auto_heal = true;
                return {
                    ...candidate_clip,
                    actionDescription: candidate_clip.notes.action,
                    notes: { ...candidate_clip.notes, action: '' }
                };
            }
            return candidate_clip;
        });

        if (needs_auto_heal) {
            console.log(`🎨 [Storyboard] Auto-healing ${activeProject.name}: Migrating legacy descriptions...`);
            onUpdateProject(activeProject.id, { clips: healed_clips_list });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Only runs once per project load when ID changes
    }, [activeProject?.id]);

    // WHAT: Inserts a new blank shot card to fill an empty time gap on the timeline.
    // WHY: Enables editors to click on empty intervals between shots to scaffold a new scene beat.
    const handleFillPadding = (start_time_seconds: number, target_duration_seconds: number) => {
        if (!activeProject) return;
        const timeline_frame_rate = activeProject.frameRate || 20;
        const aligned_duration_seconds = getAlignedDuration(target_duration_seconds, timeline_frame_rate);
        const next_shot_index = storyboard_cards.length + 1;

        const newly_created_card: VideoClip = {
            id: `card-${Date.now()}`,
            startTime: start_time_seconds,
            duration: aligned_duration_seconds,
            endTime: start_time_seconds + aligned_duration_seconds,
            track: 1,
            status: 'pending',
            source: 'main',
            label: `Shot ${next_shot_index}`,
            sceneNumber: '1',
            shotLetter: 'A',
            notes: { action: '', dialogue: '', sound: '' },
            paceWpm: PacingBenchmarks.CONVERSATIONAL
        };

        const updated_cards_list = [...storyboard_cards, newly_created_card];
        updated_cards_list.sort((first_clip, second_clip) => first_clip.startTime - second_clip.startTime);
        onUpdateProject(activeProject.id, { clips: updated_cards_list });
    };

    // WHAT: Appends a new blank shot card directly to the active storyboard timeline.
    // WHY: Enables creators to quickly expand their storyboard scene without needing to find a padding card.
    const handleAppendShot = () => {
        if (!activeProject) return;
        const timeline_frame_rate = activeProject.frameRate || 20;
        const default_shot_duration_seconds = 4.0;
        const aligned_duration_seconds = getAlignedDuration(default_shot_duration_seconds, timeline_frame_rate);

        const sorted_existing_clips = [...storyboard_cards].sort((first_clip, second_clip) => first_clip.startTime - second_clip.startTime);
        const last_clip_entry = sorted_existing_clips[sorted_existing_clips.length - 1];
        const next_shot_start_time = last_clip_entry ? last_clip_entry.endTime : 0;
        const next_shot_index = storyboard_cards.length + 1;

        const newly_created_card: VideoClip = {
            id: `card-${Date.now()}`,
            startTime: next_shot_start_time,
            duration: aligned_duration_seconds,
            endTime: next_shot_start_time + aligned_duration_seconds,
            track: 1,
            status: 'pending',
            source: 'main',
            label: `Shot ${next_shot_index}`,
            sceneNumber: '1',
            shotLetter: 'A',
            notes: { action: '', dialogue: '', sound: '' },
            paceWpm: PacingBenchmarks.CONVERSATIONAL
        };

        const updated_cards_list = [...storyboard_cards, newly_created_card];
        updated_cards_list.sort((first_clip, second_clip) => first_clip.startTime - second_clip.startTime);

        const new_total_project_duration = Math.max(activeProject.duration || 0, newly_created_card.endTime);
        onUpdateProject(activeProject.id, {
            clips: updated_cards_list,
            duration: new_total_project_duration
        });
    };

    // WHAT: Creates a new blank project directly from the Storyboard view.
    // WHY: Provides a seamless 1-click storyboard instantiation experience without forcing a navigation switch.
    const handleCreateStoryboardAction = async () => {
        if (!onCreateBlankProject) return;
        setIsCreatingStoryboardState(true);
        try {
            const desired_project_name = newStoryboardTitleInput.trim() || undefined;
            await onCreateBlankProject(desired_project_name);
            setNewStoryboardTitleInput('');
        } finally {
            setIsCreatingStoryboardState(false);
        }
    };

    // WHAT: Updates card properties and ripples timing forward through subsequent shots.
    // WHY: Video cuts in film editing are contiguous. If shot 1 expands by 2 seconds, shots 2, 3, etc.
    // must shift their start and end boundaries forward automatically to prevent overlapping media.
    const handleUpdateCard = (clip_identifier_to_update: string, property_updates: Partial<VideoClip>) => {
        if (!activeProject) return;
        
        const updated_clips_list = [...storyboard_cards];
        const target_clip_index = updated_clips_list.findIndex(candidate_clip => candidate_clip.id === clip_identifier_to_update);
        if (target_clip_index === -1) return;

        const current_clip_snapshot = updated_clips_list[target_clip_index];
        let finalized_updated_clip: VideoClip;

        // Custom handling for nested notes to prevent clobbering dialogue or sound cues
        if ('notes' in property_updates && property_updates.notes) {
            finalized_updated_clip = {
                ...current_clip_snapshot,
                notes: {
                    ...(current_clip_snapshot.notes || { action: '', dialogue: '', sound: '' }),
                    ...property_updates.notes
                }
            };
        } else {
            finalized_updated_clip = { ...current_clip_snapshot, ...property_updates };
        }

        // Data migration guard: Prevent duplicated narrative prompt and image description
        if (property_updates.actionDescription && finalized_updated_clip.notes?.action === property_updates.actionDescription) {
            finalized_updated_clip = {
                ...finalized_updated_clip,
                notes: { ...(finalized_updated_clip.notes || { action: '', dialogue: '', sound: '' }), action: '' }
            };
        }
        
        // Dynamic speaking duration calculation based on dialogue word count and words-per-minute (WPM)
        const has_dialogue_changed = property_updates.notes && 'dialogue' in property_updates.notes && property_updates.notes.dialogue !== current_clip_snapshot.notes?.dialogue;
        const has_pace_changed = property_updates.paceWpm !== undefined && property_updates.paceWpm !== current_clip_snapshot.paceWpm;

        if (has_dialogue_changed || has_pace_changed) {
            const dialogue_text = finalized_updated_clip.notes?.dialogue || '';
            const dialogue_words = dialogue_text.trim().split(/\s+/).filter((word_string: string) => word_string.length > 0);
            const total_word_count = dialogue_words.length;
            
            if (total_word_count > 0 || (total_word_count === 0 && current_clip_snapshot.notes?.dialogue)) {
                const calculated_raw_duration = Math.max(1.5, (total_word_count / (finalized_updated_clip.paceWpm || PacingBenchmarks.CONVERSATIONAL)) * 60);
                const timeline_frame_rate = activeProject.frameRate || 20;
                finalized_updated_clip.duration = getAlignedDuration(calculated_raw_duration, timeline_frame_rate);
            }
        }
        finalized_updated_clip.endTime = finalized_updated_clip.startTime + finalized_updated_clip.duration;
        updated_clips_list[target_clip_index] = finalized_updated_clip;

        // Ripple forward through contiguous downstream clips
        for (let ripple_index = target_clip_index + 1; ripple_index < updated_clips_list.length; ripple_index++) {
            const preceding_clip = updated_clips_list[ripple_index - 1];
            updated_clips_list[ripple_index] = {
                ...updated_clips_list[ripple_index],
                startTime: preceding_clip.endTime,
                endTime: preceding_clip.endTime + updated_clips_list[ripple_index].duration
            };
        }
        
        onUpdateProject(activeProject.id, { clips: updated_clips_list });
    };

    // WHAT: Removes a shot card from the timeline and closes the temporal gap.
    // WHY: Deleting a shot pulls subsequent shots backward so the edit maintains contiguous playback.
    const handleDeleteCard = (clip_identifier_to_delete: string) => {
        if (!activeProject) return;
        let remaining_clips_list = storyboard_cards.filter(candidate_clip => candidate_clip.id !== clip_identifier_to_delete);
        
        // Ripple effect: Recalculate start and end times to eliminate the empty slot
        let current_playback_time = 0;
        remaining_clips_list = remaining_clips_list.map(candidate_clip => {
            const compacted_clip = {
                ...candidate_clip,
                startTime: current_playback_time,
                endTime: current_playback_time + candidate_clip.duration
            };
            current_playback_time = compacted_clip.endTime;
            return compacted_clip;
        });

        onUpdateProject(activeProject.id, { clips: remaining_clips_list });
        setSelectedCardId(previous_selected_id => previous_selected_id === clip_identifier_to_delete ? null : previous_selected_id);
    };

    // WHAT: Opens the custom context menu popup on right-click over a storyboard card.
    // WHY: Gives quick access to dividing cards, duplicating shots, or toggling boneyard takes.
    const handleCardContextMenu = (event: React.MouseEvent, card: VideoClip) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({
            card,
            position: { x: event.clientX, y: event.clientY }
        });
    };

    // WHAT: Divides a card into N sections (or snapped to musical beats if cut points provided) and replaces the original card in place.
    // WHY: Allows directors to split a single overarching scene into smaller shots or cut points without disturbing subsequent clips.
    const handleDivideCard = (cardToDivide: VideoClip, sectionsCount: number, customCutPoints?: number[]) => {
        if (!activeProject || sectionsCount < 2) return;
        const timeline_frame_rate = activeProject.frameRate || 20;
        const total_duration = cardToDivide.duration || (cardToDivide.endTime - cardToDivide.startTime);

        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const base_label = cardToDivide.label || 'Shot';
        const parent_notes = cardToDivide.notes || { action: '', dialogue: '', sound: '' };
        const new_clips: VideoClip[] = [];

        if (customCutPoints && customCutPoints.length === sectionsCount - 1) {
            const sorted_cuts = [...customCutPoints].sort((a, b) => a - b);
            const cut_points = [cardToDivide.startTime, ...sorted_cuts, cardToDivide.endTime];

            for (let i = 0; i < cut_points.length - 1; i++) {
                const start_t = cut_points[i];
                const end_t = cut_points[i + 1];
                const part_duration = Math.max(0.01, end_t - start_t);

                const sub_letter = i < alphabet.length ? alphabet[i] : String(i + 1);
                let sub_label = `${base_label} (${i + 1}/${sectionsCount})`;
                const digit_match = base_label.match(/^(.*?\d+)\s*$/);
                if (digit_match) {
                    sub_label = `${digit_match[1]}${sub_letter}`;
                }

                const new_clip: VideoClip = {
                    id: `card-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                    startTime: start_t,
                    duration: part_duration,
                    endTime: end_t,
                    track: cardToDivide.track || 1,
                    status: 'pending',
                    source: cardToDivide.source || 'main',
                    label: sub_label,
                    sceneNumber: cardToDivide.sceneNumber || '1',
                    shotLetter: sub_letter,
                    sectionId: cardToDivide.sectionId,
                    sectionName: cardToDivide.sectionName,
                    sectionType: cardToDivide.sectionType,
                    paceWpm: cardToDivide.paceWpm || PacingBenchmarks.CONVERSATIONAL,
                    startImagePath: i === 0 ? cardToDivide.startImagePath : undefined,
                    startImageFunction: i === 0 ? cardToDivide.startImageFunction : undefined,
                    endImagePath: i === sectionsCount - 1 ? cardToDivide.endImagePath : undefined,
                    endImageFunction: i === sectionsCount - 1 ? cardToDivide.endImageFunction : undefined,
                    actionDescription: i === 0 ? cardToDivide.actionDescription : '',
                    notes: i === 0 ? { ...parent_notes } : { action: '', dialogue: '', sound: parent_notes.sound || '' }
                };

                new_clips.push(new_clip);
            }
        } else {
            const total_frames = Math.round(total_duration * timeline_frame_rate);
            if (total_frames < sectionsCount) {
                setImportStatusMessage(`Cannot divide: Shot duration (${total_duration.toFixed(2)}s) is too short for ${sectionsCount} sections.`);
                setTimeout(() => setImportStatusMessage(''), 4000);
                return;
            }

            const base_frames = Math.floor(total_frames / sectionsCount);
            const remainder_frames = total_frames % sectionsCount;
            let current_start_time = cardToDivide.startTime;

            for (let i = 0; i < sectionsCount; i++) {
                const part_frames = base_frames + (i < remainder_frames ? 1 : 0);
                const part_duration = part_frames / timeline_frame_rate;
                const part_end_time = current_start_time + part_duration;

                const sub_letter = i < alphabet.length ? alphabet[i] : String(i + 1);
                let sub_label = `${base_label} (${i + 1}/${sectionsCount})`;
                const digit_match = base_label.match(/^(.*?\d+)\s*$/);
                if (digit_match) {
                    sub_label = `${digit_match[1]}${sub_letter}`;
                }

                const new_clip: VideoClip = {
                    id: `card-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                    startTime: current_start_time,
                    duration: part_duration,
                    endTime: part_end_time,
                    track: cardToDivide.track || 1,
                    status: 'pending',
                    source: cardToDivide.source || 'main',
                    label: sub_label,
                    sceneNumber: cardToDivide.sceneNumber || '1',
                    shotLetter: sub_letter,
                    sectionId: cardToDivide.sectionId,
                    sectionName: cardToDivide.sectionName,
                    sectionType: cardToDivide.sectionType,
                    paceWpm: cardToDivide.paceWpm || PacingBenchmarks.CONVERSATIONAL,
                    startImagePath: i === 0 ? cardToDivide.startImagePath : undefined,
                    startImageFunction: i === 0 ? cardToDivide.startImageFunction : undefined,
                    endImagePath: i === sectionsCount - 1 ? cardToDivide.endImagePath : undefined,
                    endImageFunction: i === sectionsCount - 1 ? cardToDivide.endImageFunction : undefined,
                    actionDescription: i === 0 ? cardToDivide.actionDescription : '',
                    notes: i === 0 ? { ...parent_notes } : { action: '', dialogue: '', sound: parent_notes.sound || '' }
                };

                new_clips.push(new_clip);
                current_start_time = part_end_time;
            }
        }

        const current_clips_list = [...storyboard_cards];
        const target_clip_index = current_clips_list.findIndex(c => c.id === cardToDivide.id);
        if (target_clip_index === -1) return;

        current_clips_list.splice(target_clip_index, 1, ...new_clips);
        onUpdateProject(activeProject.id, { clips: current_clips_list });
        const beatSnapNotice = customCutPoints && customCutPoints.length > 0 ? ' snapped to musical beats' : '';
        setImportStatusMessage(`Divided "${cardToDivide.label}" into ${sectionsCount} sections${beatSnapNotice} (~${(total_duration / sectionsCount).toFixed(2)}s each)`);
        setTimeout(() => setImportStatusMessage(''), 4000);
        setContextMenu(null);
    };

    // WHAT: Divides a card at musical beat timestamps occurring within its boundaries.
    const handleDivideCardAtBeats = (cardToDivide: VideoClip, beatTimestamps: number[]) => {
        if (!activeProject || beatTimestamps.length === 0) return;
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const base_label = cardToDivide.label || 'Shot';
        const parent_notes = cardToDivide.notes || { action: '', dialogue: '', sound: '' };

        const sorted_beats = [...beatTimestamps].sort((a, b) => a - b);
        const cut_points = [cardToDivide.startTime, ...sorted_beats, cardToDivide.endTime];
        const new_clips: VideoClip[] = [];

        for (let i = 0; i < cut_points.length - 1; i++) {
            const start_t = cut_points[i];
            const end_t = cut_points[i + 1];
            const part_dur = Math.max(0.01, end_t - start_t);
            const sub_letter = i < alphabet.length ? alphabet[i] : String(i + 1);

            let sub_label = `${base_label} (${i + 1}/${cut_points.length - 1})`;
            const digit_match = base_label.match(/^(.*?\d+)\s*$/);
            if (digit_match) {
                sub_label = `${digit_match[1]}${sub_letter}`;
            }

            const new_clip: VideoClip = {
                id: `card-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                startTime: start_t,
                duration: part_dur,
                endTime: end_t,
                track: cardToDivide.track || 1,
                status: 'pending',
                source: cardToDivide.source || 'main',
                label: sub_label,
                sceneNumber: cardToDivide.sceneNumber || '1',
                shotLetter: sub_letter,
                sectionId: cardToDivide.sectionId,
                sectionName: cardToDivide.sectionName,
                sectionType: cardToDivide.sectionType,
                paceWpm: cardToDivide.paceWpm || PacingBenchmarks.CONVERSATIONAL,
                startImagePath: i === 0 ? cardToDivide.startImagePath : undefined,
                startImageFunction: i === 0 ? cardToDivide.startImageFunction : undefined,
                endImagePath: i === cut_points.length - 2 ? cardToDivide.endImagePath : undefined,
                endImageFunction: i === cut_points.length - 2 ? cardToDivide.endImageFunction : undefined,
                actionDescription: i === 0 ? cardToDivide.actionDescription : '',
                notes: i === 0 ? { ...parent_notes } : { action: '', dialogue: '', sound: parent_notes.sound || '' }
            };
            new_clips.push(new_clip);
        }

        const current_clips_list = [...storyboard_cards];
        const target_clip_index = current_clips_list.findIndex(c => c.id === cardToDivide.id);
        if (target_clip_index === -1) return;

        current_clips_list.splice(target_clip_index, 1, ...new_clips);
        onUpdateProject(activeProject.id, { clips: current_clips_list });
        setImportStatusMessage(`Divided "${cardToDivide.label}" at ${beatTimestamps.length} musical beats (${new_clips.length} shots)`);
        setTimeout(() => setImportStatusMessage(''), 4000);
        setContextMenu(null);
    };

    // WHAT: Duplicates a card immediately downstream and ripples subsequent shots forward.
    const handleDuplicateCard = (cardToDuplicate: VideoClip) => {
        if (!activeProject) return;
        const current_clips = [...storyboard_cards];
        const target_index = current_clips.findIndex(c => c.id === cardToDuplicate.id);
        if (target_index === -1) return;

        const duplicated_clip: VideoClip = {
            ...cardToDuplicate,
            id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label: `${cardToDuplicate.label || 'Shot'} (Copy)`,
            startTime: cardToDuplicate.endTime,
            endTime: cardToDuplicate.endTime + cardToDuplicate.duration,
            status: 'pending'
        };

        current_clips.splice(target_index + 1, 0, duplicated_clip);

        for (let i = target_index + 2; i < current_clips.length; i++) {
            const prev = current_clips[i - 1];
            current_clips[i] = {
                ...current_clips[i],
                startTime: prev.endTime,
                endTime: prev.endTime + current_clips[i].duration
            };
        }

        onUpdateProject(activeProject.id, { clips: current_clips });
        setImportStatusMessage(`Duplicated "${cardToDuplicate.label}"`);
        setTimeout(() => setImportStatusMessage(''), 3000);
        setContextMenu(null);
    };

    // WHAT: Toggles alternate boneyard take (mute state) on a card.
    const handleToggleMuteCard = (cardToToggle: VideoClip) => {
        handleUpdateCard(cardToToggle.id, { isMuted: !cardToToggle.isMuted });
        setContextMenu(null);
    };

    // WHAT: Discovers musical beat timestamps that fall inside a specific card's time window.
    const getCardBeatTimestamps = (card: VideoClip): number[] => {
        if (!activeProject) return [];
        const timestamps: number[] = [];
        if (activeProject.markers) {
            activeProject.markers.forEach(m => {
                if (m.type === 'beat' || !m.type) timestamps.push(m.timestamp);
            });
        }
        if (activeProject.stems) {
            activeProject.stems.forEach(stem => {
                if (stem.beats) timestamps.push(...stem.beats);
            });
        }
        const unique = Array.from(new Set(timestamps)).sort((a, b) => a - b);
        return unique.filter(t => t > card.startTime + 0.15 && t < card.endTime - 0.15);
    };

    // WHAT: Discovers rendered video takes on disk and matches them with their parent storyboard shots.
    // WHY: Allows ComfyUI or MiniMax rendering outputs saved in `videos/` to automatically appear as selectable takes.
    const handleSyncGeneratedVideos = async () => {
        if (!activeProject?.outputDir) return;

        const electron_window = window as unknown as ElectronWindowExtended;
        const node_fs_module: NodeFsModule | null = electron_window.require ? (electron_window.require('fs') as NodeFsModule) : null;
        const node_path_module: NodePathModule | null = electron_window.require ? (electron_window.require('path') as NodePathModule) : null;
        if (!node_fs_module || !node_path_module) return;

        const project_videos_directory = node_path_module.join(activeProject.outputDir, 'videos');
        if (!node_fs_module.existsSync(project_videos_directory)) return;

        try {
            const discovered_video_files: string[] = node_fs_module
                .readdirSync(project_videos_directory)
                .filter((video_filename: string) => video_filename.endsWith('.mp4'));
            let updated_clips_count = 0;

            const synchronized_clips_list = storyboard_cards.map(candidate_clip => {
                const sanitized_clip_label = candidate_clip.label.replace(/[^a-z0-9]/gi, '_');
                
                // Identify videos currently in directory matching this shot's name
                const matching_video_files = discovered_video_files.filter((video_filename: string) => {
                    const take_regex_pattern = new RegExp(`^${sanitized_clip_label}_take(\\d+)\\.mp4$`, 'i');
                    return take_regex_pattern.test(video_filename);
                }).map((video_filename: string) => {
                    const take_number_parsed = parseInt(video_filename.match(/_take(\d+)\.mp4$/i)?.[1] || "0", 10);
                    return {
                        fullPath: node_path_module.join(project_videos_directory, video_filename),
                        take: take_number_parsed
                    };
                }).sort((first_take, second_take) => second_take.take - first_take.take);

                const found_video_paths = matching_video_files.map(take_item => take_item.fullPath);
                
                // Cross-reference with existing video list to filter deleted files
                const existing_videos_list = candidate_clip.generatedVideos || [];
                const still_existing_videos = existing_videos_list.filter((video_file_path: string) => node_fs_module.existsSync(video_file_path));
                
                const deduplicated_videos = Array.from(new Set([...still_existing_videos, ...found_video_paths]));
                
                let current_selected_video_path = candidate_clip.videoPath;
                const active_file_exists_on_disk = current_selected_video_path ? node_fs_module.existsSync(current_selected_video_path) : false;

                const has_video_set_changed = deduplicated_videos.length !== existing_videos_list.length;
                const is_active_video_missing = current_selected_video_path && !active_file_exists_on_disk;
                const is_status_update_needed = deduplicated_videos.length > 0 && candidate_clip.status !== 'done';

                if (has_video_set_changed || is_active_video_missing || is_status_update_needed) {
                    updated_clips_count++;
                    
                    if (is_active_video_missing || !current_selected_video_path) {
                        current_selected_video_path = matching_video_files.length > 0 
                            ? matching_video_files[0].fullPath 
                            : (deduplicated_videos.length > 0 ? deduplicated_videos[0] : undefined);
                    }

                    return {
                        ...candidate_clip,
                        status: deduplicated_videos.length > 0 ? 'done' as const : (candidate_clip.status === 'done' ? 'pending' : candidate_clip.status),
                        videoPath: current_selected_video_path,
                        generatedVideos: deduplicated_videos
                    };
                }
                return candidate_clip;
            });

            if (updated_clips_count > 0) {
                onUpdateProject(activeProject.id, { clips: synchronized_clips_list });
            }
        } catch (error_instance) {
            console.error("Sync error:", error_instance);
        }
    };

    // WHAT: Computes an interleaved array of video shot cards and empty timeline intervals.
    // WHY: Gives visual pacing to the director, showing where clips align against the musical beat duration.
    const project_total_duration_seconds = activeProject?.duration || 0;
    const sorted_clips_chronological = [...storyboard_cards].sort((first_clip, second_clip) => first_clip.startTime - second_clip.startTime);
    
    const interleaved_timeline_items: StoryboardTimelineItem[] = [];
    
    if (activeProject && project_total_duration_seconds > 0) {
        let current_traversed_time = 0;
        
        for (const candidate_clip of sorted_clips_chronological) {
            // Check for unassigned gap before this clip
            if (candidate_clip.startTime > current_traversed_time + 0.01) {
                interleaved_timeline_items.push({
                    type: 'unselected',
                    startTime: current_traversed_time,
                    endTime: candidate_clip.startTime,
                    duration: candidate_clip.startTime - current_traversed_time,
                    label: 'Gap'
                });
            }
            // Add the clip itself
            interleaved_timeline_items.push({
                type: 'clip',
                startTime: candidate_clip.startTime,
                endTime: candidate_clip.endTime,
                duration: candidate_clip.duration,
                clip: candidate_clip,
                label: candidate_clip.label
            });
            current_traversed_time = Math.max(current_traversed_time, candidate_clip.endTime);
        }
        
        // Final gap at end
        if (current_traversed_time < project_total_duration_seconds - 0.01) {
            interleaved_timeline_items.push({
                type: 'unselected',
                startTime: current_traversed_time,
                endTime: project_total_duration_seconds,
                duration: project_total_duration_seconds - current_traversed_time,
                label: 'Gap'
            });
        }
    } else {
        // Fallback when project has no audio duration
        sorted_clips_chronological.forEach(candidate_clip => {
            interleaved_timeline_items.push({
                type: 'clip',
                startTime: candidate_clip.startTime,
                endTime: candidate_clip.endTime,
                duration: candidate_clip.duration,
                clip: candidate_clip,
                label: candidate_clip.label
            });
        });
    }

    if (!activeProject) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center bg-[#0a0a0f] text-white">
                <div className="max-w-md w-full bg-[#11111b] border border-gray-800/80 rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-3xl">
                        🎨
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Start Storyboarding</h2>
                        <p className="text-xs text-gray-400 mt-1">
                            Create a new storyboard project or open an existing project to plan your video shots.
                        </p>
                    </div>

                    {onCreateBlankProject && (
                        <div className="w-full flex flex-col gap-3">
                            <input
                                autoFocus
                                type="text"
                                value={newStoryboardTitleInput}
                                onChange={(change_event) => setNewStoryboardTitleInput(change_event.target.value)}
                                onKeyDown={(keyboard_event) => {
                                    if (keyboard_event.key === 'Enter') {
                                        handleCreateStoryboardAction();
                                    }
                                }}
                                placeholder="Storyboard Name (e.g. Cyberpunk Chase)..."
                                className="w-full bg-[#181825] border border-gray-700/60 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                            />
                            <button
                                onClick={handleCreateStoryboardAction}
                                disabled={isCreatingStoryboardState}
                                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                            >
                                <span>➕</span>
                                {isCreatingStoryboardState ? 'Creating Storyboard...' : 'Create New Storyboard'}
                            </button>

                            <div className="relative flex py-1 items-center">
                                <div className="flex-grow border-t border-gray-800"></div>
                                <span className="flex-shrink mx-2 text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Or</span>
                                <div className="flex-grow border-t border-gray-800"></div>
                            </div>
                            <button
                                onClick={handleImportFountainClick}
                                className="w-full py-2.5 px-4 bg-[#181825] hover:bg-indigo-950/40 text-indigo-300 hover:text-white border border-indigo-700/50 hover:border-indigo-500 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2"
                            >
                                <span>📜</span> Import Fountain Screenplay (.fountain)
                            </button>
                        </div>
                    )}

                    {projects && projects.length > 0 && onSelectProject && (
                        <div className="w-full border-t border-gray-800/80 pt-5 flex flex-col gap-2">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider text-left">
                                Or Open Existing Project ({projects.length})
                            </span>
                            <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 text-left">
                                {projects.map((project_entry) => (
                                    <button
                                        key={project_entry.id}
                                        onClick={() => onSelectProject(project_entry.id)}
                                        className="w-full text-left px-3 py-2 bg-[#181825] hover:bg-indigo-900/20 hover:border-indigo-500/40 border border-transparent rounded-lg text-xs text-gray-300 hover:text-white transition-all flex items-center justify-between group"
                                    >
                                        <span className="font-medium truncate">{project_entry.name}</span>
                                        <span className="text-[10px] text-gray-500 group-hover:text-indigo-400 font-mono">
                                            {project_entry.clips?.length || 0} shots
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0a0a0f] text-white">
            {/* Toolbar */}
            <div className="p-6 border-b border-gray-800/50 flex justify-between items-center bg-[#0d0d15]">
                <div className="flex items-center gap-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                             <svg className="w-6 h-6 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                 <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                                 <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                                 <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                                 <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                                 <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
                             </svg>
                             <span>Story Board</span>
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Project:</span>
                            {projects && projects.length > 1 && onSelectProject ? (
                                <select
                                    value={activeProject.id}
                                    onChange={(change_event) => onSelectProject(change_event.target.value)}
                                    className="bg-[#181825] border border-gray-700/60 rounded px-2 py-0.5 text-xs text-indigo-200 font-semibold focus:outline-none focus:border-indigo-500 transition-colors"
                                >
                                    {projects.map((project_choice) => (
                                        <option key={project_choice.id} value={project_choice.id} className="bg-[#11111b] text-white">
                                            {project_choice.name} ({project_choice.clips?.length || 0} shots)
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-[11px] text-indigo-300 font-semibold">{activeProject.name}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* View Mode Toggle: Outline vs Flat Grid */}
                    <div className="flex items-center bg-[#181825] border border-gray-800 rounded-lg p-0.5 text-xs">
                        <button
                            onClick={() => setViewMode('outline')}
                            className={`px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1.5 ${viewMode === 'outline' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            title="Group cards by musical section outline"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="8" y1="6" x2="21" y2="6" />
                                <line x1="8" y1="12" x2="21" y2="12" />
                                <line x1="8" y1="18" x2="21" y2="18" />
                                <circle cx="4" cy="6" r="1" fill="currentColor" />
                                <circle cx="4" cy="12" r="1" fill="currentColor" />
                                <circle cx="4" cy="18" r="1" fill="currentColor" />
                            </svg>
                            <span>Outline</span>
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1.5 ${viewMode === 'grid' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            title="Flat storyboard grid view"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" rx="1" />
                                <rect x="14" y="3" width="7" height="7" rx="1" />
                                <rect x="14" y="14" width="7" height="7" rx="1" />
                                <rect x="3" y="14" width="7" height="7" rx="1" />
                            </svg>
                            <span>Grid</span>
                        </button>
                    </div>

                    {/* Hidden Fountain File Input */}
                    <input 
                        ref={fountainFileInputRef}
                        type="file"
                        accept=".fountain,.txt"
                        className="hidden"
                        onChange={handleFountainFileChange}
                    />

                    {/* Populate from Sections Button */}
                    {activeProject?.sections && activeProject.sections.length > 0 && raw_storyboard_cards.length === 0 && (
                        <button 
                            onClick={handlePopulateShotsFromSections}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 hover:border-emerald-500 rounded-lg transition-all text-xs font-semibold"
                            title={`Create storyboard cards for each of the ${activeProject.sections.length} detected song sections`}
                        >
                            <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                            </svg>
                            <span>Populate from Sections ({activeProject.sections.length})</span>
                        </button>
                    )}

                    {/* Import Fountain Screenplay Button */}
                    <button 
                        onClick={handleImportFountainClick}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 hover:border-indigo-500 rounded-lg transition-all text-xs font-semibold"
                        title="Import scenes, sections, and synopses from a Fountain screenplay file"
                    >
                        <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        <span>Import Fountain</span>
                    </button>

                    {/* Export Manifest Button */}
                    <button 
                        onClick={handleExportManifest}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#181825] hover:bg-gray-800 text-indigo-300 border border-gray-700/60 hover:border-indigo-500/50 rounded-lg transition-all text-xs font-semibold"
                        title="Export music_video_manifest.json with stable clip IDs for DaVinci Resolve timeline assembly"
                    >
                        <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Export Manifest</span>
                    </button>

                    {/* Push Revision Markers to DaVinci Resolve */}
                    <button 
                        onClick={handlePushRevisionMarkers}
                        disabled={isPushingMarkers || storyboard_cards.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#181825] hover:bg-gray-800 disabled:opacity-50 text-indigo-300 border border-gray-700/60 hover:border-indigo-500/50 rounded-lg transition-all text-xs font-semibold"
                        title="Push colored revision markers (Cyan: new, Yellow: changed, Green: clean) to DaVinci Resolve active timeline"
                    >
                        <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span>{isPushingMarkers ? 'Pushing...' : 'Push Markers'}</span>
                    </button>

                    {/* Queue Changed & New Shots for Generation */}
                    {onGenerateVideo && (
                        <button 
                            onClick={handleQueueChangedShots}
                            disabled={generationPlan.clipsToGenerate.length === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/60 hover:bg-amber-900/80 disabled:opacity-40 text-amber-300 border border-amber-700/50 hover:border-amber-500 rounded-lg transition-all text-xs font-semibold"
                            title={`Queue only ${generationPlan.clipsToGenerate.length} changed or new shots for ComfyUI generation (skipping ${generationPlan.skippedClips.length} clean shots)`}
                        >
                            <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                            </svg>
                            <span>Queue Changed ({generationPlan.clipsToGenerate.length})</span>
                        </button>
                    )}

                    {/* Add Shot Button */}
                    <button 
                        onClick={handleAppendShot}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-md shadow-indigo-600/20 transition-all text-xs font-semibold"
                        title="Append a new blank shot card to the end of this storyboard"
                    >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>Add Shot</span>
                    </button>

                    {/* Quick New Storyboard Button */}
                    {onCreateBlankProject && (
                        <button
                            onClick={async () => {
                                const requested_storyboard_title = window.prompt('Enter name for new storyboard:');
                                if (requested_storyboard_title !== null) {
                                    await onCreateBlankProject(requested_storyboard_title.trim() || undefined);
                                }
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700/60 transition-all text-xs font-medium"
                            title="Create another new storyboard"
                        >
                            <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            <span>New Storyboard</span>
                        </button>
                    )}

                    <button 
                        onClick={handleSyncGeneratedVideos}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30 transition-all text-[10px] font-bold uppercase tracking-widest"
                    >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        <span>Sync Videos</span>
                    </button>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 rounded-lg border border-gray-800/50">
                        <div className={`w-2 h-2 rounded-full ${comfyConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                            {comfyConnected ? 'Comfy Connected' : 'Comfy Offline'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Import Status Message */}
            {importStatusMessage && (
                <div className="bg-indigo-950/90 border-b border-indigo-500/40 px-6 py-2 text-xs text-indigo-200 flex items-center justify-between">
                    <span>✨ {importStatusMessage}</span>
                    <button onClick={() => setImportStatusMessage('')} className="text-gray-400 hover:text-white font-bold ml-4">✕</button>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-8">
                {viewMode === 'outline' && activeProject?.sections && activeProject.sections.length > 0 ? (
                    <div className="space-y-8">
                        {activeProject.sections.map((section) => {
                            const section_clips = sorted_clips_chronological.filter(clip => 
                                clip.sectionId === section.id || 
                                clip.sectionName === section.name ||
                                (!clip.sectionId && !clip.sectionName && clip.startTime >= section.startTime && clip.startTime < section.endTime)
                            );
                            const section_color = section.color || SECTION_TYPE_COLOR_MAP[section.type]?.border || '#6366f1';
                            const badge_style = SECTION_TYPE_COLOR_MAP[section.type] || SECTION_TYPE_COLOR_MAP.verse;

                            // WHAT: Calculate the musical section duration and total frame count based on project FPS.
                            // WHY: Displays exact block duration to help video editors pace and plan scene shot counts.
                            const section_duration_seconds = Math.max(0, section.endTime - section.startTime);
                            const section_frame_count = Math.round(section_duration_seconds * (activeProject?.frameRate || 20));

                            return (
                                <div key={section.id} className="bg-[#0e0e15] border border-gray-800/80 rounded-2xl p-5 shadow-lg">
                                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-gray-800/60">
                                        <div className="flex items-center gap-3">
                                            <span className="w-3.5 h-3.5 rounded-full shadow" style={{ backgroundColor: section_color }} />
                                            <h3 className="text-lg font-bold text-white tracking-wide">{section.name}</h3>
                                            <span 
                                                className="text-[10px] font-bold uppercase px-2.5 py-0.5 rounded border tracking-wider"
                                                style={{
                                                    backgroundColor: badge_style.background,
                                                    borderColor: badge_style.border,
                                                    color: badge_style.text
                                                }}
                                            >
                                                {section.type}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
                                            <span>⏱️ {section.startTime.toFixed(2)}s – {section.endTime.toFixed(2)}s</span>
                                            <span 
                                                className="bg-[#181825] border border-indigo-500/30 px-2.5 py-1 rounded text-[11px] text-indigo-300 font-semibold flex items-center gap-1.5 shadow-sm"
                                                title={`Block length: ${section_duration_seconds.toFixed(2)}s (${section_frame_count} frames @ ${activeProject?.frameRate || 20}fps)`}
                                            >
                                                <span className="text-gray-400 font-normal">Length:</span>
                                                <span>{section_duration_seconds.toFixed(2)}s</span>
                                                <span className="text-[10px] text-indigo-400/70 font-normal">({section_frame_count}f)</span>
                                            </span>
                                            <span className="bg-[#181825] border border-gray-700/60 px-2.5 py-1 rounded text-[11px] text-gray-200 font-semibold">
                                                {section_clips.length} {section_clips.length === 1 ? 'shot' : 'shots'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleAddShotToSection(section)}
                                                className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 rounded text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                                                title={`Add a new shot card inside ${section.name}`}
                                            >
                                                <span>➕</span> Add Shot
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {section_clips.length === 0 ? (
                                        <div className="py-6 text-center text-xs text-gray-500 italic bg-[#08080c] rounded-xl border border-dashed border-gray-800/60 flex flex-col items-center justify-center gap-2">
                                            <span>No shots in this section yet.</span>
                                            <button
                                                type="button"
                                                onClick={() => handleAddShotToSection(section)}
                                                className="px-3 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow"
                                            >
                                                <span>➕</span> Add First Shot to {section.name}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-3 w-full">
                                            {section_clips.map((clip) => {
                                                const current_item_index = sorted_clips_chronological.findIndex(c => c.id === clip.id);
                                                const previous_clip = sorted_clips_chronological[current_item_index - 1];
                                                const following_clip = sorted_clips_chronological[current_item_index + 1];
                                                return (
                                                    <div key={clip.id} className="w-full">
                                                        <StoryboardCardComponent 
                                                            card={clip}
                                                            frameRate={activeProject?.frameRate || 20}
                                                            onUpdate={handleUpdateCard}
                                                            onDelete={handleDeleteCard}
                                                            onGenerateVideo={onGenerateVideo}
                                                            onPickImage={onPickImage}
                                                            onCopyImageFromNext={onCopyImageFromNext}
                                                            onCopyEndFrameFromPrev={onCopyEndFrameFromPrev}
                                                            onGetImageDescription={onGetImageDescription}
                                                            onRewordPrompt={onRewordPrompt}
                                                            llmProvider={llmProvider}
                                                            nextClipStartImage={following_clip?.startImagePath}
                                                            prevClipEndImage={previous_clip?.endImagePath}
                                                            comfyConnected={comfyConnected}
                                                            onContextMenu={handleCardContextMenu}
                                                        />
                                                    </div>
                                                );
                                            })}

                                            {/* Quick-add trailing button for this section in outline view */}
                                            <button
                                                type="button"
                                                onClick={() => handleAddShotToSection(section)}
                                                className="w-full py-2.5 border border-dashed border-gray-800 hover:border-indigo-500/50 rounded-xl bg-gray-900/20 hover:bg-indigo-950/20 text-gray-500 hover:text-indigo-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                                                title={`Append another shot to ${section.name}`}
                                            >
                                                <span>➕</span> Add Shot to {section.name}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Unassigned Shots if any exist */}
                        {(() => {
                            const unassigned_clips = sorted_clips_chronological.filter(clip => {
                                return !activeProject.sections?.some(sec => 
                                    clip.sectionId === sec.id || 
                                    clip.sectionName === sec.name ||
                                    (!clip.sectionId && !clip.sectionName && clip.startTime >= sec.startTime && clip.startTime < sec.endTime)
                                );
                            });
                            if (unassigned_clips.length === 0) return null;
                            return (
                                <div className="bg-[#0e0e15] border border-gray-800/80 rounded-2xl p-5 shadow-lg">
                                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-gray-800/60">
                                        <div className="flex items-center gap-3">
                                            <span className="w-3.5 h-3.5 rounded-full bg-gray-500" />
                                            <h3 className="text-lg font-bold text-gray-300 tracking-wide">Additional / Unassigned Shots</h3>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
                                            {(() => {
                                                // WHAT: Calculate the cumulative duration and frame count for all unassigned video clips.
                                                // WHY: Informs the director how much auxiliary or B-roll footage exists outside structured beat blocks.
                                                const total_unassigned_duration_seconds = unassigned_clips.reduce(
                                                    (accumulated_duration_seconds, current_clip_candidate) => 
                                                        accumulated_duration_seconds + (current_clip_candidate.duration || (current_clip_candidate.endTime - current_clip_candidate.startTime) || 0),
                                                    0
                                                );
                                                const total_unassigned_frame_count = Math.round(total_unassigned_duration_seconds * (activeProject?.frameRate || 20));

                                                return total_unassigned_duration_seconds > 0 ? (
                                                    <span 
                                                        className="bg-[#181825] border border-gray-700/60 px-2.5 py-1 rounded text-[11px] text-indigo-300 font-semibold flex items-center gap-1.5 shadow-sm"
                                                        title={`Total unassigned length: ${total_unassigned_duration_seconds.toFixed(2)}s (${total_unassigned_frame_count} frames @ ${activeProject?.frameRate || 20}fps)`}
                                                    >
                                                        <span className="text-gray-400 font-normal">Length:</span>
                                                        <span>{total_unassigned_duration_seconds.toFixed(2)}s</span>
                                                        <span className="text-[10px] text-indigo-400/70 font-normal">({total_unassigned_frame_count}f)</span>
                                                    </span>
                                                ) : null;
                                            })()}
                                            <span className="bg-[#181825] border border-gray-700/60 px-2.5 py-1 rounded text-[11px] text-gray-200 font-semibold font-mono">
                                                {unassigned_clips.length} {unassigned_clips.length === 1 ? 'shot' : 'shots'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-3 w-full">
                                        {unassigned_clips.map((clip) => {
                                            const current_item_index = sorted_clips_chronological.findIndex(c => c.id === clip.id);
                                            const previous_clip = sorted_clips_chronological[current_item_index - 1];
                                            const following_clip = sorted_clips_chronological[current_item_index + 1];
                                            return (
                                                <div key={clip.id} className="w-full">
                                                    <StoryboardCardComponent 
                                                        card={clip}
                                                        frameRate={activeProject?.frameRate || 20}
                                                        onUpdate={handleUpdateCard}
                                                        onDelete={handleDeleteCard}
                                                        onGenerateVideo={onGenerateVideo}
                                                        onPickImage={onPickImage}
                                                        onCopyImageFromNext={onCopyImageFromNext}
                                                        onCopyEndFrameFromPrev={onCopyEndFrameFromPrev}
                                                        onGetImageDescription={onGetImageDescription}
                                                        onRewordPrompt={onRewordPrompt}
                                                        llmProvider={llmProvider}
                                                        nextClipStartImage={following_clip?.startImagePath}
                                                        prevClipEndImage={previous_clip?.endImagePath}
                                                        comfyConnected={comfyConnected}
                                                        onContextMenu={handleCardContextMenu}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {sorted_clips_chronological.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-16 text-center bg-[#0e0e15] border border-dashed border-gray-800/80 rounded-2xl">
                                <span className="text-4xl mb-3">🎬</span>
                                <h3 className="text-lg font-bold text-white mb-1">No Storyboard Shots Yet</h3>
                                <p className="text-xs text-gray-400 max-w-sm mb-5">
                                    {activeProject?.sections && activeProject.sections.length > 0
                                        ? "Your project has musical sections defined, but no shot cards have been created yet. Switch to Outline view to see the section blocks, or add shots below."
                                        : "Start planning your scene by adding shot cards or importing a Fountain screenplay."
                                    }
                                </p>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleAppendShot}
                                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg flex items-center gap-2 cursor-pointer"
                                    >
                                        <span>➕</span> Add First Shot
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleImportFountainClick}
                                        className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs transition-all border border-gray-700 flex items-center gap-2 cursor-pointer"
                                    >
                                        <span>📜</span> Import Fountain
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                                {sorted_clips_chronological.map((clip, clip_index) => {
                                    const previous_clip = sorted_clips_chronological[clip_index - 1];
                                    const following_clip = sorted_clips_chronological[clip_index + 1];
                                    return (
                                        <div key={clip.id} className="h-full">
                                            <StoryboardCardComponent 
                                                card={clip}
                                                frameRate={activeProject?.frameRate || 20}
                                                onUpdate={handleUpdateCard}
                                                onDelete={handleDeleteCard}
                                                onGenerateVideo={onGenerateVideo}
                                                onPickImage={onPickImage}
                                                onCopyImageFromNext={onCopyImageFromNext}
                                                onCopyEndFrameFromPrev={onCopyEndFrameFromPrev}
                                                onGetImageDescription={onGetImageDescription}
                                                onRewordPrompt={onRewordPrompt}
                                                llmProvider={llmProvider}
                                                nextClipStartImage={following_clip?.startImagePath}
                                                prevClipEndImage={previous_clip?.endImagePath}
                                                comfyConnected={comfyConnected}
                                                onContextMenu={handleCardContextMenu}
                                            />
                                        </div>
                                    );
                                })}

                                {/* Quick-Add Next Shot Card at end of grid */}
                                <div 
                                    onClick={handleAppendShot}
                                    className="group aspect-[4/5] border-2 border-dashed border-gray-800 hover:border-indigo-500/50 rounded-xl bg-gray-900/10 hover:bg-indigo-950/10 flex flex-col items-center justify-center p-6 transition-all cursor-pointer min-h-[320px]"
                                    title="Append a new shot to the end of the storyboard"
                                >
                                    <div className="w-12 h-12 rounded-full border border-gray-800 group-hover:border-indigo-500 group-hover:bg-indigo-600/20 flex items-center justify-center text-gray-600 group-hover:text-indigo-300 transition-all shadow-lg mb-2 group-hover:scale-110">
                                        <span className="text-xl">➕</span>
                                    </div>
                                    <p className="text-xs font-bold text-gray-500 group-hover:text-indigo-400 uppercase tracking-wider transition-colors">
                                        Add Shot {sorted_clips_chronological.length + 1}
                                    </p>
                                    <span className="text-[10px] text-gray-600 mt-1">Append to end</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Persistent Animatic Timeline */}
            <div className="h-56 border-t border-gray-800/40 px-4 py-2 bg-[#050508]/80 shrink-0">
                <AnimaticTimeline 
                    items={interleaved_timeline_items} 
                    sections={activeProject.sections}
                    onSelectCard={setSelectedCardId}
                    onCardContextMenu={handleCardContextMenu}
                    compact={true}
                    onAddPadding={handleFillPadding}
                />
            </div>

            {/* Storyboard Card Context Menu (Right-Click Popup) */}
            {contextMenu && (
                <StoryboardContextMenu
                    key={`${contextMenu.card.id}-${contextMenu.position.x}-${contextMenu.position.y}`}
                    card={contextMenu.card}
                    position={contextMenu.position}
                    onClose={() => setContextMenu(null)}
                    onDivide={handleDivideCard}
                    onDivideAtBeats={handleDivideCardAtBeats}
                    onDuplicate={handleDuplicateCard}
                    onDelete={handleDeleteCard}
                    onToggleMute={handleToggleMuteCard}
                    beatTimestamps={getCardBeatTimestamps(contextMenu.card)}
                    frameRate={activeProject?.frameRate || 20}
                />
            )}

        </div>
    );
};

export default StoryboardModule;

