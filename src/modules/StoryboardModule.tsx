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
import type { BeatProject } from '../hooks/useProjectStorage';

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

interface ElectronWindowExtended {
    require?: (module_name: string) => unknown;
}

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

    const storyboard_cards = (activeProject?.clips || []) as VideoClip[];

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
                             <span className="text-indigo-500">🎨</span> Story Board
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
                    {/* Add Shot Button */}
                    <button 
                        onClick={handleAppendShot}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-md shadow-indigo-600/20 transition-all text-xs font-semibold"
                        title="Append a new blank shot card to the end of this storyboard"
                    >
                        <span>➕</span> Add Shot
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
                            <span>📋</span> New Storyboard
                        </button>
                    )}

                    <button 
                        onClick={handleSyncGeneratedVideos}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30 transition-all text-[10px] font-bold uppercase tracking-widest"
                    >
                        <span>🔄</span> Sync Videos
                    </button>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 rounded-lg border border-gray-800/50">
                        <div className={`w-2 h-2 rounded-full ${comfyConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                            {comfyConnected ? 'Comfy Connected' : 'Comfy Offline'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {interleaved_timeline_items.map((timeline_item, item_index) => {
                        if (timeline_item.type === 'clip') {
                            const current_item_index = sorted_clips_chronological.findIndex(candidate => candidate.id === timeline_item.clip.id);
                            const previous_clip = sorted_clips_chronological[current_item_index - 1];
                            const following_clip = sorted_clips_chronological[current_item_index + 1];
                            return (
                                <div key={timeline_item.clip.id} className="h-full">
                                    <StoryboardCardComponent 
                                        card={timeline_item.clip}
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
                                    />
                                </div>
                            );
                        } else {
                            return (
                                <StoryboardPaddingCard 
                                    key={`padding-${item_index}-${timeline_item.startTime}`}
                                    startTime={timeline_item.startTime}
                                    duration={timeline_item.duration}
                                    onAdd={handleFillPadding}
                                />
                            );
                        }
                    })}
                </div>
            </div>

            {/* Persistent Animatic Timeline */}
            <div className="h-44 border-t border-gray-800/30 px-4 py-2 bg-[#050508]/50">
                <AnimaticTimeline 
                    items={interleaved_timeline_items} 
                    onSelectCard={setSelectedCardId}
                    compact={true}
                    onAddPadding={handleFillPadding}
                />
            </div>

        </div>
    );
};

export default StoryboardModule;

