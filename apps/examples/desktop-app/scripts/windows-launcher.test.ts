import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Source-only guard: do not compile or launch Windows executables to verify
// the merged launcher while Norton analysis can lock up the development PC.
const source = readFileSync(
	new URL("../src-tauri/src/main.rs", import.meta.url),
	"utf8",
);
const launcher = source.slice(
	source.indexOf("fn spawn_desktop_backend_process("),
	source.indexOf("fn ensure_desktop_backend_started("),
);

test("Windows debug launches retain Bun .cmd shim resolution", () => {
	expect(launcher).toContain("#[cfg(windows)]");
	expect(launcher).toContain('Command::new("cmd.exe")');
	expect(launcher).toMatch(/\.arg\("\/D"\)\s*\.arg\("\/C"\)\s*\.arg\("bun"\)/);
	expect(launcher).toContain("#[cfg(not(windows))]");
	expect(launcher).toContain('Command::new("bun")');
});

test("release launches use the upstream bundled CLI and isolated backend", () => {
	expect(launcher).toContain("if cfg!(debug_assertions)");
	expect(launcher).toContain("resolve_desktop_cli_path(context)");
	expect(launcher).toContain("resolve_desktop_backend_bundle_path(context)");
	expect(launcher).toContain("Command::new(cli_path)");
	expect(launcher).toContain('.env("BUN_BE_BUN", "1")');
	expect(launcher).toContain('.arg("--no-env-file")');
	expect(launcher).not.toContain("resolve_desktop_backend_binary_path");
});
