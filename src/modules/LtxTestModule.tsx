import React, { useState } from 'react';
import workflowJson from '../../comfyui_workflows/video_ltx2_i2v.json';
import DropZone from '../components/DropZone';

// Helper to get IPC renderer
const getIpcRenderer = () => {
    if ((window as any).require) {
        return (window as any).require('electron').ipcRenderer;
    }
    return null;
};

export default function LtxTestModule() {
    const [startImage, setStartImage] = useState<string>('Image_fx(21).jpg');
    const [startImagePreview, setStartImagePreview] = useState<string | null>(null);
    const [positivePrompt, setPositivePrompt] = useState<string>('A sweeping cinematic shot of a mountain landscape at sunset...');
    const [negativePrompt, setNegativePrompt] = useState<string>('blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles');
    const [fps, setFps] = useState<number>(25);
    const [frameCount, setFrameCount] = useState<number>(81);
    const [outputPrefix, setOutputPrefix] = useState<string>('video/LTX_2.0_i2v');
    const [audioFile, setAudioFile] = useState<string>('Bob Marly-Get Up, Stand Up_Vocals.mp3');

    const [isGenerating, setIsGenerating] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');

    const duration = (frameCount / fps).toFixed(2);

    const handleGenerate = async () => {
        const ipcRenderer = getIpcRenderer();
        if (!ipcRenderer) {
            setStatusMessage('Error: Electron IPC not found.');
            return;
        }

        setIsGenerating(true);
        setStatusMessage('Preparing workflow...');

        try {
            // Deep clone the workflow template
            const workflow = JSON.parse(JSON.stringify(workflowJson));

            // Apply specific mappings as per readme_ltx2.md

            // 1. Start Image (Node 98)
            if (workflow["98"] && workflow["98"].inputs) {
                workflow["98"].inputs.image = startImage;
            }

            // 2. Positive Prompt (Node 92:3)
            if (workflow["92:3"] && workflow["92:3"].inputs) {
                workflow["92:3"].inputs.text = positivePrompt;
            }

            // 3. Negative Prompt (Node 92:4)
            if (workflow["92:4"] && workflow["92:4"].inputs) {
                workflow["92:4"].inputs.text = negativePrompt;
            }

            // 4. FPS in 3 places (Node 92:22, Node 92:51, Node 92:97)
            if (workflow["92:22"] && workflow["92:22"].inputs) {
                workflow["92:22"].inputs.frame_rate = fps;
            }
            if (workflow["92:51"] && workflow["92:51"].inputs) {
                workflow["92:51"].inputs.frame_rate = fps;
            }
            if (workflow["92:97"] && workflow["92:97"].inputs) {
                workflow["92:97"].inputs.fps = fps;
            }

            // 5. Frame count (Node 92:62)
            // (Note: Audio frames linked to this node automatically in workflow)
            if (workflow["92:62"] && workflow["92:62"].inputs) {
                workflow["92:62"].inputs.value = frameCount;
            }

            // 6. Output prefix (Node 75)
            if (workflow["75"] && workflow["75"].inputs) {
                workflow["75"].inputs.filename_prefix = outputPrefix;
            }

            // 7. Audio file (Node 92:113)
            if (workflow["92:113"] && workflow["92:113"].inputs) {
                workflow["92:113"].inputs.audio = audioFile;
            }

            const payload = {
                prompt: workflow
            };

            setStatusMessage('Sending to ComfyUI...');

            // Assuming ComfyUI runs locally on 8188 default
            const response = await ipcRenderer.invoke('comfy-fetch', 'http://127.0.0.1:8188/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.success) {
                const promptId = response.data?.prompt_id;
                setStatusMessage(`Success! Task queued. Prompt ID: ${promptId}`);
            } else {
                setStatusMessage(`Error: ${response.error || 'Failed to queue prompt'}`);
            }

        } catch (error: any) {
            console.error('Generation Error:', error);
            setStatusMessage(`Error: ${error.message || String(error)}`);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="module-container p-6 w-full max-w-4xl mx-auto overflow-y-auto">
            <div className="module-header mb-6">
                <h2 className="module-title text-2xl font-bold text-white mb-2">🎥 LTX-Video 2.0 Generator</h2>
                <p className="module-description text-gray-400 text-sm">
                    Image-to-Video Workflow configuration based on readme_ltx2.md
                </p>
            </div>

            <div className="card bg-gray-900/50 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                <div className="card-header bg-gray-800/80 px-4 py-3 border-b border-gray-700">
                    <h3 className="card-title text-lg font-semibold text-gray-200">Video Parameters</h3>
                </div>

                <div className="p-4 space-y-6">
                    {/* Status Message */}
                    {statusMessage && (
                        <div className={`p-3 rounded text-sm ${statusMessage.includes('Error') ? 'bg-red-900/20 text-red-400 border border-red-800/50' : 'bg-green-900/20 text-green-400 border border-green-800/50'}`}>
                            {statusMessage}
                        </div>
                    )}

                    {/* Image Settings */}
                    <div className="bg-gray-800/40 p-4 rounded border border-gray-700/50">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Start Image File</label>
                        <div className="flex flex-col md:flex-row gap-4 items-start">
                            <div className="flex-1 w-full">
                                <DropZone
                                    onFilesDropped={(files) => {
                                        if (files.length > 0) {
                                            const file = files[0];
                                            setStartImage(file.name);
                                            // Create preview URL
                                            if (startImagePreview) URL.revokeObjectURL(startImagePreview);
                                            setStartImagePreview(URL.createObjectURL(file));
                                        }
                                    }}
                                    accept="image/*"
                                    label={startImage ? `Selected: ${startImage}` : "Drop Start Image Here"}
                                />
                                <p className="text-xs text-gray-500 mt-2">Image must exist in ComfyUI's input directory.</p>
                            </div>
                            {startImagePreview && (
                                <div className="w-full md:w-48 shrink-0 flex flex-col items-center">
                                    <div className="relative rounded bg-gray-900 border border-gray-600 overflow-hidden w-full aspect-video flex items-center justify-center">
                                        <img src={startImagePreview} alt="Start Image Preview" className="max-w-full max-h-full object-contain" />
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">Preview</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Audio Settings */}
                    <div className="bg-gray-800/40 p-4 rounded border border-gray-700/50">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Audio File</label>
                        <DropZone
                            onFilesDropped={(files) => {
                                if (files.length > 0) {
                                    setAudioFile(files[0].name);
                                }
                            }}
                            accept="audio/*"
                            label={audioFile ? `Selected: ${audioFile}` : "Drop Audio File Here"}
                        />
                        <p className="text-xs text-gray-500 mt-2">Audio must exist in ComfyUI's input directory.</p>
                    </div>

                    {/* Prompt Settings */}
                    <div className="bg-gray-800/40 p-4 rounded border border-gray-700/50 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Positive Prompt</label>
                            <textarea
                                value={positivePrompt}
                                onChange={e => setPositivePrompt(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors min-h-[80px]"
                                placeholder="Describe the scene..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Negative Prompt</label>
                            <textarea
                                value={negativePrompt}
                                onChange={e => setNegativePrompt(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors min-h-[60px]"
                            />
                        </div>
                    </div>

                    {/* Timeline Settings */}
                    <div className="bg-gray-800/40 p-4 rounded border border-gray-700/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">FPS (Frame Rate): {fps}</label>
                                <input
                                    type="range"
                                    min="10"
                                    max="60"
                                    step="1"
                                    value={fps}
                                    onChange={e => setFps(Number(e.target.value))}
                                    className="w-full accent-blue-500 mt-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Number of Frames</label>
                                <div className="relative inline-block w-full sm:w-auto">
                                    <select
                                        value={frameCount}
                                        onChange={e => setFrameCount(Number(e.target.value))}
                                        className="appearance-none w-full sm:w-auto bg-[#4ea8f8] hover:bg-[#3b8fd7] text-white font-medium px-6 py-2.5 pr-10 rounded-full shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-[#4ea8f8] focus:ring-opacity-75 cursor-pointer text-center"
                                    >
                                        {[9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97, 105, 113, 121].map(num => (
                                            <option key={num} value={num} className="bg-gray-800 text-left text-white">
                                                {num}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white">
                                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                                        </svg>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">Must be (n × 8) + 1.</p>
                            </div>
                        </div>

                        <div className="mt-3 bg-indigo-900/20 text-indigo-300 border border-indigo-800/50 px-3 py-2 rounded text-sm flex justify-between items-center">
                            <span>Estimated Duration:</span>
                            <span className="font-bold text-indigo-200">{duration} seconds</span>
                        </div>
                    </div>

                    {/* Output Settings */}
                    <div className="bg-gray-800/40 p-4 rounded border border-gray-700/50">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Output Filename Prefix</label>
                        <input
                            type="text"
                            value={outputPrefix}
                            onChange={e => setOutputPrefix(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        <p className="text-xs text-gray-500 mt-1">Relative to ComfyUI output directory.</p>
                    </div>

                    {/* Actions */}
                    <div className="pt-4 border-t border-gray-700/50 flex justify-end">
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className={`btn bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded shadow transition-colors font-medium flex items-center gap-2 ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isGenerating ? (
                                <>
                                    <span className="animate-spin text-lg leading-none">⏳</span>
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <span>🚀</span> Generate Video
                                </>
                            )}
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
