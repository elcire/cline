import { describe, expect, it } from "vitest";
import {
	createClineProvider,
	createOpenAICompatibleProvider,
	createOpenAIProvider,
	createSapAiCoreProvider,
} from "./ai-sdk";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { createGateway } from "./gateway";
import { BUILT_IN_PROVIDER_IDS, normalizeProviderId } from "./ids";
import {
	getModelsForProvider,
	getProvider,
	getProviderIds,
} from "./model-registry";
import { GENERATED_PROVIDER_SPECS } from "./providers.generated";

function generatedProviderDefault(providerId: string): string {
	const defaultModelId = GENERATED_PROVIDER_SPECS.find(
		(spec) => spec.id === providerId,
	)?.defaultModelId;
	if (!defaultModelId) {
		throw new Error(`Generated provider ${providerId} has no default model`);
	}
	return defaultModelId;
}

describe("provider-ids", () => {
	it("keeps built-in provider ids aligned with model registry loaders", () => {
		const registryProviderIds = new Set(getProviderIds());
		for (const providerId of BUILT_IN_PROVIDER_IDS) {
			expect(registryProviderIds.has(providerId)).toBe(true);
		}
		for (const providerId of registryProviderIds) {
			expect(BUILT_IN_PROVIDER_IDS).toContain(providerId);
		}
	});

	it("registers v0 as a built-in provider", async () => {
		await expect(getProvider("v0")).resolves.toMatchObject({
			id: "v0",
			baseUrl: "https://api.v0.dev/v1",
			defaultModelId: "v0-1.5-md",
			client: "openai-compatible",
		});

		// models.dev no longer lists v0, so only the built-in default remains.
		const models = await getModelsForProvider("v0");
		expect(Object.keys(models)).toEqual(["v0-1.5-md"]);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "v0",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("uses openai-compatible as the OpenAI Compatible built-in provider", async () => {
		expect(normalizeProviderId("openai")).toBe("openai-compatible");
		expect(BUILT_IN_PROVIDER_IDS).not.toContain("openai");
		expect(BUILT_IN_PROVIDER_IDS).toContain("openai-compatible");

		await expect(getProvider("openai-compatible")).resolves.toMatchObject({
			id: "openai-compatible",
			name: "OpenAI Compatible",
			baseUrl: "https://api.openai.com/v1",
			defaultModelId: "gpt-4o",
			client: "openai-compatible",
		});
		await expect(
			getModelsForProvider("openai-compatible"),
		).resolves.toMatchObject({
			"gpt-4o": {
				id: "gpt-4o",
				contextWindow: 128_000,
				maxInputTokens: 128_000,
			},
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "openai-compatible",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl: "https://gateway.example.invalid/v1",
					models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
				},
			],
		});
		expect(gateway.listModels("openai-compatible")).toContainEqual(
			expect.objectContaining({
				id: "gpt-oss-120b",
				providerId: "openai-compatible",
			}),
		);
	});

	it("registers ClinePass as a distinct Cline-compatible built-in provider", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("cline-pass");
		const models = await getModelsForProvider("cline-pass");
		const provider = await getProvider("cline-pass");

		expect(provider).toMatchObject({
			id: "cline-pass",
			name: "ClinePass",
			client: "openai-compatible",
		});
		expect(models).toHaveProperty(provider?.defaultModelId ?? "");

		for (const providerId of ["cline", "cline-pass"]) {
			const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
				(item) => item.manifest.id === providerId,
			);
			await expect(registration?.loadProvider?.()).resolves.toMatchObject({
				createProvider: createClineProvider,
			});
		}
	});

	it("registers Poolside as an OpenAI-compatible built-in provider", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("poolside");
		const defaultModelId = generatedProviderDefault("poolside");

		await expect(getProvider("poolside")).resolves.toMatchObject({
			id: "poolside",
			name: "Poolside",
			baseUrl: "https://inference.poolside.ai/v1",
			defaultModelId,
			client: "openai-compatible",
		});
		const models = await getModelsForProvider("poolside");
		expect(Object.hasOwn(models, defaultModelId)).toBe(true);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "poolside",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("routes Responses API built-ins through the OpenAI provider factory", async () => {
		const provider = await getProvider("kilo");
		expect(provider).toMatchObject({
			id: "kilo",
			protocol: "openai-responses",
			client: "openai",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "kilo",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAIProvider,
		});
	});

	it("routes LiteLLM through Chat Completions like other openai-compatible built-ins", async () => {
		// LiteLLM proxies commonly serve /chat/completions but not /responses;
		// pinning the provider to the Responses API broke them (#10781, #13003).
		const provider = await getProvider("litellm");
		expect(provider).toMatchObject({
			id: "litellm",
			protocol: "openai-chat",
			client: "openai-compatible",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "litellm",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("registers llama-swap through the authenticated scheduled router", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("llama-swap");
		await expect(getProvider("llama-swap")).resolves.toMatchObject({
			id: "llama-swap",
			name: "llama-swap",
			baseUrl: "http://192.168.10.65:8284/v1",
			modelsSourceUrl: "http://192.168.10.65:8284/v1/models",
			defaultModelId: "qwen3.8-27b-iq4xs-pure-64k",
			client: "openai-compatible",
			metadata: {
				configFields: expect.arrayContaining([
					expect.objectContaining({
						path: "baseUrl",
						type: "select",
						options: expect.arrayContaining([
							expect.objectContaining({
								value: "http://192.168.10.65:8284/v1",
							}),
						]),
					}),
					expect.objectContaining({
						path: "apiKey",
						type: "password",
						required: true,
					}),
				]),
			},
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "llama-swap",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("registers the isolated Strata router with its actual 32K image/tool model", async () => {
		expect(BUILT_IN_PROVIDER_IDS).toContain("strata");
		await expect(getProvider("strata")).resolves.toMatchObject({
			id: "strata",
			baseUrl: "http://192.168.1.100:8294/v1",
			modelsSourceUrl: "http://192.168.1.100:8294/v1/models",
			defaultModelId: "qwen3.8-flash-next-iq3s-32k",
			client: "openai-compatible",
		});
		const models = await getModelsForProvider("strata");
		expect(Object.keys(models)).toEqual(["qwen3.8-flash-next-iq3s-32k"]);
		expect(models["qwen3.8-flash-next-iq3s-32k"]).toMatchObject({
			contextWindow: 32768,
			maxInputTokens: 30720,
			maxTokens: 2048,
			capabilities: expect.arrayContaining(["images", "tools"]),
		});
		expect(models["qwen3.8-flash-next-iq3s-32k"].capabilities).not.toContain(
			"reasoning",
		);
	});

	it("registers Xiaomi as an OpenAI-compatible built-in provider", async () => {
		const defaultModelId = generatedProviderDefault("xiaomi");
		await expect(getProvider("xiaomi")).resolves.toMatchObject({
			id: "xiaomi",
			baseUrl: "https://api.xiaomimimo.com/v1",
			defaultModelId,
			client: "openai-compatible",
		});

		await expect(getModelsForProvider("xiaomi")).resolves.toHaveProperty(
			defaultModelId,
		);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "xiaomi",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("registers Tencent TokenHub as an OpenAI-compatible built-in provider", async () => {
		const defaultModelId = generatedProviderDefault("tencent-tokenhub");
		await expect(getProvider("tencent-tokenhub")).resolves.toMatchObject({
			id: "tencent-tokenhub",
			baseUrl: "https://tokenhub.tencentmaas.com/v1",
			defaultModelId,
			client: "openai-compatible",
		});

		await expect(
			getModelsForProvider("tencent-tokenhub"),
		).resolves.toHaveProperty(defaultModelId);

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "tencent-tokenhub",
		);
		expect(registration).toBeDefined();
		await expect(registration?.loadProvider()).resolves.toMatchObject({
			createProvider: createOpenAICompatibleProvider,
		});
	});

	it("registers Z.AI Coding Plan with an accessible coding-plan default", async () => {
		await expect(getProvider("zai-coding-plan")).resolves.toMatchObject({
			id: "zai-coding-plan",
			baseUrl: "https://api.z.ai/api/coding/paas/v4",
			defaultModelId: "glm-5.3",
			client: "openai-compatible",
		});

		const models = await getModelsForProvider("zai-coding-plan");
		expect(Object.hasOwn(models, "glm-5.3")).toBe(true);
	});

	it("routes SAP AI Core through the SAP AI SDK provider factory", async () => {
		await expect(getProvider("sapaicore")).resolves.toMatchObject({
			id: "sapaicore",
			name: "SAP AI Core",
			client: "ai-sdk-community",
			defaultModelId: "anthropic--claude-3.5-sonnet",
		});

		const registration = BUILTIN_PROVIDER_REGISTRATIONS.find(
			(item) => item.manifest.id === "sapaicore",
		);
		await expect(registration?.loadProvider?.()).resolves.toMatchObject({
			createProvider: createSapAiCoreProvider,
		});
	});
});
