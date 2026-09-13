import { type ApiStreamChunk, createHandlerAsync, type Message } from "../src";

const DEFAULT_ENDPOINT = "http://192.168.10.65:8282/v1";
const PREFERRED_MODELS = [
	"qwen3.6-27b-nvfp4-instruct",
	"qwen3.6-27b-instruct",
	"qwen3.6-27b-nonthinking",
];
const ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

interface Options {
	endpoint: string;
	model?: string;
	apiKey?: string;
	listOnly: boolean;
	tool: boolean;
	reasoning: boolean;
	vision: boolean;
}

function usage(): never {
	console.error(`Usage: bun run smoke:llama-swap -- [options]

Options:
  --endpoint <url>  Base URL ending in /v1 (default: ${DEFAULT_ENDPOINT})
  --model <id>      Model ID returned by /v1/models (auto-selects if omitted)
  --api-key <token> Optional bearer token (or LLAMA_SWAP_API_KEY)
  --list-only       Only verify the endpoint and print model IDs
  --tool            Require a native echo_tool call
  --reasoning       Enable thinking and report reasoning chunks
  --vision          Send a one-pixel PNG and require a response
  --help            Show this message`);
	process.exit(2);
}

function readValue(args: string[], index: number, option: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		console.error(`${option} requires a value`);
		usage();
	}
	return value;
}

function parseOptions(args: string[]): Options {
	const options: Options = {
		endpoint: DEFAULT_ENDPOINT,
		apiKey: process.env.LLAMA_SWAP_API_KEY?.trim() || undefined,
		listOnly: false,
		tool: false,
		reasoning: false,
		vision: false,
	};
	for (let i = 0; i < args.length; i += 1) {
		switch (args[i]) {
			case "--endpoint":
				options.endpoint = readValue(args, i, "--endpoint");
				i += 1;
				break;
			case "--model":
				options.model = readValue(args, i, "--model");
				i += 1;
				break;
			case "--api-key":
				options.apiKey = readValue(args, i, "--api-key");
				i += 1;
				break;
			case "--list-only":
				options.listOnly = true;
				break;
			case "--tool":
				options.tool = true;
				break;
			case "--reasoning":
				options.reasoning = true;
				break;
			case "--vision":
				options.vision = true;
				break;
			case "--help":
			case "-h":
				return usage();
			default:
				console.error(`Unknown option: ${args[i]}`);
				return usage();
		}
	}
	return options;
}

function normalizeEndpoint(value: string): string {
	return value.replace(/\/+$/, "");
}

async function listModels(
	endpoint: string,
	apiKey?: string,
): Promise<string[]> {
	const response = await fetch(`${endpoint}/models`, {
		headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(`GET ${endpoint}/models failed: HTTP ${response.status}`);
	}
	const payload = (await response.json()) as {
		data?: Array<{ id?: unknown }>;
	};
	return [
		...new Set(
			(payload.data ?? [])
				.map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
				.filter(Boolean),
		),
	];
}

function selectModel(modelIds: string[], requested?: string): string {
	if (requested) {
		if (!modelIds.includes(requested)) {
			throw new Error(`Model ${requested} was not returned by /v1/models`);
		}
		return requested;
	}
	for (const preferred of PREFERRED_MODELS) {
		if (modelIds.includes(preferred)) return preferred;
	}
	const languageModel = modelIds.find(
		(id) => !/(?:embed|embedding|asr|whisper|rerank)/i.test(id),
	);
	if (!languageModel)
		throw new Error("No likely language model was discovered");
	return languageModel;
}

async function collectStream(
	handler: Awaited<ReturnType<typeof createHandlerAsync>>,
	messages: Message[],
	tools?: Parameters<typeof handler.createMessage>[2],
): Promise<{ chunks: ApiStreamChunk[]; text: string }> {
	const chunks: ApiStreamChunk[] = [];
	let text = "";
	for await (const chunk of handler.createMessage(
		"You are a concise test assistant.",
		messages,
		tools,
	)) {
		chunks.push(chunk);
		if (chunk.type === "text") text += chunk.text;
		if (chunk.type === "done" && !chunk.success) {
			throw new Error(chunk.error ?? "stream ended with success=false");
		}
	}
	return { chunks, text };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const endpoint = normalizeEndpoint(options.endpoint);
	const modelIds = await listModels(endpoint, options.apiKey);
	if (modelIds.length === 0)
		throw new Error("/v1/models returned no model IDs");
	console.log(
		JSON.stringify(
			{ endpoint, modelCount: modelIds.length, modelIds },
			null,
			2,
		),
	);
	if (options.listOnly) return;

	const modelId = selectModel(modelIds, options.model);
	const handler = await createHandlerAsync({
		providerId: "llama-swap",
		modelId,
		baseUrl: endpoint,
		apiKey: options.apiKey,
		thinking: options.reasoning,
		capabilities: ["streaming", "tools"],
	});
	const basic = await collectStream(handler, [
		{ role: "user", content: "Reply with exactly: LLAMA_SWAP_OK" },
	]);
	if (!basic.text.trim()) throw new Error("Basic stream returned no text");
	console.log(
		JSON.stringify({
			test: "stream",
			modelId,
			text: basic.text.trim(),
			chunkTypes: [...new Set(basic.chunks.map((chunk) => chunk.type))],
		}),
	);

	if (options.tool) {
		const tool = await collectStream(
			handler,
			[
				{
					role: "user",
					content: 'Call echo_tool exactly once with {"text":"ping"}.',
				},
			],
			[
				{
					name: "echo_tool",
					description: "Echo text for a smoke test.",
					inputSchema: {
						type: "object",
						properties: { text: { type: "string" } },
						required: ["text"],
						additionalProperties: false,
					},
				},
			],
		);
		const calls = tool.chunks.filter((chunk) => chunk.type === "tool_calls");
		if (calls.length === 0) throw new Error("Model did not emit a tool call");
		console.log(JSON.stringify({ test: "tool", calls }));
	}

	if (options.vision) {
		const vision = await collectStream(handler, [
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe this tiny test image briefly." },
					{ type: "image", data: ONE_PIXEL_PNG, mediaType: "image/png" },
				],
			},
		]);
		if (!vision.text.trim()) throw new Error("Vision request returned no text");
		console.log(JSON.stringify({ test: "vision", text: vision.text.trim() }));
	}

	if (options.reasoning) {
		const reasoningChunks = basic.chunks.filter(
			(chunk) => chunk.type === "reasoning",
		).length;
		console.log(JSON.stringify({ test: "reasoning", reasoningChunks }));
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
