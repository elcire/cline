// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CompactionSettings,
	ModelContextSettings,
} from "./compaction-settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

describe("context settings", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	it("loads the 80% default and saves it", async () => {
		invoke.mockResolvedValue({});
		await act(async () => root.render(<CompactionSettings />));
		expect(container.querySelector("input")?.value).toBe("80");
		await act(async () => container.querySelector("button")?.click());
		expect(invoke).toHaveBeenLastCalledWith("set_compaction_threshold", {
			threshold_ratio: 0.8,
		});
		expect(container.textContent).toContain("Saved.");
	});
	it("loads a saved threshold and surfaces save failures", async () => {
		invoke
			.mockResolvedValueOnce({ compactionThresholdRatio: 0.7 })
			.mockRejectedValueOnce(new Error("disk full"));
		await act(async () => root.render(<CompactionSettings />));
		expect(container.querySelector("input")?.value).toBe("70");
		await act(async () => container.querySelector("button")?.click());
		expect(container.textContent).toContain("disk full");
		expect(container.textContent).not.toContain("Saved.");
	});
	it("does not save before settings load succeeds", async () => {
		invoke.mockRejectedValue(new Error("offline"));
		await act(async () => root.render(<CompactionSettings />));
		expect(container.querySelector("button")?.disabled).toBe(true);
	});
	it("saves the server's exact per-model capacity", async () => {
		const onSave = vi.fn(async () => {});
		await act(async () =>
			root.render(
				<ModelContextSettings
					modelId="qwen"
					contextWindow={65536}
					onSave={onSave}
				/>,
			),
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onSave).toHaveBeenCalledWith("qwen", 65536);
	});
	it("warns about unknown model capacity and disables invalid input", async () => {
		await act(async () =>
			root.render(<ModelContextSettings modelId="qwen" onSave={vi.fn()} />),
		);
		expect(container.textContent).toContain("Unknown context size");
		expect(container.querySelector("button")?.disabled).toBe(true);
	});
});
