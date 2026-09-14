/**
 * src/services/llamaServerClient.test.ts
 * 
 * WHAT:
 *   Unit tests for LlamaServerClient validating dynamic model discovery,
 *   endpoint fallback probing, capability checks, and diagnostic reporting.
 * 
 * WHY:
 *   Ensures that pure llama-server connectivity functions correctly without
 *   any legacy LM Studio fallback or port 1234 dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlamaServerClient } from '../../electron/llamaServerClient';

describe('LlamaServerClient', () => {
    const original_fetch_reference = globalThis.fetch;
    const original_environment_local_ai_url = process.env.LOCAL_AI_URL;
    const original_environment_llama_server_url = process.env.LLAMA_SERVER_URL;

    beforeEach(() => {
        delete process.env.LOCAL_AI_URL;
        delete process.env.LLAMA_SERVER_URL;
    });

    afterEach(() => {
        globalThis.fetch = original_fetch_reference;
        if (original_environment_local_ai_url !== undefined) {
            process.env.LOCAL_AI_URL = original_environment_local_ai_url;
        }
        if (original_environment_llama_server_url !== undefined) {
            process.env.LLAMA_SERVER_URL = original_environment_llama_server_url;
        }
    });

    it('successfully discovers an active model on standard port 8080 and detects capabilities', async () => {
        // WHAT: Mock successful response from llama-server /v1/models.
        // WHY: Verifies that model identifiers and capabilities are correctly parsed.
        const mock_fetch_handler = vi.fn().mockImplementation(async (request_url_string: string) => {
            if (request_url_string.includes('8080/v1/models')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'qwen2.5-coder-7b-instruct',
                                aliases: ['coder-default'],
                                capabilities: ['completion']
                            }
                        ],
                        models: [
                            {
                                name: 'qwen2.5-coder-7b-instruct',
                                aliases: ['coder-default'],
                                capabilities: ['completion'],
                                meta: { n_ctx: 16384 }
                            }
                        ]
                    })
                };
            }
            throw new Error('Connection refused');
        });

        globalThis.fetch = mock_fetch_handler as unknown as typeof fetch;

        const client_instance = new LlamaServerClient('http://localhost:8080');
        const discovery_succeeded = await client_instance.discoverActiveLlamaServerModel();

        expect(discovery_succeeded).toBe(true);
        expect(client_instance.getActiveEndpointUrl()).toBe('http://localhost:8080');
        expect(client_instance.getActiveModelIdentifier()).toBe('coder-default');
        expect(client_instance.hasMultimodalVisionSupport()).toBe(false);
        expect(client_instance.getChatCompletionsUrl()).toBe('http://localhost:8080/v1/chat/completions');
    });

    it('correctly detects multimodal vision capability when vision projector is loaded', async () => {
        // WHAT: Mock llama-server with multimodal capability enabled via --mmproj.
        // WHY: Validates that vision support is accurately surfaced to callers.
        const mock_fetch_handler = vi.fn().mockImplementation(async (request_url_string: string) => {
            if (request_url_string.includes('8080/v1/models')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'qwen2.5-vl-7b-instruct',
                                aliases: ['vision-model'],
                                capabilities: ['completion', 'multimodal']
                            }
                        ],
                        models: [
                            {
                                name: 'qwen2.5-vl-7b-instruct',
                                capabilities: ['completion', 'multimodal'],
                                meta: { n_ctx: 8192 }
                            }
                        ]
                    })
                };
            }
            throw new Error('Connection refused');
        });

        globalThis.fetch = mock_fetch_handler as unknown as typeof fetch;

        const client_instance = new LlamaServerClient();
        const discovery_succeeded = await client_instance.discoverActiveLlamaServerModel();

        expect(discovery_succeeded).toBe(true);
        expect(client_instance.hasMultimodalVisionSupport()).toBe(true);
        expect(client_instance.getActiveModelIdentifier()).toBe('vision-model');
    });

    it('returns an offline diagnostic report with clear guidance when server is unreachable', async () => {
        // WHAT: Mock connection failure across all candidate ports.
        // WHY: Confirms that offline status emits actionable user diagnostics.
        const mock_fetch_handler = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        globalThis.fetch = mock_fetch_handler as unknown as typeof fetch;

        const client_instance = new LlamaServerClient('http://localhost:8080');
        const diagnostic_report = await client_instance.testLlamaServerConnection();

        expect(diagnostic_report.connection_status).toBe('offline');
        expect(diagnostic_report.resolved_endpoint_url).toBeNull();
        expect(diagnostic_report.multimodal_vision_supported).toBe(false);
        expect(diagnostic_report.diagnostic_message).toContain('llama-server is offline');
    });

    it('prioritizes LOCAL_AI_URL environment variable override over default ports', async () => {
        // WHAT: Set LOCAL_AI_URL to custom port 9999.
        // WHY: Ensures environment configuration takes absolute precedence.
        process.env.LOCAL_AI_URL = 'http://127.0.0.1:9999';

        const probed_endpoints_list: string[] = [];
        const mock_fetch_handler = vi.fn().mockImplementation(async (request_url_string: string) => {
            probed_endpoints_list.push(request_url_string);
            if (request_url_string.startsWith('http://127.0.0.1:9999')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [{ id: 'env-model' }]
                    })
                };
            }
            throw new Error('Not probed first');
        });

        globalThis.fetch = mock_fetch_handler as unknown as typeof fetch;

        const client_instance = new LlamaServerClient();
        const discovery_succeeded = await client_instance.discoverActiveLlamaServerModel();

        expect(discovery_succeeded).toBe(true);
        expect(client_instance.getActiveEndpointUrl()).toBe('http://127.0.0.1:9999');
        expect(client_instance.getActiveModelIdentifier()).toBe('env-model');
        expect(probed_endpoints_list[0]).toBe('http://127.0.0.1:9999/v1/models');
    });

    it('successfully generates vision description via OpenAI-compatible multimodal endpoint', async () => {
        // WHAT: Mock responses for discovery and vision chat completion.
        // WHY: Validates proper construction of the user image_url payload and text extraction.
        const mock_fetch_handler = vi.fn().mockImplementation(async (request_url_string: string, request_options_object?: RequestInit) => {
            if (request_url_string.includes('/v1/models')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: [
                            {
                                id: 'qwen3.5-9b',
                                capabilities: ['completion', 'multimodal']
                            }
                        ]
                    })
                };
            }

            if (request_url_string.includes('/v1/chat/completions')) {
                const parsed_body_payload = JSON.parse(request_options_object?.body as string);
                expect(parsed_body_payload.messages[0].content[1].type).toBe('image_url');
                expect(parsed_body_payload.messages[0].content[1].image_url.url).toBe('data:image/png;base64,mockdata');

                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        choices: [
                            {
                                message: {
                                    role: 'assistant',
                                    content: 'Cinematic wide shot of a neon cyberpunk street with reflections.'
                                }
                            }
                        ]
                    })
                };
            }

            throw new Error(`Unexpected request: ${request_url_string}`);
        });

        globalThis.fetch = mock_fetch_handler as unknown as typeof fetch;

        const client_instance = new LlamaServerClient('http://localhost:8080');
        const vision_result = await client_instance.generateMultimodalVisionDescription(
            'data:image/png;base64,mockdata',
            'Describe the scene composition and lighting.'
        );

        expect(vision_result.success).toBe(true);
        expect(vision_result.text).toContain('Cinematic wide shot');
    });
});
