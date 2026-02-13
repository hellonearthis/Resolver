
export const COMFY_API_URL = 'http://127.0.0.1:8188';

export interface ComfyNode {
    inputs: Record<string, any>;
    class_type: string;
    _meta: {
        title: string;
    };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

// Helper to bypass CORS using Electron's Node.js integration
// Helper to bypass CORS using Electron's Main Process via IPC
const nodeFetch = async (url: string, options: RequestInit = {}): Promise<{ ok: boolean, status: number, statusText: string, json: () => Promise<any> }> => {
    // @ts-ignore
    if (window.require) {
        try {
            // @ts-ignore
            const { ipcRenderer } = window.require('electron');
            // Use the IPC handler we defined in main.ts
            const result = await ipcRenderer.invoke('comfy-fetch', url, options);

            return {
                ok: result.success,
                status: result.status || (result.success ? 200 : 500),
                statusText: result.error || 'OK',
                json: async () => result.data
            };
        } catch (e) {
            console.error("IPC Fetch Error", e);
            return {
                ok: false,
                status: 500,
                statusText: String(e),
                json: async () => ({})
            };
        }
    }

    // Fallback to browser fetch (will likely fail CORS if not proxied)
    return fetch(url, options);
};

export const checkComfyConnection = async (): Promise<boolean> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/system_stats`);
        return response.ok;
    } catch (error) {
        console.error('ComfyUI connection check failed:', error);
        return false;
    }
};

export const queuePrompt = async (workflow: ComfyWorkflow): Promise<{ prompt_id: string } | null> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow }),
        });

        if (!response.ok) {
            throw new Error(`Failed to queue prompt: ${response.statusText}`);
        }

        const data = await response.json();
        return data; // { prompt_id: "...", number: ... }
    } catch (error) {
        console.error('Failed to queue prompt:', error);
        return null;
    }
};

export const getHistory = async (promptId: string): Promise<any> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/history/${promptId}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to get history:', error);
        return null;
    }
};

export const getQueue = async (): Promise<{ queue_running: any[], queue_pending: any[] } | null> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/queue`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to get queue:', error);
        return null;
    }
};
