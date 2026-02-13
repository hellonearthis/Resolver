import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScriptManagerModule from './ScriptManagerModule';

// Mock Electron IPC
const mockInvoke = vi.fn();
window.require = vi.fn(() => ({
    ipcRenderer: {
        invoke: mockInvoke,
    },
}));

describe('ScriptManagerModule', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders and lists scripts', async () => {
        const mockScripts = [
            { name: '01_Load_Beats_My_Song.py', path: '/path/01_Load_Beats_My_Song.py', size: 1024, mtime: new Date().toISOString() },
        ];

        mockInvoke.mockImplementation(async (channel) => {
            if (channel === 'list-resolve-scripts') return mockScripts;
            return [];
        });

        const { unmount } = render(<ScriptManagerModule />);

        expect(screen.getByText('📜 Script Manager')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText('01_Load_Beats_My_Song.py')).toBeTruthy();
        });
        unmount();
    });

    it('handles delete action', async () => {
        const initialScripts = [{ name: 'To_Delete.py', path: '/path/To_Delete.py', size: 100, mtime: new Date().toISOString() }];
        let scripts = [...initialScripts];

        mockInvoke.mockImplementation(async (channel, arg) => {
            if (channel === 'list-resolve-scripts') return scripts;
            if (channel === 'delete-resolve-script') {
                if (arg === '/path/To_Delete.py') {
                    scripts = [];
                    return { success: true };
                }
            }
            return [];
        });

        // Mock confirm
        window.confirm = vi.fn(() => true);

        const { unmount } = render(<ScriptManagerModule />);

        await waitFor(() => {
            expect(screen.getByText('To_Delete.py')).toBeTruthy();
        });

        const deleteBtn = screen.getByTitle('Delete this script');
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('delete-resolve-script', '/path/To_Delete.py');
            expect(screen.queryByText('To_Delete.py')).toBeNull();
        });
        unmount();
    });

    it('handles edit action', async () => {
        const mockScripts = [
            { name: 'Script.py', path: '/path/Script.py', size: 100, mtime: new Date().toISOString() },
        ];
        mockInvoke.mockResolvedValue(mockScripts);

        const { unmount } = render(<ScriptManagerModule />);

        await waitFor(() => {
            expect(screen.getByText('Script.py')).toBeTruthy();
        });

        const editBtn = screen.getByTitle('Edit in Notepad');
        fireEvent.click(editBtn);

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('edit-resolve-script', '/path/Script.py');
        });
        unmount();
    });

    it('handles rename action', async () => {
        const initialScripts = [{ name: 'OldName.py', path: '/path/OldName.py', size: 100, mtime: new Date().toISOString() }];
        let scripts = [...initialScripts];

        mockInvoke.mockImplementation(async (channel, arg) => {
            if (channel === 'list-resolve-scripts') return scripts;
            if (channel === 'rename-resolve-script') {
                if (arg.oldPath === '/path/OldName.py' && arg.newName === 'NewName.py') {
                    scripts = [{ name: 'NewName.py', path: '/path/NewName.py', size: 100, mtime: new Date().toISOString() }];
                    return { success: true };
                }
            }
            return [];
        });

        const { unmount } = render(<ScriptManagerModule />);

        await waitFor(() => {
            expect(screen.getByText('OldName.py')).toBeTruthy();
        });

        const renameBtn = screen.getByTitle('Rename script');
        fireEvent.click(renameBtn);

        // Expect Modal to appear and input to have processed value
        const input = screen.getByDisplayValue('OldName.py');
        expect(input).toBeTruthy();

        // Change value
        fireEvent.change(input, { target: { value: 'NewName.py' } });

        // Click Save/Rename in Modal
        const confirmBtn = screen.getByText('Rename', { selector: 'button' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('rename-resolve-script', { oldPath: '/path/OldName.py', newName: 'NewName.py' });
            expect(screen.getByText('NewName.py')).toBeTruthy();
        });
        unmount();
    });
});
