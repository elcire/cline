import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";

export function CompactionSettings() {
	const [percent, setPercent] = useState("80");
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");
	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<{ compactionThresholdRatio?: number }>("get_global_settings")
			.then((settings) => {
				if (!cancelled) {
					setPercent(
						String(
							Math.round((settings.compactionThresholdRatio ?? 0.8) * 100),
						),
					);
					setLoaded(true);
				}
			})
			.catch((error) => {
				if (!cancelled) setStatus(String(error));
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const value = Number(percent);
	const save = async () => {
		setSaving(true);
		setStatus("");
		try {
			await desktopClient.invoke("set_compaction_threshold", {
				threshold_ratio: value / 100,
			});
			setStatus("Saved. Applies when starting or resuming a session.");
		} catch (error) {
			setStatus(String(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<section className="mb-8 space-y-3">
			<h3 className="text-sm font-medium">Context compaction</h3>
			<p className="text-xs text-muted-foreground">
				Summarize conversation history at this percentage of the model context
				window (default 80%). An earlier input-budget safety limit still
				applies. Local models need an accurate context size in Providers.
			</p>
			<div className="flex items-center gap-3">
				<label className="text-sm" htmlFor="compaction-percent">
					Threshold (%)
				</label>
				<input
					className="w-20 rounded border bg-background px-2 py-1"
					id="compaction-percent"
					type="number"
					min={10}
					max={90}
					value={percent}
					onChange={(event) => setPercent(event.target.value)}
				/>
				<Button
					type="button"
					size="sm"
					disabled={
						!loaded ||
						saving ||
						!Number.isFinite(value) ||
						value < 10 ||
						value > 90
					}
					onClick={() => void save()}
				>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
			{status && (
				<output className="block text-xs text-muted-foreground">
					{status}
				</output>
			)}
		</section>
	);
}

export function ModelContextSettings({
	modelId,
	contextWindow,
	onSave,
}: {
	modelId: string;
	contextWindow?: number;
	onSave: (modelId: string, tokens: number) => Promise<void>;
}) {
	const [tokens, setTokens] = useState(
		contextWindow ? String(contextWindow) : "",
	);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");
	useEffect(() => {
		setTokens(contextWindow ? String(contextWindow) : "");
	}, [contextWindow]);
	const value = Number(tokens);
	const save = async () => {
		setSaving(true);
		setStatus("");
		try {
			await onSave(modelId, value);
			setStatus("Saved. Start or resume the session to use this limit.");
		} catch (error) {
			setStatus(String(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="mt-2 font-sans text-xs">
			<label className="flex items-center gap-2">
				Context tokens
				<input
					aria-label={`Context tokens for ${modelId}`}
					className="w-28 rounded border bg-background px-2 py-1"
					type="number"
					min={1024}
					step={1}
					placeholder="Unknown"
					value={tokens}
					onChange={(event) => setTokens(event.target.value)}
				/>
				<Button
					type="button"
					size="sm"
					disabled={saving || !Number.isSafeInteger(value) || value < 1024}
					onClick={() => void save()}
				>
					Save
				</Button>
			</label>
			{!contextWindow && (
				<p className="mt-1 text-muted-foreground">
					Unknown context size: enter the server's actual token limit.
				</p>
			)}
			{status && (
				<output className="mt-1 block text-muted-foreground">{status}</output>
			)}
		</div>
	);
}
