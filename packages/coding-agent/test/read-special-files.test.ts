import { execFileSync } from "node:child_process";
import { closeSync, constants, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadTool } from "../src/index.ts";

/** Unblocks a reader leaked by a regression; non-blocking, so it cannot hang when there is none. */
function releaseFifoReader(fifo: string): void {
	try {
		closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
	} catch {
		// ENXIO means no reader is blocked.
	}
}

/** A regressed read blocks in the kernel, where no abort can reach it. */
async function expectRejected(promise: Promise<unknown>, pattern: RegExp, release: () => void): Promise<void> {
	const outcome = await Promise.race([
		promise.then(
			() => "resolved" as const,
			(error: unknown) => error,
		),
		new Promise<"hung">((resolve) => {
			setTimeout(() => resolve("hung"), 1500).unref();
		}),
	]);
	if (outcome === "hung") release();
	expect(outcome).toBeInstanceOf(Error);
	expect((outcome as Error).message).toMatch(pattern);
}

const posixIt = it.skipIf(process.platform === "win32");

describe("read on non-regular files", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-read-special-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	posixIt("rejects a FIFO instead of blocking", async () => {
		const fifo = join(dir, "input.fifo");
		execFileSync("mkfifo", [fifo]);
		const tool = createReadTool(dir);

		await expectRejected(tool.execute("read-fifo", { path: fifo }), /FIFO/, () => releaseFifoReader(fifo));
	});

	posixIt("rejects a FIFO reached through a symlink", async () => {
		const fifo = join(dir, "input.fifo");
		execFileSync("mkfifo", [fifo]);
		const link = join(dir, "link");
		symlinkSync(fifo, link);
		const tool = createReadTool(dir);

		await expectRejected(tool.execute("read-fifo-link", { path: link }), /FIFO/, () => releaseFifoReader(fifo));
	});

	posixIt("rejects a character device", async () => {
		// /dev/null returns EOF immediately, so a regression fails on the
		// classification instead of on an unbounded read.
		const tool = createReadTool(dir);

		await expectRejected(tool.execute("read-dev-null", { path: "/dev/null" }), /character device/, () => {});
	});

	it("still reads regular files", async () => {
		const file = join(dir, "file.txt");
		writeFileSync(file, "hello\n");
		const tool = createReadTool(dir);

		const result = await tool.execute("read-file", { path: file });

		expect(JSON.stringify(result.content)).toContain("hello");
	});
});
