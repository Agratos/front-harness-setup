#!/usr/bin/env node
// resume-watch.mjs — **재개 루프의 코드화** (harness/PROGRESS.md 재개 프로토콜의 실행기).
//
// 왜 필요한가:
//   "루프의 지속" 이 오케스트레이터 세션의 생존에 의존했다 — 세션이 멈추면(hang/한도) 루프도 멈추고,
//   재개 프로토콜(/loop 10m + 30분 stale 가드)은 **문서·수동 준수**였다(감사 발견 — 이 저장소의
//   원칙대로면 "md 에 적힌 프로토콜은 검사자가 없으면 지켜지지 않는다").
//   이 스크립트가 그 프로토콜을 코드로 옮긴다: state.json 이 stale(기본 30분)해질 때만 인수해서
//   드라이버(loop.mjs)를 재호출하고, 에이전트 페이즈는 격리 세션 러너(run-phase-session)가 있을 때만
//   대신 수행한다 — 러너가 없으면 "오케스트레이터 필요" 로 멈춰 사람을 부른다(대신 지어내지 않는다).
//
// 안전 규칙 (활성 세션과 충돌하지 않는다):
//   - state.json 갱신이 staleMin(기본 30분) 이내면 **손대지 않는다**(활성 세션 추정).
//   - 드라이버가 잠금(exit 4)을 쥐고 있으면 물러난다.
//   - blocked(exit 3)는 자동으로 --resume 하지 않는다 — 조치 증거 요구는 사람의 몫이다.
//   - 한 tick 의 연속 전진(burst)에는 한도가 있고, phaseSeq 가 안 움직이면 stuck 으로 멈춘다.
//
// 사용:
//   node scripts/resume-watch.mjs --once                # 1회 점검(cron/셀프테스트용)
//   node scripts/resume-watch.mjs --interval-min=10     # 데몬(기본 10분 주기, stale 30분)
//
// 우회 노출(F24 원칙): HARNESS_DRIVER_CMD 는 셀프테스트의 환경 조건이자 우회 경로다 — 로그에 노출된다.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { sessionIsolationActive } from './lib/phase-gate.mjs';
import { readState, stateFilePath } from './lib/state.mjs';
import { PHASE_TOOLS } from './run-phase-session.mjs';

const log = (...a) => console.log('[resume-watch]', ...a);

// 러너가 대신 수행할 수 있는 에이전트 페이즈(= run-phase-session 의 대상).
// evaluate 는 loop 의 runEvaluatePhase 가 산출물 생성을 코드로 강제하므로 드라이버 호출로 충분하다.
const RUNNER_PHASES = new Set(Object.keys(PHASE_TOOLS));

/** state.json 의 마지막 갱신이 staleMin 분 이상 경과했는가. 파일이 없으면 null. */
export function staleness(repoRoot, { nowMs } = {}) {
	const p = stateFilePath(repoRoot);
	if (!existsSync(p)) return null;
	const mtime = statSync(p).mtimeMs;
	return ((nowMs ?? Date.now()) - mtime) / 60_000; // 분
}

/** 드라이버(loop.mjs) 1회 호출 → {code}. HARNESS_DRIVER_CMD 오버라이드는 로그에 노출(F24). */
function runDriver(repoRoot, driverCmd) {
	const custom = driverCmd ?? process.env.HARNESS_DRIVER_CMD;
	if (custom) {
		log(`드라이버(오버라이드 — 셀프테스트 전용, 노출됨): ${custom}`);
		const r = spawnSync(custom, { shell: true, cwd: repoRoot, stdio: 'inherit' });
		return { code: r.status ?? 1 };
	}
	const loopPath = path.join(repoRoot, 'scripts', 'loop.mjs');
	if (!existsSync(loopPath)) return { code: null };
	const r = spawnSync('node', [loopPath], { cwd: repoRoot, stdio: 'inherit' });
	return { code: r.status ?? 1 };
}

/** 격리 페이즈 세션 러너 1회 호출 → {code}. 러너 부재는 호출부가 미리 판단한다. */
function runPhaseRunner(repoRoot) {
	const runnerPath = path.join(repoRoot, 'scripts', 'run-phase-session.mjs');
	const r = spawnSync('node', [runnerPath], { cwd: repoRoot, stdio: 'inherit' });
	return { code: r.status ?? 1 };
}

/**
 * 1회 점검(tick) — 조건이 맞을 때만 인수해서 전진시킨다 (순수하지 않지만 주입 가능: nowMs·driverCmd).
 *
 * @param {string} repoRoot
 * @param {{staleMin?:number, maxBurst?:number, nowMs?:number, driverCmd?:string}} [opts]
 * @returns {{action:string, detail:string, driverRuns:number, runnerRuns:number}}
 *   action: no-state | idle-fresh | done | blocked-wait | resumed-done | blocked |
 *           lock-held | agent-required | runner-failed | stuck | burst-limit | no-driver
 */
