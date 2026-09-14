/**
 * StoryboardCardComponent
 * 
 * A rich, interactive card representing a single shot in the storyboard.
 * It handles image picking, AI description generation, video previews, and timing.
 */

import React from 'react';
import { AppTooltip } from '../ui/Tooltip';
import { AppPopover } from '../ui/Popover';
import type { VideoClip, ImageFunction } from '../../types/assembler';
import { formatTime, pathToMediaUrl, getAlignedDuration } from '../../utils/timelineUtils';
import PromptEditorModal from '../PromptEditorModal';
import { getTextHeight } from '../../utils/pretextUtils';
import { getImageFunctionConfiguration } from '../../services/qwenPromptService';

// WHAT: Callback props for an individual Storyboard shot card.
// WHY: Gives the card full control over modifying its own properties, triggering AI generation,
// copying frames from neighboring cards, and updating duration while maintaining unidirectional data flow.
interface CardProps {
    card: VideoClip;
    onUpdate: (clip_identifier: string, property_updates: Partial<VideoClip>) => void;
    onDelete: (clip_identifier: string) => void;
    onGenerateVideo?: (clip_identifier: string) => Promise<void>;
    onPickImage?: (clip_identifier: string, image_field_name: 'startImagePath' | 'endImagePath') => void;
    onCopyImageFromNext?: (clip_identifier: string, image_field_name: 'startImagePath' | 'endImagePath') => void;
    onCopyEndFrameFromPrev?: (clip_identifier: string, align_to_exact_beat?: boolean) => void;
    onGetImageDescription?: (clip_identifier: string, image_slot?: 'startImagePath' | 'endImagePath') => Promise<void>;
    onRewordPrompt?: (clip_identifier: string) => Promise<void>;
    nextClipStartImage?: string;
    prevClipEndImage?: string;
    llmProvider?: 'llama-server' | 'vino';
    comfyConnected?: boolean;
    frameRate?: number;
}

