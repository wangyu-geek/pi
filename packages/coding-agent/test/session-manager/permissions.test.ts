import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSessionToJsonl } from "../../src/core/session-export.ts";
import { getDefaultSessionDir, SessionManager } from "../../src/core/session-manager.ts";
import { userMsg } from "../utilities.ts";

describe.skipIf(process.platform === "win32")("session permissions", () => {
	let tempDir: string;
	let originalUmask: number;

	beforeEach(() => {
		originalUmask = process.umask(0);
		tempDir = mkdtempSync(join(tmpdir(), "pi-session-permissions-"));
	});

	afterEach(() => {
		process.umask(originalUmask);
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates the default sessions root and project directory with mode 0700", () => {
		const sessionDir = getDefaultSessionDir(tempDir, join(tempDir, "agent"));

		expect(statSync(dirname(sessionDir)).mode & 0o777).toBe(0o700);
		expect(statSync(sessionDir).mode & 0o777).toBe(0o700);
	});

	it("creates a custom session directory with mode 0700 and its JSONL file with mode 0600", () => {
		const session = SessionManager.create(tempDir, join(tempDir, "custom"));
		session.appendMessage(userMsg("hello"));

		expect(statSync(session.getSessionDir()).mode & 0o777).toBe(0o700);
		expect(statSync(session.getSessionFile()!).mode & 0o777).toBe(0o600);
	});

	it("creates a branched session file with mode 0600", () => {
		const session = SessionManager.create(tempDir, tempDir);
		const leafId = session.appendMessage(userMsg("hello"));

		const file = session.createBranchedSession(leafId)!;

		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it("creates a fork directory with mode 0700 and its file with mode 0600", () => {
		const session = SessionManager.create(tempDir, tempDir);
		session.appendMessage(userMsg("hello"));

		const fork = SessionManager.forkFrom(session.getSessionFile()!, tempDir, join(tempDir, "fork"));

		expect(statSync(fork.getSessionDir()).mode & 0o777).toBe(0o700);
		expect(statSync(fork.getSessionFile()!).mode & 0o777).toBe(0o600);
	});

	it("creates exported JSONL files with mode 0600 without changing the parent directory", () => {
		const exportDir = join(tempDir, "exports");
		mkdirSync(exportDir, { mode: 0o755 });
		const session = SessionManager.inMemory(tempDir);
		session.appendMessage(userMsg("hello"));

		const file = exportSessionToJsonl(session, join(exportDir, "session.jsonl"));

		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(exportDir).mode & 0o777).toBe(0o755);
	});

	it("preserves existing session directory and file permissions", () => {
		const agentDir = join(tempDir, "agent");
		const sessionDir = getDefaultSessionDir(tempDir, agentDir);
		chmodSync(dirname(sessionDir), 0o755);
		chmodSync(sessionDir, 0o755);
		const session = SessionManager.create(tempDir, sessionDir);
		session.appendMessage(userMsg("hello"));
		const file = session.getSessionFile()!;
		chmodSync(file, 0o644);

		getDefaultSessionDir(tempDir, agentDir);
		const reopened = SessionManager.open(file);
		reopened.appendMessage(userMsg("another message"));
		exportSessionToJsonl(reopened, file);

		expect(statSync(dirname(sessionDir)).mode & 0o777).toBe(0o755);
		expect(statSync(sessionDir).mode & 0o777).toBe(0o755);
		expect(statSync(file).mode & 0o777).toBe(0o644);
	});
});
