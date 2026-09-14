import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface PromptEditorModalProps {
    isOpen: boolean;
    initialValue: string;
    onSave: (value: string) => void;
    onCancel: () => void;
    title?: string;
}

// WHAT: Modal dialog allowing focused multi-line editing of complex AI video generation prompts.
// WHY: Gives the user a distraction-free, maximized text area to craft and review lengthy cinematic prompts.
const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
    isOpen,
    initialValue,
    onSave,
    onCancel,
    title = "Edit Prompt"
}) => {
    // WHAT: Storing current draft prompt text and tracking incoming prop changes.
    // WHY: Adjusting state during render when props change conforms to React 19 rules
    // and eliminates cascading effect render cycles.
    const [draft_prompt_text, setDraftPromptText] = useState<string>(initialValue);
    const [previous_initial_value, setPreviousInitialValue] = useState<string>(initialValue);

    if (initialValue !== previous_initial_value) {
        setPreviousInitialValue(initialValue);
        setDraftPromptText(initialValue);
    }

    if (!isOpen) return null;

    const modal_content_element = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" style={{ isolation: 'isolate' }}>
            <div 
                className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(mouse_click_event) => mouse_click_event.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-800/50">
                    <h3 className="text-lg font-semibold text-indigo-300 flex items-center gap-2">
                        <span>📝</span> {title}
                    </h3>
                    <button 
                        onClick={onCancel}
                        className="text-gray-400 hover:text-white transition-colors p-1"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    <textarea
                        autoFocus
                        value={draft_prompt_text}
                        onChange={(text_change_event) => setDraftPromptText(text_change_event.target.value)}
                        className="w-full h-[500px] bg-gray-950 border border-gray-700 rounded-lg p-4 text-gray-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none font-mono text-sm leading-relaxed"
                        placeholder="Enter prompt text here..."
                    />
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-800/30 border-t border-gray-800 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(draft_prompt_text)}
                        className="px-6 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-900/20 transition-all active:scale-95"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modal_content_element, document.body);
};

export default PromptEditorModal;