export function tick(repoRoot, opts = {}) {
	const staleMin = opts.staleMin ?? 30;
	const maxBurst = opts.maxBurst ?? 20;
	let driverRuns = 0;
	let runnerRuns = 0;
	const out = (action, detail) => ({ action, detail, driverRuns, runnerRuns });

	const st0 = readState(stateFilePath(repoRoot));
	if (!st0) return out('no-state', 'harness/state.json 없음 — 시드 전(인수할 작업 없음)');
	if (st0.status === 'done') return out('done', '이미 status=done — 감시 종료 대상');
	if (st0.status === 'blocked') {
		return out('blocked-wait', `blocked — 자동 재개 금지(조치 후 loop --resume 은 사람 몫): ${st0.blockedReason ?? '사유 미기록'}`);
	}

	const age = staleness(repoRoot, { nowMs: opts.nowMs });
	if (age !== null && age < staleMin) {
		return out('idle-fresh', `state 갱신 ${age.toFixed(1)}분 전 — 활성 세션 추정, 인수하지 않음(기준 ${staleMin}분)`);
	}

	log(`stale 감지(${age?.toFixed(1)}분 ≥ ${staleMin}분) — 인수해서 전진 시도`);
	for (let i = 0; i < maxBurst; i++) {
		const st = readState(stateFilePath(repoRoot));
		if (!st) return out('no-state', '전진 중 state 소실');
		if (st.status === 'done') return out('resumed-done', `모든 step 완료(driver ${driverRuns}회/runner ${runnerRuns}회)`);
		if (st.status === 'blocked') return out('blocked', `blocked 도달 — 사유: ${st.blockedReason ?? '미기록'}`);

		// 에이전트 페이즈: 격리 세션 러너가 있고 옵트인된 경우에만 대신 수행한다.
		// 러너 없이 "대신 판단·기록" 하는 것은 이 하네스가 금지하는 침묵 실패(지어내기)다.
		if (RUNNER_PHASES.has(st.phase)) {
			const runnerPath = path.join(repoRoot, 'scripts', 'run-phase-session.mjs');
			if (!(sessionIsolationActive(repoRoot) && existsSync(runnerPath))) {
				return out(
					'agent-required',
					`페이즈 '${st.phase}' 는 에이전트 몫 — 격리 러너 미가용(sessionIsolation 미설정 또는 러너 없음). 오케스트레이터(/run-cycle)를 호출하세요`,
				);
			}
			const r = runPhaseRunner(repoRoot);
			runnerRuns += 1;
			if (r.code !== 0) return out('runner-failed', `run-phase-session exit ${r.code} — 세션 로그(harness/sessions/) 확인`);
		}

		const before = st.phaseSeq ?? -1;
		const d = runDriver(repoRoot, opts.driverCmd);
		driverRuns += 1;
		if (d.code === null) return out('no-driver', 'scripts/loop.mjs 없음 — 이 저장소는 감시 대상이 아님');
		if (d.code === 4) return out('lock-held', '드라이버 잠금 보유자 존재 — 활성 세션에 양보');
		if (d.code === 3) return out('blocked', '드라이버가 blocked 로 항복(exit 3) — 조치 후 재개는 사람 몫');

		const after = readState(stateFilePath(repoRoot));
		if ((after?.phaseSeq ?? -1) === before && after?.status !== 'done') {
			// 전진 없음 = 계약 미충족 반복 등 — 같은 tick 안에서 무한 재시도하지 않는다.
			return out('stuck', `phaseSeq ${before} 에서 전진 없음(driver ${driverRuns}회) — 원인: 직전 드라이버 로그 확인`);
		}
	}
	return out('burst-limit', `한 tick 전진 한도(${maxBurst}) 도달 — 다음 주기에 계속`);
}

function parseArgs(argv) {
	const o = { once: false, intervalMin: 10, staleMin: 30, maxBurst: 20 };
	for (const a of argv) {
		if (a === '--once') o.once = true;
		else if (a.startsWith('--interval-min=')) o.intervalMin = Number(a.slice('--interval-min='.length));
		else if (a.startsWith('--stale-min=')) o.staleMin = Number(a.slice('--stale-min='.length));
		else if (a.startsWith('--max-burst=')) o.maxBurst = Number(a.slice('--max-burst='.length));
	}
	return o;
}

async function main() {
	const repoRoot = process.cwd();
	const opts = parseArgs(process.argv.slice(2));
	log(`감시 시작 — stale ${opts.staleMin}분 / 주기 ${opts.intervalMin}분${opts.once ? ' / --once(1회 점검)' : ''}`);

	for (;;) {
		const r = tick(repoRoot, { staleMin: opts.staleMin, maxBurst: opts.maxBurst });
		log(`tick: ${r.action} — ${r.detail}`);
		if (opts.once) {
			// cron/셀프테스트용 신호: blocked 계열은 3, 나머지는 0 (점검 자체는 성공)
			process.exit(r.action === 'blocked' || r.action === 'blocked-wait' ? 3 : 0);
		}
		if (r.action === 'done' || r.action === 'resumed-done') {
			log('모든 step 완료 — 감시를 종료합니다');
			process.exit(0);
		}
		await new Promise((res) => setTimeout(res, Math.max(1, opts.intervalMin) * 60_000));
	}
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main().catch((err) => {
		console.error('[resume-watch] 예기치 못한 실패:', err?.stack ?? err);
		process.exit(1);
	});
}
