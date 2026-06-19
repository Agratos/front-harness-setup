// teardown.mjs — 프로세스 트리 종료 + 포트 해제 검증 (Windows 우선) (US-009)
//
// eval-playwright.mjs 가 dev 서버(detached child)를 띄운 뒤, finally 에서 반드시
// 호출하는 정리 루틴입니다. selftest 는 Playwright 없이 이 모듈만으로 teardown 을
// 결정적으로 검증합니다(사소한 http 서버 → kill → 포트 free 확인).
//
// Windows 핵심: detached child 는 자식 손주를 남길 수 있으므로 단순 child.kill() 로는
// 트리가 안 죽습니다. `taskkill /F /T /PID <pid>` 로 **트리 전체** 를 강제 종료합니다.
import { execFile } from 'node:child_process';
import net from 'node:net';

const isWin = process.platform === 'win32';

/**
 * 지정 포트에 LISTEN 중인 프로세스가 있는지(=포트 점유) 검사한다.
 * 0.0.0.0 / 127.0.0.1 양쪽을 막는 dev 서버를 고려해, 127.0.0.1 로 connect 시도해
 * 연결되면 "점유 중", ECONNREFUSED 면 "비어 있음" 으로 본다.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true=점유 중(listener 존재)
 */
export function isPortInUse(port, timeoutMs = 1000) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;
		const done = (inUse) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(inUse);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done(true)); // 연결됨 → listener 존재
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false)); // ECONNREFUSED 등 → 비어 있음
		socket.connect(port, '127.0.0.1');
	});
}

/** execFile 프라미스 래퍼 — 실패해도 reject 하지 않고 {ok,stdout,stderr,code} 반환. */
function run(cmd, args) {
	return new Promise((resolve) => {
		execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
			resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '', code: err?.code ?? 0 });
		});
	});
}

/**
 * PID 의 프로세스 트리를 강제 종료한다.
 *  - Windows: `taskkill /F /T /PID <pid>` (트리 전체).
 *  - 그 외: process.kill(-pid) (프로세스 그룹) 시도 후 실패하면 process.kill(pid).
 * 이미 죽었거나 PID 미상이면 조용히 통과한다(멱등).
 * @param {number|undefined} pid
 * @returns {Promise<{killed:boolean, method:string, detail?:string}>}
 */
export async function killProcessTree(pid) {
	if (!pid || !Number.isInteger(pid)) {
		return { killed: false, method: 'noop', detail: 'pid 없음' };
	}
	if (isWin) {
		const r = await run('taskkill', ['/F', '/T', '/PID', String(pid)]);
		// taskkill 은 "프로세스 없음" 이어도 비-0 을 반환할 수 있음 → 멱등 성공으로 간주.
		return { killed: true, method: 'taskkill /F /T', detail: (r.stdout || r.stderr).trim() };
	}
	// POSIX: 프로세스 그룹 → 개별 순.
	try {
		process.kill(-pid, 'SIGKILL');
		return { killed: true, method: 'kill(-pid SIGKILL)' };
	} catch {
		try {
			process.kill(pid, 'SIGKILL');
			return { killed: true, method: 'kill(pid SIGKILL)' };
		} catch (e) {
			return { killed: false, method: 'kill', detail: String(e?.message ?? e) };
		}
	}
}

/**
 * 지정 포트를 LISTEN 중인 PID 목록을 조회한다(pid 트리/그룹 종료가 놓친 잔존 프로세스 대비).
 *  - Windows: `netstat -ano` 파싱(LISTENING + LocalAddress 가 :port).
 *  - POSIX: `lsof -ti :port`.
 * @param {number} port
 * @returns {Promise<number[]>}
 */
export async function pidsOnPort(port) {
	if (isWin) {
		const r = await run('netstat', ['-ano']);
		const pids = new Set();
		for (const line of r.stdout.split(/\r?\n/)) {
			if (!/LISTENING/i.test(line)) continue;
			const cols = line.trim().split(/\s+/);
			const local = cols[1] ?? '';
			const pid = cols[cols.length - 1];
			if (local.endsWith(`:${port}`) && /^\d+$/.test(pid) && pid !== '0') pids.add(Number(pid));
		}
		return [...pids];
	}
	const r = await run('lsof', ['-ti', `:${port}`]);
	return [...new Set(r.stdout.split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number))];
}

/** 포트를 점유한 listener PID 들을 트리째 종료한다(포트 기준 폴백). */
export async function killByPort(port) {
	const pids = await pidsOnPort(port);
	for (const pid of pids) await killProcessTree(pid);
	return pids;
}

/** ms 만큼 대기 (폴링용). */
function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * dev 서버 프로세스 트리를 종료하고, 포트가 실제로 해제됐는지 검증한다.
 * 종료 후 포트가 비워질 때까지 짧게 폴링한다(최대 retries 회).
 * @param {{pid?:number, port:number, child?:import('node:child_process').ChildProcess, retries?:number, intervalMs?:number}} opts
 * @returns {Promise<{killed:object, portFree:boolean, port:number, pid:number|undefined}>}
 */
export async function teardownDevServer({ pid, port, child, retries = 20, intervalMs = 150 }) {
	const effectivePid = pid ?? child?.pid;
	const killed = await killProcessTree(effectivePid);

	// child 핸들이 있으면 detached 참조도 끊어 부모가 매달리지 않게 한다.
	if (child) {
		try {
			child.unref?.();
			if (!child.killed) child.kill?.();
		} catch {
			/* 이미 종료됨 — 무시 */
		}
	}

	// 포트가 free 가 될 때까지 폴링
	let portFree = false;
	for (let i = 0; i < retries; i++) {
		const inUse = await isPortInUse(port, 500);
		if (!inUse) {
			portFree = true;
			break;
		}
		await delay(intervalMs);
	}

	// 폴백(A3): pid 트리 종료가 놓쳤어도 포트가 여전히 점유 중이면, 포트 기준으로 listener 를
	// 찾아 트리째 종료한다(간헐 orphan dev 서버 방지). 종료 후 한 번 더 폴링.
	let portKill = [];
	if (!portFree) {
		portKill = await killByPort(port);
		if (portKill.length) {
			for (let i = 0; i < retries; i++) {
				if (!(await isPortInUse(port, 500))) {
					portFree = true;
					break;
				}
				await delay(intervalMs);
			}
		}
	}

	return { killed, portFree, port, pid: effectivePid, portKill };
}
