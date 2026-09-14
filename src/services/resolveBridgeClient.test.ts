/**
 * src/services/resolveBridgeClient.test.ts
 * 
 * WHAT:
 *   Unit tests for ResolveBridgeClient testing RPC communication,
 *   marker pushing, and error resilience against the DaVinci Resolve HTTP bridge.
 * 
 * WHY:
 *   Validates that the native TypeScript client correctly serializes wire calls,
 *   handles network timeouts/errors gracefully, and calculates frame offsets without
 *   requiring an actual DaVinci Resolve instance running during CI/testing.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ResolveBridgeClient,
    type MarkerPayloadItem,
    type ResolveRemoteProxy,
    DEFAULT_RESOLVER_BRIDGE_TOKEN
} from './resolveBridgeClient';

const createMockResponse = (response_payload: unknown): Response => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => response_payload,
} as unknown as Response);

describe('ResolveBridgeClient', () => {
    describe('checkConnectionStatus', () => {
        it('returns online status with active project and timeline when bridge responds', async () => {
            // WHAT: Injecting mock fetch resolving /status response.
            const mock_fetch = vi.fn().mockResolvedValue(createMockResponse({
                ok: true,
                status: 'online',
                app: 'DaVinci Resolve',
                project: 'Cyberpunk_Music_Video',
                timeline: 'Master_Timeline_24fps',
                version: '19.1.0'
            }));

            const client = new ResolveBridgeClient('127.0.0.1', 8878, DEFAULT_RESOLVER_BRIDGE_TOKEN, mock_fetch);
            const status_result = await client.checkConnectionStatus();

            expect(status_result.is_online).toBe(true);
            expect(status_result.active_project_name).toBe('Cyberpunk_Music_Video');
            expect(status_result.active_timeline_name).toBe('Master_Timeline_24fps');
        });

        it('returns offline status gracefully when bridge server is not reachable', async () => {
            // WHAT: Injecting mock fetch simulating network failure.
            const mock_fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8878'));

            const client = new ResolveBridgeClient('127.0.0.1', 8878, DEFAULT_RESOLVER_BRIDGE_TOKEN, mock_fetch);
            const status_result = await client.checkConnectionStatus();

            expect(status_result.is_online).toBe(false);
            expect(status_result.error_message).toContain('ECONNREFUSED');
        });
    });

    describe('invokeRemoteMethod', () => {
        it('sends correctly formatted JSON-RPC payload and unpacks remote object references', async () => {
            let captured_request_body: Record<string, unknown> | null = null;

            const mock_fetch = vi.fn().mockImplementation(async (_url: string, request_options?: RequestInit) => {
                if (request_options && typeof request_options.body === 'string') {
                    captured_request_body = JSON.parse(request_options.body);
                }
                return createMockResponse({
                    ok: true,
                    value: {
                        __ref__: 1,
                        __type__: 'ProjectManager'
                    }
                });
            });

            const client = new ResolveBridgeClient('127.0.0.1', 8878, DEFAULT_RESOLVER_BRIDGE_TOKEN, mock_fetch);
            const returned_remote_object = (await client.invokeRemoteMethod(0, 'GetProjectManager', [])) as ResolveRemoteProxy;

            expect(returned_remote_object).toBeDefined();
            expect(returned_remote_object.__ref).toBe(1);
            expect(returned_remote_object.__type).toBe('ProjectManager');

            expect(captured_request_body).toEqual({
                token: DEFAULT_RESOLVER_BRIDGE_TOKEN,
                ref: 0,
                attr: 'GetProjectManager',
                args: [],
                kwargs: {}
            });
        });

        it('throws an informative error if the bridge returns ok: false', async () => {
            const mock_fetch = vi.fn().mockResolvedValue(createMockResponse({
                ok: false,
                error: 'AttributeError: Timeline object has no attribute NonExistentMethod'
            }));

            const client = new ResolveBridgeClient('127.0.0.1', 8878, DEFAULT_RESOLVER_BRIDGE_TOKEN, mock_fetch);
            await expect(client.invokeRemoteMethod(1, 'NonExistentMethod', [])).rejects.toThrow('AttributeError');
        });
    });

    describe('pushMarkersToActiveTimeline', () => {
        it('resolves timeline start frame offset and pushes markers accurately', async () => {
            const mock_marker_items_collection: MarkerPayloadItem[] = [
                {
                    frame: 24,
                    timestamp: 1.0,
                    color: 'Red',
                    note: 'DOWNBEAT',
                    type: 'beat',
                    duration_sec: 0.05
                },
                {
                    frame: 48,
                    timestamp: 2.0,
                    color: 'Yellow',
                    note: 'BEAT',
                    type: 'beat',
                    duration_sec: 0.05
                }
            ];

            let add_marker_invocations_count = 0;

            const mock_fetch = vi.fn().mockImplementation(async (_url: string, request_options?: RequestInit) => {
                const request_body_payload = typeof request_options?.body === 'string' ? JSON.parse(request_options.body) : {};
                const requested_attribute_name = request_body_payload.attr;

                if (requested_attribute_name === 'GetProjectManager') {
                    return createMockResponse({ ok: true, value: { __ref__: 1, __type__: 'ProjectManager' } });
                }
                if (requested_attribute_name === 'GetCurrentProject') {
                    return createMockResponse({ ok: true, value: { __ref__: 2, __type__: 'Project' } });
                }
                if (requested_attribute_name === 'GetCurrentTimeline') {
                    return createMockResponse({ ok: true, value: { __ref__: 3, __type__: 'Timeline' } });
                }
                if (requested_attribute_name === 'GetName') {
                    return createMockResponse({ ok: true, value: 'Timeline_Test' });
                }
                if (requested_attribute_name === 'GetSetting') {
                    return createMockResponse({ ok: true, value: '24' });
                }
                if (requested_attribute_name === 'GetStartFrame') {
                    return createMockResponse({ ok: true, value: 86400 });
                }
                if (requested_attribute_name === 'AddMarker') {
                    add_marker_invocations_count++;
                    const target_frame_argument = request_body_payload.args[0];
                    expect(target_frame_argument).toBeGreaterThan(86400);
                    return createMockResponse({ ok: true, value: true });
                }

                return createMockResponse({ ok: true, value: null });
            });

            const client = new ResolveBridgeClient('127.0.0.1', 8878, DEFAULT_RESOLVER_BRIDGE_TOKEN, mock_fetch);
            const push_markers_result = await client.pushMarkersToActiveTimeline(mock_marker_items_collection);

            expect(push_markers_result.success).toBe(true);
            expect(push_markers_result.pushed_count).toBe(2);
            expect(push_markers_result.timeline_name).toBe('Timeline_Test');
            expect(add_marker_invocations_count).toBe(2);
        });
    });
});
