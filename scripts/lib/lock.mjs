// lock.mjs — 드라이버 단일 실행 잠금 (single-writer)
//
// 조직 가이드(AI 에이전트 조직 가이드)의 두 원칙을 이식한다:
//   • 조율 허브(PM/드라이버)는 프로젝트당 하나 — 두 드라이버가 동시에 돌면
//     state.json 의 read-modify-write 가 겹쳐 마지막 쓰기가 이긴다(정본 오염).
//   • 모든 조율은 흔적을 남긴다 — 잠금 파일 자체가 "누가(pid)·언제" 를 기록하는 원장이다.
//
// 동작:
//   acquireLock : harness/state.lock 을 배타적(wx)으로 생성. 이미 있으면
//                 보유 pid 생존 + 나이(LOCK_STALE_MS)를 검사해 죽은/썩은 잠금은 인수(takeover).
//   releaseLock : 내 pid 가 보유한 잠금만 삭제(남의 잠금은 건드리지 않는다).
//
// 주의: 잠금은 loop.mjs 의 CLI 경로(main)에서만 사용한다. selftest 는 runOnce 를
// 직접 import 하므로 결정성에 영향이 없다. 타임스탬프는 stale 판정용 런타임 값이며
// checkpointToken 류의 결정적 식별자에는 쓰이지 않는다.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 잠금이 이 시간보다 오래됐고 보유 프로세스가 죽었으면 썩은 잠금으로 보고 인수한다. */
export const LOCK_STALE_MS = 15 * 60 * 1000; // 15분 — 한 페이즈(게이트 4종 + E2E) 상한보다 넉넉히

export function lockFilePath(repoRoot) {
	return path.join(repoRoot, 'harness', 'state.lock');
}

/** pid 가 살아 있는가. EPERM 은 "존재하지만 권한 없음" 이므로 살아 있음으로 본다. */
function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code === 'EPERM';
	}
}

/**
 * 드라이버 잠금을 획득한다.
 * @param {string} repoRoot
 * @param {{holder?: string}} [opts] holder — 잠금 원장에 남길 보유자 라벨
 * @returns {{ok:true, path:string} | {ok:false, pid?:number, holder?:string, acquiredAt?:string, path:string}}
 */
export function acquireLock(repoRoot, { holder = 'loop' } = {}) {
	const p = lockFilePath(repoRoot);
	mkdirSync(path.dirname(p), { recursive: true });
	// 최대 2회: (1) 생성 시도 → EEXIST 면 썩은 잠금 인수 후 (2) 재시도.
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(
				p,
				JSON.stringify({ pid: process.pid, holder, acquiredAt: new Date().toISOString() }, null, 2) + '\n',
				{ flag: 'wx' },
			);
			return { ok: true, path: p };
		} catch (err) {
			if (err?.code !== 'EEXIST') throw err;
			let info = null;
			try {
				info = JSON.parse(readFileSync(p, 'utf8'));
			} catch {
				info = null; // 깨진 잠금 파일 → 썩은 것으로 취급
			}
			const age = info?.acquiredAt ? Date.now() - Date.parse(info.acquiredAt) : Number.POSITIVE_INFINITY;
			const alive = pidAlive(info?.pid);
			if (!alive || !(age < LOCK_STALE_MS)) {
				try {
					rmSync(p, { force: true });
				} catch {
					/* 경합 삭제 — 다음 시도에서 판정 */
				}
				continue;
			}
			return { ok: false, pid: info?.pid, holder: info?.holder, acquiredAt: info?.acquiredAt, path: p };
		}
	}
	return { ok: false, path: p };
}

/**
 * 내 pid 가 보유한 잠금을 해제한다. 남의 잠금이면 건드리지 않는다.
 * @returns {boolean} 해제했으면 true
 */
export function releaseLock(repoRoot) {
	const p = lockFilePath(repoRoot);
	let info = null;
	try {
		info = JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return false;
	}
	if (info?.pid !== process.pid) return false;
	try {
		rmSync(p, { force: true });
		return true;
	} catch {
		return false;
	}
}