const StoryboardCardComponent: React.FC<CardProps> = ({ 
    card, 
    onUpdate, 
    onDelete, 
    onGenerateVideo,
    onPickImage,
    onCopyImageFromNext,
    onCopyEndFrameFromPrev,
    onGetImageDescription,
    onRewordPrompt,
    nextClipStartImage,
    prevClipEndImage,
    llmProvider,
    comfyConnected,
    frameRate = 20
}) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isStartPopoverOpen, setIsStartPopoverOpen] = React.useState(false);
    const [isEndPopoverOpen, setIsEndPopoverOpen] = React.useState(false);
    const [isStartRolePopoverOpen, setIsStartRolePopoverOpen] = React.useState(false);
    const [isEndRolePopoverOpen, setIsEndRolePopoverOpen] = React.useState(false);
    const [activeDescriptionTab, setActiveDescriptionTab] = React.useState<'start' | 'end'>('start');
    const [isEditorOpen, setIsEditorOpen] = React.useState(false);
    const [editorConfig, setEditorConfig] = React.useState<{
        title: string;
        initialValue: string;
        onSave: (updated_text_value: string) => void;
    }>({ title: '', initialValue: '', onSave: () => {} });

    // Functional roles & display styling configurations
    const startFunction = card.startImageFunction || 'start_frame';
    const endFunction = card.endImageFunction || 'end_frame';
    const startConfig = getImageFunctionConfiguration(startFunction);
    const endConfig = getImageFunctionConfiguration(endFunction);

    // Pretext strict height measurement
    const cardRef = React.useRef<HTMLDivElement>(null);
    
    // WHAT: Fixed width assumption used by the Pretext measurement engine.
    // WHY: Calculates exact vertical height for multiline text areas to prevent Cumulative Layout Shift (CLS)
    // while cards re-render or during rapid keyboard typing.
    const assumedWidth = 260;

    // WHAT: Keyboard shortcut listener for discrete duration nudges.
    // WHY: Enables film editors to tap ArrowUp / ArrowDown while hovering a card to nudge its cut point by 16-frame steps.
    React.useEffect(() => {
        if (!isHovered) return;

        const handleKeyDown = (keyboard_event: KeyboardEvent) => {
            // Don't intercept if an input is focused (handled natively)
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            if (keyboard_event.key === 'ArrowUp') {
                keyboard_event.preventDefault();
                const current_clip_duration_seconds = card.duration || 0;
                const next_clip_duration_seconds = getAlignedDuration(current_clip_duration_seconds + (17 / frameRate) + 0.01, frameRate);
                onUpdate(card.id, { duration: next_clip_duration_seconds, endTime: card.startTime + next_clip_duration_seconds });
            } else if (keyboard_event.key === 'ArrowDown') {
                keyboard_event.preventDefault();
                const current_clip_duration_seconds = card.duration || 0;
                // Subtract 0.01 to ensure we drop into the previous bracket for the round/ceil logic
                const next_clip_duration_seconds = getAlignedDuration(Math.max(0.1, current_clip_duration_seconds - (17 / frameRate) - 0.01), frameRate);
                onUpdate(card.id, { duration: next_clip_duration_seconds, endTime: card.startTime + next_clip_duration_seconds });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isHovered, card.duration, card.startTime, card.id, frameRate, onUpdate]);

    // Unified Notes Helpers
    const actionPromptValue = card.notes?.action || '';
    const dialogueValue = card.notes?.dialogue || '';
    const soundValue = card.notes?.sound || '';

    // WHAT: Dropdown popover menu allowing the user to configure the semantic role of an image slot.
    // WHY: In modern MiniMax H3 / Qwen-VL workflows, images can serve as start/end frames, character references,
    // scene backgrounds, or shot styles. Assigning the correct role guides the multimodal prompts accordingly.
    const renderRoleSelector = (slot: 'start' | 'end') => {
        const isStart = slot === 'start';
        const currentFunction = isStart ? startFunction : endFunction;
        const fieldKey = isStart ? 'startImageFunction' : 'endImageFunction';
        const allRoles: ImageFunction[] = [
            'start_frame',
            'end_frame',
            'character_reference',
            'scene_reference',
            'shot_style',
            'storyboard_action',
        ];

        return (
            <div className="flex flex-col bg-[#11111e] border border-indigo-500/30 rounded-lg shadow-2xl p-1 min-w-[210px] backdrop-blur-xl">
                <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-gray-400 border-b border-gray-800/80">
                    Assign Role (Image {isStart ? '1' : '2'})
                </div>
                {allRoles.map((roleKey) => {
                    const configuration_item = getImageFunctionConfiguration(roleKey);
                    const isSelected = currentFunction === roleKey;
                    return (
                        <button
                            key={roleKey}
                            type="button"
                            onClick={(click_event) => {
                                click_event.stopPropagation();
                                if (isStart) setIsStartRolePopoverOpen(false);
                                else setIsEndRolePopoverOpen(false);
                                onUpdate(card.id, { [fieldKey]: roleKey });
                            }}
                            className={`flex items-center justify-between px-3 py-2 rounded text-[10px] font-bold transition-all text-left ${
                                isSelected 
                                    ? `${configuration_item.backgroundClass} ${configuration_item.textClass} border ${configuration_item.borderClass}` 
                                    : 'text-gray-300 hover:bg-indigo-600/20 hover:text-white'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <span>{configuration_item.iconEmoji}</span>
                                <span>{configuration_item.displayName}</span>
                            </span>
                            {isSelected && <span className="text-[11px]">✓</span>}
                        </button>
                    );
                })}
            </div>
        );
    };

    // WHAT: Popover menu for choosing an image from disk, running Qwen-VL analysis, or matching prev/next frames.
    // WHY: Data-driven menu definition makes adding, removing, or reordering actions trivial — each menu item
    // is a plain object with icon, label, action callback, disabled flag, and optional preview thumbnail.
    const renderImageOptions = (image_field_name: 'startImagePath' | 'endImagePath') => {
        const isStart = image_field_name === 'startImagePath';
        const activeConfig = isStart ? startConfig : endConfig;
        const targetImagePath = isStart ? card.startImagePath : card.endImagePath;
        const isCurrentlyDescribing = card.isDescribing && (card.isDescribingSlot === image_field_name || (!card.isDescribingSlot && isStart));

        const closePopover = () => {
            if (isStart) setIsStartPopoverOpen(false); else setIsEndPopoverOpen(false);
        };

        // WHAT: Declarative menu action definitions for image slot context menus.
        // WHY: Each action is a flat object — the rendering loop below handles all styling uniformly,
        // so changes to menu appearance or behavior only need one edit site instead of five.
        interface ImageMenuAction {
            icon: string;
            label: string;
            action: () => void;
            disabled?: boolean;
            preview?: string;
            variant?: 'danger';
            visible?: boolean;
        }

        const menu_actions: ImageMenuAction[] = [
            {
                icon: '📂',
                label: 'Load Image',
                action: () => { closePopover(); onPickImage?.(card.id, image_field_name); },
            },
            {
                icon: '🔍',
                label: isCurrentlyDescribing ? 'Describing...' : `Describe (${activeConfig.displayName})`,
                action: () => { closePopover(); onGetImageDescription?.(card.id, image_field_name); },
                disabled: !targetImagePath || !comfyConnected || isCurrentlyDescribing,
            },
            {
                icon: '⏮️',
                label: 'Prev Video End Frame',
                action: () => { closePopover(); onCopyEndFrameFromPrev?.(card.id, false); },
                preview: prevClipEndImage,
                visible: isStart,
            },
            {
                icon: '⏱️',
                label: 'Prev Beat Frame',
                action: () => { closePopover(); onCopyEndFrameFromPrev?.(card.id, true); },
                visible: isStart,
            },
            {
                icon: '⏭️',
                label: 'Next Clip Start',
                action: () => { closePopover(); onCopyImageFromNext?.(card.id, image_field_name); },
                preview: nextClipStartImage,
                visible: !isStart,
            },
            {
                icon: '🗑️',
                label: 'Remove Image',
                action: () => { closePopover(); onUpdate(card.id, { [image_field_name]: undefined }); },
                variant: 'danger',
            },
        ];

        const visible_actions = menu_actions.filter(menu_item => menu_item.visible !== false);

        return (
            <div className="flex flex-col bg-[#11111e] border border-indigo-500/30 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden min-w-[230px] backdrop-blur-xl">
                {visible_actions.map((menu_item, action_index) => (
                    <button
                        key={action_index}
                        onClick={menu_item.action}
                        disabled={menu_item.disabled}
                        className={`flex items-center justify-between gap-3 px-4 py-3 transition-all text-left uppercase tracking-widest group/item ${
                            action_index < visible_actions.length - 1 ? 'border-b border-indigo-500/10' : ''
                        } ${
                            menu_item.disabled
                                ? 'text-gray-600 cursor-not-allowed opacity-50'
                                : menu_item.variant === 'danger'
                                    ? 'hover:bg-red-600/20 text-[10px] font-black text-gray-300 hover:text-red-400'
                                    : 'hover:bg-indigo-600/20 text-[10px] font-black text-gray-300 hover:text-white'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-sm">{menu_item.icon}</span> {menu_item.label}
                        </div>
                        {menu_item.preview !== undefined && (
                            menu_item.preview ? (
                                <img 
                                    src={pathToMediaUrl(menu_item.preview)} 
                                    alt="Preview" 
                                    className="w-10 h-6 object-cover rounded border border-indigo-500/30 group-hover/item:border-indigo-400 transition-all" 
                                />
                            ) : (
                                <span className="text-[8px] text-gray-500 italic lowercase tracking-normal">
                                    {isStart ? 'no video' : 'no image'}
                                </span>
                            )
                        )}
                    </button>
                ))}
            </div>
        );
    };

    return (
        <div 
            ref={cardRef}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`bg-[#1a1a2e] border rounded-xl shadow-2xl transition-all group flex flex-col h-full ${isHovered ? 'border-indigo-400 ring-1 ring-indigo-500/20 scale-[1.01]' : 'border-gray-700/50 hover:border-gray-600'}`}
            style={{ padding: '5px', overflow: 'hidden' }}
        >
            {/* Header: Scene/Shot Info */}
            <div className="px-4 py-3 bg-black/40 border-b border-gray-700/30 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none">Shot</span>
                    <input 
                        className="bg-transparent border-none text-[11px] font-bold text-indigo-400 uppercase tracking-widest w-32 focus:ring-0 p-0" 
                        value={card.label || ''} 
                        onChange={(input_event) => onUpdate(card.id, { label: input_event.target.value })}
                        placeholder="UNNAMED SHOT"
                    />
                </div>
                <AppTooltip content="Remove this shot from the timeline." placement="top" offset={[0, 48]}>
                    <span>
                        <button 
                            onClick={() => onDelete(card.id)}
                            className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            ✕
                        </button>
                    </span>
                </AppTooltip>
            </div>

            {/* Visual Previews & Video Selector */}
            <div className="space-y-2 p-4 bg-black/20">
                <div className="flex gap-2 aspect-[32/9]">
                    {/* Start Image / Ref Image 1 */}
                    <div className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img">
                        <AppPopover 
                            content={renderImageOptions('startImagePath')} 
                            placement="bottom"
                            open={isStartPopoverOpen}
                            onOpenChange={setIsStartPopoverOpen}
                        >
                            <div className="w-full h-full cursor-pointer flex items-center justify-center hover:ring-2 hover:ring-indigo-500 transition-all">
                                {card.startImagePath ? (
                                    <img src={pathToMediaUrl(card.startImagePath)} alt={startConfig.displayName} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center opacity-30">
                                        <span className="text-xl">{startConfig.iconEmoji}</span>
                                        <span className="text-[8px] font-black uppercase tracking-tight">{startConfig.displayName}</span>
                                    </div>
                                )}
                            </div>
                        </AppPopover>

                        {/* Interactive Role Selector Pill */}
                        <div className="absolute top-1 left-1 z-10">
                            <AppPopover
                                content={renderRoleSelector('start')}
                                placement="bottom"
                                open={isStartRolePopoverOpen}
                                onOpenChange={setIsStartRolePopoverOpen}
                            >
                                <button
                                    type="button"
                                    onClick={(click_event) => {
                                        click_event.stopPropagation();
                                        setIsStartRolePopoverOpen(previous_state => !previous_state);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight backdrop-blur-md shadow flex items-center gap-1 border hover:scale-105 transition-all ${startConfig.borderClass} ${startConfig.backgroundClass} ${startConfig.textClass}`}
                                    title={`Role: ${startConfig.displayName}. Click to change.`}
                                >
                                    <span>{startConfig.iconEmoji}</span>
                                    <span>{startConfig.displayName}</span>
                                    <span className="text-[6px] opacity-60">▼</span>
                                </button>
                            </AppPopover>
                        </div>
                    </div>

                    {/* End Image / Ref Image 2 */}
                    <div className="flex-1 relative aspect-video bg-black/40 rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center group/img">
                        <AppPopover 
                            content={renderImageOptions('endImagePath')} 
                            placement="bottom"
                            open={isEndPopoverOpen}
                            onOpenChange={setIsEndPopoverOpen}
                        >
                            <div className="w-full h-full cursor-pointer flex items-center justify-center hover:ring-2 hover:ring-indigo-500 transition-all">
                                {card.endImagePath ? (
                                    <img src={pathToMediaUrl(card.endImagePath)} alt={endConfig.displayName} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center opacity-30">
                                        <span className="text-xl">{endConfig.iconEmoji}</span>
                                        <span className="text-[8px] font-black uppercase tracking-tight">{endConfig.displayName}</span>
                                    </div>
                                )}
                            </div>
                        </AppPopover>

                        {/* Interactive Role Selector Pill */}
                        <div className="absolute top-1 left-1 z-10">
                            <AppPopover
                                content={renderRoleSelector('end')}
                                placement="bottom"
                                open={isEndRolePopoverOpen}
                                onOpenChange={setIsEndRolePopoverOpen}
                            >
                                <button
                                    type="button"
                                    onClick={(click_event) => {
                                        click_event.stopPropagation();
                                        setIsEndRolePopoverOpen(previous_state => !previous_state);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight backdrop-blur-md shadow flex items-center gap-1 border hover:scale-105 transition-all ${endConfig.borderClass} ${endConfig.backgroundClass} ${endConfig.textClass}`}
                                    title={`Role: ${endConfig.displayName}. Click to change.`}
                                >
                                    <span>{endConfig.iconEmoji}</span>
                                    <span>{endConfig.displayName}</span>
                                    <span className="text-[6px] opacity-60">▼</span>
                                </button>
                            </AppPopover>
                        </div>
                    </div>
                </div>

                {/* Video Preview & Selector Dropdown */}
                {((card.generatedVideos && card.generatedVideos.length > 0) || card.videoPath) && (
                    <div className="mt-3 space-y-2">
                        {/* Video Preview Area */}
                        {card.videoPath && (
                            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-indigo-500/20 shadow-inner group/video">
                                <video 
                                    src={pathToMediaUrl(card.videoPath)} 
                                    className="w-full h-full object-cover"
                                    controls={false}
                                    loop
                                    onMouseOver={(mouse_event) => mouse_event.currentTarget.play()}
                                    onMouseOut={(mouse_event) => {
                                        mouse_event.currentTarget.pause();
                                        mouse_event.currentTarget.currentTime = 0;
                                    }}
                                />
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-indigo-600/80 rounded text-[7px] font-black text-white uppercase tracking-tighter shadow-lg pointer-events-none opacity-0 group-hover/video:opacity-100 transition-opacity">
                                    Preview
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 px-1">
                            <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Clip Version</span>
                            <select 
                                className="flex-1 bg-black/40 border border-gray-700/50 rounded-md text-[10px] text-indigo-300 py-1 px-2 focus:ring-1 focus:ring-indigo-500/30"
                                value={card.videoPath || ''}
                                onChange={(change_event) => onUpdate(card.id, { videoPath: change_event.target.value })}
                            >
                                {card.videoPath && !card.generatedVideos?.includes(card.videoPath) && (
                                    <option value={card.videoPath}>Active: {card.videoPath.split(/[\\/]/).pop()}</option>
                                )}
                                {card.generatedVideos?.map((video_file_path, video_index) => (
                                    <option key={video_index} value={video_file_path}>
                                        Version {video_index + 1}: {video_file_path.split(/[\\/]/).pop()}
                                    </option>
                                ))}
                                {(!card.videoPath && (!card.generatedVideos || card.generatedVideos.length === 0)) && (
                                    <option value="">No videos generated</option>
                                )}
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Areas */}
            <div className="p-5 space-y-5 flex-1">
                {/* Image Description Box (Function-Aware) */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        {/* Tab Switcher / Role Badges */}
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setActiveDescriptionTab('start')}
                                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 border ${
                                    activeDescriptionTab === 'start'
                                        ? `${startConfig.backgroundClass} ${startConfig.textClass} ${startConfig.borderClass}`
                                        : 'bg-black/20 text-gray-500 border-transparent hover:text-gray-300'
                                }`}
                            >
                                <span>{startConfig.iconEmoji}</span>
                                <span>Img 1: {startConfig.displayName}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveDescriptionTab('end')}
                                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 border ${
                                    activeDescriptionTab === 'end'
                                        ? `${endConfig.backgroundClass} ${endConfig.textClass} ${endConfig.borderClass}`
                                        : 'bg-black/20 text-gray-500 border-transparent hover:text-gray-300'
                                }`}
                            >
                                <span>{endConfig.iconEmoji}</span>
                                <span>Img 2: {endConfig.displayName}</span>
                                {card.endImageDescription && <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>}
                            </button>
                        </div>

                        {/* Describe Action Button */}
                        <div className="flex gap-1">
                            {(() => {
                                const is_vision_service_available = (llmProvider === 'llama-server') || !!comfyConnected;
                                const vision_engine_display_name = llmProvider === 'llama-server' ? 'llama-server (Qwen 3.5 9B)' : 'ComfyUI Qwen-VL';

                                if (activeDescriptionTab === 'start') {
                                    const can_describe_start_image = is_vision_service_available && !!card.startImagePath;
                                    const start_tooltip_message = can_describe_start_image
                                        ? `Analyze Image 1 using ${vision_engine_display_name} with ${startConfig.displayName} rules.`
                                        : (!card.startImagePath ? "Image 1 required." : "Vision service offline (launch llama-server or ComfyUI).");

                                    return (
                                        <AppTooltip content={start_tooltip_message} placement="top" offset={[0, 48]}>
                                            <span>
                                                <button 
                                                    onClick={() => onGetImageDescription?.(card.id, 'startImagePath')}
                                                    disabled={!card.startImagePath || !is_vision_service_available || (card.isDescribing && (card.isDescribingSlot === 'startImagePath' || !card.isDescribingSlot))}
                                                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                                        card.isDescribing && (card.isDescribingSlot === 'startImagePath' || !card.isDescribingSlot)
                                                            ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20 animate-pulse'
                                                            : can_describe_start_image
                                                                ? 'bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border-blue-500/20'
                                                                : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                                    }`}
                                                >
                                                    <span>🔍</span> {card.isDescribing && (card.isDescribingSlot === 'startImagePath' || !card.isDescribingSlot) ? 'Describing...' : `Describe ${startConfig.displayName}`}
                                                </button>
                                            </span>
                                        </AppTooltip>
                                    );
                                } else {
                                    const can_describe_end_image = is_vision_service_available && !!card.endImagePath;
                                    const end_tooltip_message = can_describe_end_image
                                        ? `Analyze Image 2 using ${vision_engine_display_name} with ${endConfig.displayName} rules.`
                                        : (!card.endImagePath ? "Image 2 required." : "Vision service offline (launch llama-server or ComfyUI).");

                                    return (
                                        <AppTooltip content={end_tooltip_message} placement="top" offset={[0, 48]}>
                                            <span>
                                                <button 
                                                    onClick={() => onGetImageDescription?.(card.id, 'endImagePath')}
                                                    disabled={!card.endImagePath || !is_vision_service_available || (card.isDescribing && card.isDescribingSlot === 'endImagePath')}
                                                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                                        card.isDescribing && card.isDescribingSlot === 'endImagePath'
                                                            ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20 animate-pulse'
                                                            : can_describe_end_image
                                                                ? 'bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border-blue-500/20'
                                                                : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                                    }`}
                                                >
                                                    <span>🔍</span> {card.isDescribing && card.isDescribingSlot === 'endImagePath' ? 'Describing...' : `Describe ${endConfig.displayName}`}
                                                </button>
                                            </span>
                                        </AppTooltip>
                                    );
                                }
                            })()}
                        </div>
                    </div>

                    {/* Active Textarea */}
                    <div className="relative">
                        {activeDescriptionTab === 'start' ? (
                            <textarea 
                                className={`w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed overflow-hidden ${card.isDescribing && (card.isDescribingSlot === 'startImagePath' || !card.isDescribingSlot) ? 'opacity-50' : ''}`}
                                style={{ height: `${Math.min(200, Math.max(60, getTextHeight(card.actionDescription || card.startImageDescription || '', assumedWidth) + 16))}px` }}
                                title="Right-click to open large editor"
                                placeholder={`AI generated ${startConfig.displayName.toLowerCase()} description will appear here...`}
                                value={card.actionDescription || card.startImageDescription || ''}
                                onChange={(input_event) => onUpdate(card.id, { 
                                    actionDescription: input_event.target.value,
                                    startImageDescription: input_event.target.value
                                })}
                                onContextMenu={(context_menu_event) => {
                                    context_menu_event.preventDefault();
                                    context_menu_event.stopPropagation();
                                    setEditorConfig({
                                        title: `Edit ${startConfig.displayName} Description`,
                                        initialValue: card.actionDescription || card.startImageDescription || '',
                                        onSave: (updated_text_value) => onUpdate(card.id, { 
                                            actionDescription: updated_text_value,
                                            startImageDescription: updated_text_value
                                        })
                                    });
                                    setIsEditorOpen(true);
                                }}
                            />
                        ) : (
                            <textarea 
                                className={`w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed overflow-hidden ${card.isDescribing && card.isDescribingSlot === 'endImagePath' ? 'opacity-50' : ''}`}
                                style={{ height: `${Math.min(200, Math.max(60, getTextHeight(card.endImageDescription || '', assumedWidth) + 16))}px` }}
                                title="Right-click to open large editor"
                                placeholder={`AI generated ${endConfig.displayName.toLowerCase()} description will appear here...`}
                                value={card.endImageDescription || ''}
                                onChange={(input_event) => onUpdate(card.id, { endImageDescription: input_event.target.value })}
                                onContextMenu={(context_menu_event) => {
                                    context_menu_event.preventDefault();
                                    context_menu_event.stopPropagation();
                                    setEditorConfig({
                                        title: `Edit ${endConfig.displayName} Description`,
                                        initialValue: card.endImageDescription || '',
                                        onSave: (updated_text_value) => onUpdate(card.id, { endImageDescription: updated_text_value })
                                    });
                                    setIsEditorOpen(true);
                                }}
                            />
                        )}
                        {card.isDescribing && (
                            ((activeDescriptionTab === 'start' && (card.isDescribingSlot === 'startImagePath' || !card.isDescribingSlot)) ||
                            (activeDescriptionTab === 'end' && card.isDescribingSlot === 'endImagePath'))
                        ) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-lg">
                                <span className="text-[10px] font-bold text-indigo-400 animate-pulse">Describing...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Clip Action Box */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Clip Action</label>
                        <div className="flex gap-1">
                            {/* Reword / Magic Button */}
                            <AppTooltip content={`Expand into a cinematic video prompt using ${llmProvider === 'vino' ? '🍷 Intel NPU (Vino)' : '🦙 llama-server'}.`} placement="top" offset={[0, 48]}>
                                <span>
                                    <button 
                                        onClick={() => onRewordPrompt?.(card.id)}
                                        disabled={card.isExpanding || card.expandedPromptLocked}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                            card.isExpanding 
                                                ? 'bg-purple-600/20 text-purple-400 border-purple-500/20 animate-pulse'
                                                : card.expandedPromptLocked
                                                    ? 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed opacity-50'
                                                    : 'bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white border-indigo-500/20'
                                        }`}
                                    >
                                        <span>✨</span> {card.isExpanding ? 'Expanding...' : 'Reword'}
                                    </button>
                                </span>
                            </AppTooltip>

                            <AppTooltip content={comfyConnected ? "Generate video for this shot." : "ComfyUI not connected."} placement="top" offset={[0, 48]}>
                                <span>
                                    <button 
                                        onClick={() => onGenerateVideo?.(card.id)}
                                        disabled={!comfyConnected || card.status === 'generating' || card.status === 'queued'}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 border ${
                                            card.status === 'generating' 
                                                ? 'bg-amber-600/20 text-amber-500 border-amber-500/20 animate-pulse'
                                                : card.status === 'queued'
                                                    ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20 animate-pulse'
                                                    : comfyConnected
                                                        ? 'bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white border-purple-500/20'
                                                        : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                        }`}
                                    >
                                        <span>🎬</span> {card.status === 'generating' ? 'Generating...' : card.status === 'queued' ? 'Queued...' : 'Generate'}
                                    </button>
                                </span>
                            </AppTooltip>
                        </div>
                    </div>
                    <textarea 
                        className="w-full bg-black/20 border-none rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-indigo-500/30 p-2 leading-relaxed overflow-hidden"
                        style={{ height: `${Math.min(200, Math.max(60, getTextHeight(actionPromptValue, assumedWidth) + 16))}px` }}
                        title="Right-click to open large editor"
                        placeholder="Describe the clip action for video generation..."
                        value={actionPromptValue}
                        onChange={(input_event) => onUpdate(card.id, { 
                            notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), action: input_event.target.value } 
                        })}
                        onContextMenu={(context_menu_event) => {
                            context_menu_event.preventDefault();
                            context_menu_event.stopPropagation();
                            setEditorConfig({
                                title: "Edit Clip Action",
                                initialValue: actionPromptValue,
                                onSave: (updated_text_value) => onUpdate(card.id, { 
                                    notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), action: updated_text_value } 
                                })
                            });
                            setIsEditorOpen(true);
                        }}
                    />
                </div>

                {/* AI Expanded Prompt Box (The "Target" for Video) */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center pr-1">
                        <div className="flex items-center gap-2">
                            <label className="text-[9px] font-bold text-purple-400/80 uppercase tracking-widest pl-1">AI Expanded Prompt</label>
                            {/* Lock Toggle */}
                            <button 
                                onClick={() => onUpdate(card.id, { expandedPromptLocked: !card.expandedPromptLocked })}
                                className={`text-[10px] transition-all hover:scale-110 ${card.expandedPromptLocked ? 'text-amber-500' : 'text-gray-600 hover:text-gray-400'}`}
                                title={card.expandedPromptLocked ? "Locked: Prompt will not be overwritten by AI" : "Unlocked: AI can overwrite this prompt"}
                            >
                                {card.expandedPromptLocked ? '🔒' : '🔓'}
                            </button>
                        </div>
                        <div className="flex gap-1">
                            {card.aiExpandedPrompt && (
                                <span className="text-[8px] font-bold text-gray-600 uppercase bg-black/40 px-1.5 py-0.5 rounded border border-gray-800/50">
                                    Target Prompt
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="relative">
                        <textarea 
                            className={`w-full bg-purple-900/5 border border-purple-500/10 rounded-lg text-[12px] text-gray-300 min-h-[60px] resize-none focus:ring-1 focus:ring-purple-500/30 p-2 leading-relaxed overflow-hidden ${card.isExpanding ? 'opacity-50' : ''} ${card.expandedPromptLocked ? 'border-amber-500/20 bg-amber-900/5' : ''}`}
                            style={{ height: `${Math.min(250, Math.max(80, getTextHeight(card.aiExpandedPrompt || '', assumedWidth) + 16))}px` }}
                            title="Right-click to open large editor"
                            placeholder="Rich cinematic expansion will appear here..."
                            value={card.aiExpandedPrompt || ''}
                            onChange={(input_event) => onUpdate(card.id, { aiExpandedPrompt: input_event.target.value })}
                            onContextMenu={(context_menu_event) => {
                                context_menu_event.preventDefault();
                                context_menu_event.stopPropagation();
                                setEditorConfig({
                                    title: "Edit AI Expanded Prompt",
                                    initialValue: card.aiExpandedPrompt || '',
                                    onSave: (updated_text_value) => onUpdate(card.id, { aiExpandedPrompt: updated_text_value })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                        {card.isExpanding && (
                            <div className="absolute inset-0 flex items-center justify-center bg-purple-900/10 rounded-lg">
                                <span className="text-[10px] font-bold text-purple-400 animate-pulse italic">Thinking...</span>
                            </div>
                        )}
                        {card.expandedPromptLocked && !card.isExpanding && !card.aiExpandedPrompt && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-tighter opacity-30 italic">Locked Empty</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Dialogue</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-indigo-300 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            title="Right-click to open large editor"
                            placeholder="..." 
                            value={dialogueValue}
                            onChange={(input_event) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), dialogue: input_event.target.value } 
                            })}
                            onContextMenu={(context_menu_event) => {
                                context_menu_event.preventDefault();
                                context_menu_event.stopPropagation();
                                setEditorConfig({
                                    title: "Edit Dialogue",
                                    initialValue: dialogueValue,
                                    onSave: (updated_text_value) => onUpdate(card.id, { 
                                        notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), dialogue: updated_text_value } 
                                    })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Sound Cues</label>
                        <input 
                            className="w-full bg-black/20 border-none rounded-lg text-xs text-amber-500/80 focus:ring-1 focus:ring-indigo-500/30 p-2"
                            title="Right-click to open large editor"
                            placeholder="..." 
                            value={soundValue}
                            onChange={(input_event) => onUpdate(card.id, { 
                                notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), sound: input_event.target.value } 
                            })}
                            onContextMenu={(context_menu_event) => {
                                context_menu_event.preventDefault();
                                context_menu_event.stopPropagation();
                                setEditorConfig({
                                    title: "Edit Sound Cues",
                                    initialValue: soundValue,
                                    onSave: (updated_text_value) => onUpdate(card.id, { 
                                        notes: { ...(card.notes || { action: '', dialogue: '', sound: '' }), sound: updated_text_value } 
                                    })
                                });
                                setIsEditorOpen(true);
                            }}
                        />
                    </div>
                </div>

                {/* Timing Row */}
                <div className="pt-2 border-t border-gray-700/30 flex justify-between items-center text-[10px]">
                    <div className="flex gap-4">
                        <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Start</span>
                            <span className="text-gray-400 font-mono italic">{formatTime(card.startTime)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">End</span>
                            <span className="text-gray-400 font-mono italic">{formatTime(card.endTime)}</span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Frames</span>
                        <span className="text-[#f59e0b] font-mono font-black italic">
                            {Math.round((card.duration || 0) * frameRate)}
                        </span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Duration</span>
                        <div className="flex items-center gap-0.5">
                            <input
                                type="number"
                                step={8 / frameRate}
                                min="0.1"
                                value={(card.duration || 0).toFixed(1)}
                                onChange={(input_event) => {
                                    const raw_duration_seconds = parseFloat(input_event.target.value) || 0.1;
                                    const aligned_duration_seconds = getAlignedDuration(raw_duration_seconds, frameRate);
                                    onUpdate(card.id, { duration: aligned_duration_seconds, endTime: card.startTime + aligned_duration_seconds });
                                }}
                                className="bg-transparent border-b border-transparent hover:border-indigo-500/50 focus:border-indigo-500 text-indigo-400/80 font-bold w-12 text-right outline-none p-0 transition-all text-[10px]"
                            />
                            <span className="text-indigo-400/80 font-bold">s</span>
                        </div>
                    </div>
                </div>
            </div>

            <PromptEditorModal 
                isOpen={isEditorOpen}
                title={editorConfig.title}
                initialValue={editorConfig.initialValue}
                onSave={(updated_text_value) => {
                    editorConfig.onSave(updated_text_value);
                    setIsEditorOpen(false);
                }}
                onCancel={() => setIsEditorOpen(false)}
            />
        </div>
    );
};

export default StoryboardCardComponent;

