// Live, finite workstation probe. Reports only timings/correctness, never
// credentials, prompts, images, generated answers or tool-call payloads.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync, type Message } from "../src";

const modelId = "qwen3.8-flash-next-iq3s-32k";
const key = (
	await readFile(join(homedir(), ".cline/keys/strata-router.key"), "utf8")
).trim();
const handler = await createHandlerAsync({
	providerId: "strata",
	modelId,
	baseUrl: "http://192.168.1.100:8294/v1",
	apiKey: key,
	thinking: false,
	maxOutputTokens: 128,
	capabilities: ["streaming", "tools", "vision"],
});
async function probe(
	messages: Message[],
	tools?: Parameters<typeof handler.createMessage>[2],
) {
	const started = performance.now();
	let text = "";
	let called = false;
	const types = new Set<string>();
	for await (const chunk of handler.createMessage(
		"You are a concise test assistant.",
		messages,
		tools,
	)) {
		types.add(chunk.type);
		if (chunk.type === "text") text += chunk.text;
		if (
			chunk.type === "tool_calls" &&
			chunk.tool_call.function.name === "echo_tool"
		)
			called = true;
		if (chunk.type === "done" && !chunk.success)
			throw new Error("Cline stream failed; payload omitted");
	}
	return {
		text,
		called,
		seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
		types: [...types],
	};
}
const text = await probe([{ role: "user", content: "Reply with OK only." }]);
console.log(
	JSON.stringify({
		probe: "text",
		passed: text.text.trim().includes("OK"),
		seconds: text.seconds,
		types: text.types,
	}),
);
if (!text.text.includes("OK"))
	throw new Error("Text correctness failed; answer omitted");
const tool = await probe(
	[{ role: "user", content: "Call echo_tool with text equal to ping." }],
	[
		{
			name: "echo_tool",
			description: "Echo a test value.",
			inputSchema: {
				type: "object",
				properties: { text: { type: "string" } },
				required: ["text"],
				additionalProperties: false,
			},
		},
	],
);
console.log(
	JSON.stringify({
		probe: "tool",
		passed: tool.called,
		seconds: tool.seconds,
		types: tool.types,
	}),
);
if (!tool.called)
	throw new Error("Tool-call correctness failed; payload omitted");
const fixture = process.env.STRATA_TEST_IMAGE;
if (fixture) {
	const data = (await readFile(fixture)).toString("base64");
	const vision = await probe([
		{
			role: "user",
			content: [
				{
					type: "text",
					text: "Read the digits in this image. Reply with only those digits.",
				},
				{ type: "image", data, mediaType: "image/png" },
			],
		},
	]);
	const passed = vision.text.replace(/\D/g, "") === "482731";
	console.log(
		JSON.stringify({
			probe: "vision",
			passed,
			seconds: vision.seconds,
			types: vision.types,
		}),
	);
	if (!passed) throw new Error("Vision correctness failed; answer omitted");
}
