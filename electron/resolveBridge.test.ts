/**
 * electron/resolveBridge.test.ts
 * 
 * Unit tests for native Electron Resolve Bridge:
 * - Utility scripts directory detection across OS platforms
 * - Bridge script installation and error handling
 * - Wire argument serialization and proxy deserialization
 * - Remote method invocation and HTTP error mapping
 * - Timeline marker color normalization and timeline reconstruction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
    getResolveUtilityScriptsDirectoryPath,
    isBridgeScriptInstalled,
    installBridgeScript,
    ResolveBridgeClient,
    DEFAULT_RESOLVER_BRIDGE_PORT,
    DEFAULT_RESOLVER_BRIDGE_TOKEN
} from './resolveBridge';

describe('electron/resolveBridge', () => {
    describe('Utility Script Directory Detection & Installer', () => {
        it('resolves utility script directory path matching platform conventions', () => {
            const utilityPath = getResolveUtilityScriptsDirectoryPath();
            expect(typeof utilityPath).toBe('string');
            expect(utilityPath.length).toBeGreaterThan(0);
            expect(utilityPath).toContain('Utility');
            expect(utilityPath).toContain('DaVinci Resolve');
        });

        it('checks if bridge script is installed using filesystem exists check', () => {
            const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
            expect(isBridgeScriptInstalled()).toBe(true);

            existsSpy.mockReturnValue(false);
            expect(isBridgeScriptInstalled()).toBe(false);

            existsSpy.mockRestore();
        });

        it('handles installBridgeScript when source script is not found', () => {
            // Mock fs.existsSync to report target dir exists, but source candidates do not exist
            const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((checkPath) => {
                const normalized = String(checkPath).replace(/\\/g, '/');
                if (normalized.includes('Utility')) return true;
                return false;
            });

            const result = installBridgeScript();
            expect(result.success).toBe(false);
            expect(result.error).toContain('Could not locate source resolve_bridge.py');

            existsSpy.mockRestore();
        });

        it('successfully installs bridge script when source script is located', () => {
            const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
            const copySpy = vi.spyOn(fs, 'copyFileSync').mockReturnValue(undefined);

            const result = installBridgeScript();
            expect(result.success).toBe(true);
            expect(result.target_path).toContain('resolve_bridge.py');
            expect(copySpy).toHaveBeenCalled();

            existsSpy.mockRestore();
            copySpy.mockRestore();
        });
    });

    describe('ResolveBridgeClient & Remote Proxy Protocol', () => {
        let originalFetch: typeof globalThis.fetch;

        beforeEach(() => {
            originalFetch = globalThis.fetch;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
            vi.restoreAllMocks();
        });

        it('initializes with default loopback port and token', () => {
            const client = new ResolveBridgeClient();
            expect(client).toBeDefined();
            expect(client.root).toBeDefined();
        });

        it('serializes arguments with remote proxy reference IDs for the wire', async () => {
            const client = new ResolveBridgeClient('127.0.0.1', 8878, 'test-key');

            let capturedPayload: unknown = null;
            globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
                capturedPayload = JSON.parse(options.body as string);
                return {
                    ok: true,
                    json: async () => ({ ok: true, value: { __ref__: 1, __type__: 'Project' } })
                } as unknown as Response;
            });

            // Proxy argument simulation { __ref: 99 }
            const mockProxyArg = { __ref: 99, name: 'Sample' };
            const resultProxy = await client.invokeRemoteMethod(0, 'TestCall', [
                'hello',
                42,
                mockProxyArg,
                [1, { __ref: 100 }]
            ]);

            expect(capturedPayload).toEqual({
                token: 'test-key',
                ref: 0,
                attr: 'TestCall',
                args: [
                    'hello',
                    42,
                    { __ref__: 99 },
                    [1, { __ref__: 100 }]
                ],
                kwargs: {}
            });

            // Deserialized value should be a remote proxy with __ref and __type
            const proxy = resultProxy as { __ref: number; __type: string };
            expect(proxy.__ref).toBe(1);
            expect(proxy.__type).toBe('Project');
        });

        it('guards against Promise thenable loops on remote proxies', () => {
            const client = new ResolveBridgeClient();
            const rootProxy = client.root;

            // When JS evaluates await or inspects thenables, .then, .catch, .finally must be undefined
            expect(rootProxy.then).toBeUndefined();
            expect(rootProxy.catch).toBeUndefined();
            expect(rootProxy.finally).toBeUndefined();

            // toJSON must return reference descriptor
            expect(rootProxy.toJSON()).toEqual({ __ref: 0, __type: 'Resolve' });
        });

        it('throws appropriate error when bridge returns HTTP non-200', async () => {
            const client = new ResolveBridgeClient();
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 502,
                statusText: 'Bad Gateway'
            } as Response);

            await expect(client.invokeRemoteMethod(0, 'Ping', [])).rejects.toThrow(
                'HTTP 502 from Resolve Bridge: Bad Gateway'
            );
        });

        it('throws appropriate error when bridge returns ok: false envelope', async () => {
            const client = new ResolveBridgeClient();
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ ok: false, error: 'ProjectManager is not accessible' })
            } as Response);

            await expect(client.invokeRemoteMethod(0, 'GetProjectManager', [])).rejects.toThrow(
                'ProjectManager is not accessible'
            );
        });

        it('reports connection status online when /status endpoint succeeds', async () => {
            const client = new ResolveBridgeClient();
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    app: 'DaVinci Resolve Studio',
                    project: 'Neon Horizon',
                    timeline: 'Timeline 1'
                })
            } as Response);

            const status = await client.checkConnectionStatus();
            expect(status.is_online).toBe(true);
            expect(status.application_name).toBe('DaVinci Resolve Studio');
            expect(status.active_project_name).toBe('Neon Horizon');
            expect(status.active_timeline_name).toBe('Timeline 1');
        });

        it('reports connection status offline when /status endpoint fails or times out', async () => {
            const client = new ResolveBridgeClient();
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const status = await client.checkConnectionStatus();
            expect(status.is_online).toBe(false);
            expect(status.error_message).toContain('ECONNREFUSED');
        });

        it('normalizes hex and named colors when pushing timeline markers', async () => {
            const client = new ResolveBridgeClient();

            const mockTimeline = {
                GetName: vi.fn().mockResolvedValue('Main Timeline'),
                GetSetting: vi.fn().mockResolvedValue('24'),
                GetStartFrame: vi.fn().mockResolvedValue('0'),
                AddMarker: vi.fn().mockResolvedValue(true)
            };

            const mockProject = {
                GetCurrentTimeline: vi.fn().mockResolvedValue(mockTimeline)
            };

            const mockProjectManager = {
                GetCurrentProject: vi.fn().mockResolvedValue(mockProject)
            };

            // Intercept root proxy method calls
            vi.spyOn(client, 'invokeRemoteMethod').mockImplementation(async (_ref, attr) => {
                if (attr === 'GetProjectManager') return mockProjectManager;
                return null;
            });

            // Also mock root property accessor
            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => mockProjectManager
                })
            });

            const markers = [
                { frame: 0, timestamp: 0, color: '#ff0000', note: 'Red note', type: 'beat', duration_sec: 0.1 },
                { frame: 24, timestamp: 1.0, color: '#ffff00', note: 'Yellow note', type: 'onset', duration_sec: 0.1 },
                { frame: 48, timestamp: 2.0, color: '#00ff00', note: 'Green note', type: 'energy', duration_sec: 0.1 },
                { frame: 72, timestamp: 3.0, color: '#00ffff', note: 'Cyan note', type: 'section', duration_sec: 0.1 },
                { frame: 96, timestamp: 4.0, color: 'magenta', note: 'Fuchsia note', type: 'beat', duration_sec: 0.1 },
                { frame: 120, timestamp: 5.0, color: 'orange', note: 'Sand note', type: 'beat', duration_sec: 0.1 },
                { frame: 144, timestamp: 6.0, color: 'purple', note: 'Purple note', type: 'beat', duration_sec: 0.1 },
                { frame: 168, timestamp: 7.0, color: 'unknown-hex', note: 'Default blue', type: 'beat', duration_sec: 0.1 }
            ];

            const result = await client.pushMarkersToActiveTimeline(markers);
            expect(result.success).toBe(true);
            expect(result.pushed_count).toBe(8);

            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(0, 'Red', 'Red note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(24, 'Yellow', 'Yellow note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(48, 'Green', 'Green note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(72, 'Cyan', 'Cyan note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(96, 'Fuchsia', 'Fuchsia note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(120, 'Sand', 'Sand note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(144, 'Purple', 'Purple note', expect.any(String), expect.any(Number));
            expect(mockTimeline.AddMarker).toHaveBeenCalledWith(168, 'Blue', 'Default blue', expect.any(String), expect.any(Number));
        });

        it('handles pushMarkersToActiveTimeline failure when ProjectManager is unavailable', async () => {
            const client = new ResolveBridgeClient();
            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => null
                })
            });

            const result = await client.pushMarkersToActiveTimeline([
                { frame: 0, timestamp: 0, color: 'blue', note: 'fail', type: 'beat' }
            ]);

            expect(result.success).toBe(false);
            expect(result.pushed_count).toBe(0);
            expect(result.error).toContain('Could not access ProjectManager');
        });

        it('imports audio and video media into Resolve Media Pool', async () => {
            const client = new ResolveBridgeClient();

            const mockMediaPool = {
                ImportMedia: vi.fn().mockImplementation(async (paths: string[]) => {
                    return paths.map((p, idx) => ({ id: `pool-item-${idx}`, path: p }));
                })
            };

            const mockProject = {
                GetMediaPool: vi.fn().mockResolvedValue(mockMediaPool)
            };

            const mockProjectManager = {
                GetCurrentProject: vi.fn().mockResolvedValue(mockProject)
            };

            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => mockProjectManager
                })
            });

            const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

            const result = await client.importMediaIntoMediaPool('C:/media/audio.wav', [
                'C:/media/shot1.mp4',
                'C:/media/shot2.mp4'
            ]);

            expect(result.success).toBe(true);
            expect(result.audio_imported).toBe(true);
            expect(result.imported_video_count).toBe(2);
            expect(mockMediaPool.ImportMedia).toHaveBeenCalledWith(['C:/media/audio.wav']);
            expect(mockMediaPool.ImportMedia).toHaveBeenCalledWith(['C:/media/shot1.mp4', 'C:/media/shot2.mp4']);

            existsSpy.mockRestore();
        });

        it('handles importMediaIntoMediaPool error when no project is open', async () => {
            const client = new ResolveBridgeClient();

            const mockProjectManager = {
                GetCurrentProject: vi.fn().mockResolvedValue(null)
            };

            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => mockProjectManager
                })
            });

            const result = await client.importMediaIntoMediaPool('C:/media/audio.wav', []);
            expect(result.success).toBe(false);
            expect(result.error).toContain('No project open in DaVinci Resolve');
        });

        it('reconstructs timeline by creating empty timeline, importing audio and placing video clips', async () => {
            const client = new ResolveBridgeClient();

            const mockTimeline = {
                GetName: vi.fn().mockResolvedValue('Reconstructed_Timeline'),
                GetStartFrame: vi.fn().mockResolvedValue('86400') // 01:00:00:00 typical Resolve start
            };

            const mockMediaPool = {
                CreateEmptyTimeline: vi.fn().mockResolvedValue(mockTimeline),
                ImportMedia: vi.fn().mockImplementation(async (paths: string[]) => {
                    return paths.map((p) => ({ __itemPath: p }));
                }),
                AppendToTimeline: vi.fn().mockResolvedValue(true)
            };

            const mockProject = {
                GetMediaPool: vi.fn().mockResolvedValue(mockMediaPool),
                GetCurrentTimeline: vi.fn().mockResolvedValue(null), // simulate needs new timeline
                SetCurrentTimeline: vi.fn().mockResolvedValue(true)
            };

            const mockProjectManager = {
                GetCurrentProject: vi.fn().mockResolvedValue(mockProject)
            };

            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => mockProjectManager
                })
            });

            const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

            const clips = [
                {
                    id: 'c1',
                    videoPath: 'C:/media/clip1.mp4',
                    startTime: 0,
                    endTime: 4.0,
                    track: 1
                },
                {
                    id: 'c2',
                    videoPath: 'C:/media/clip2.mp4',
                    startTime: 4.0,
                    endTime: 8.0,
                    track: 2
                }
            ];

            const result = await client.reconstructTimeline(
                'MusicVideo',
                'C:/media/track.wav',
                24,
                clips
            );

            expect(result.success).toBe(true);
            expect(result.timeline_name).toBe('Reconstructed_Timeline');
            expect(result.placed_clips_count).toBe(2);

            expect(mockMediaPool.CreateEmptyTimeline).toHaveBeenCalledWith(expect.stringContaining('Reconstructed_MusicVideo'));
            expect(mockProject.SetCurrentTimeline).toHaveBeenCalledWith(mockTimeline);
            // AppendToTimeline called for audio (once) and video (2 clips)
            expect(mockMediaPool.AppendToTimeline).toHaveBeenCalledTimes(3);

            existsSpy.mockRestore();
        });

        it('handles reconstructTimeline error gracefully if timeline creation fails', async () => {
            const client = new ResolveBridgeClient();

            const mockMediaPool = {
                CreateEmptyTimeline: vi.fn().mockResolvedValue(null)
            };

            const mockProject = {
                GetMediaPool: vi.fn().mockResolvedValue(mockMediaPool),
                GetCurrentTimeline: vi.fn().mockResolvedValue(null)
            };

            const mockProjectManager = {
                GetCurrentProject: vi.fn().mockResolvedValue(mockProject)
            };

            Object.defineProperty(client, 'root', {
                get: () => ({
                    GetProjectManager: async () => mockProjectManager
                })
            });

            const result = await client.reconstructTimeline('FailProject', '', 24, []);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to create new timeline in Resolve');
        });
    });
});

