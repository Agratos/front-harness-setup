#!/usr/bin/env node
// resume.selftest.mjs — 멱등 재개(idempotent resume) 자가검증 (US-010, AC5)
//
// 실행: node scripts/resume.selftest.mjs
//
// 무엇을 검증하나:
//   "state 가 진실, 미커밋이면 재실행" 정책(scripts/lib/state.mjs needsRerun + loop.mjs runOnce)
//   에 따라, 사이클 도중 크래시(= 페이즈는 done 표시인데 committed=false) 후 드라이버를
//   "다시 호출(=다음 턴)" 하면 해당 페이즈를 **건너뛰지 않고 재실행(RERUN)** 하는지,
//   그리고 phaseSeq / checkpointToken 이 재호출(턴 경계) 사이에 올바르게 전진하는지 확인합니다.
//
// 어떻게:
//   os.tmpdir 의 임시 cwd 에서 loop.mjs 를 자식 프로세스로 호출합니다(실제 turn boundary 시뮬레이션).
//   임시 cwd 에는 done-gate.mjs / git-flow.mjs 가 없으므로 verify/merge 결정적 페이즈는
//   no-op 통과 처리되어, 재개 시퀀싱만 순수하게 검증됩니다.
//   실제 harness/state.json 은 절대 건드리지 않습니다.
//
// 성공: 'RESUME SELFTEST: PASS' + exit 0 / 실패: 실패 목록 + exit 1. 임시 자원은 모두 정리.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { advancePhase, defaultState, needsRerun, readState, stateFilePath, writeState } from './lib/state.mjs';
import { PHASE_ORDER } from './loop.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const loopScript = path.join(scriptsDir, 'loop.mjs');

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

/** 임시 cwd 에서 loop.mjs 1회 호출 (turn boundary 시뮬레이션) → {code, stdout}. */
function invokeLoop(cwd, args = []) {
	try {
		const stdout = execFileSync('node', [loopScript, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.status ?? 1, stdout: (err.stdout || '').toString() };
	}
}

/** stdout 의 "executed: <phase> (RERUN ...)" 라인 파싱 → {phase, rerun}. */
function parseExecuted(stdout) {
	const m = /executed:\s*([a-z]+)(\s*\(RERUN)?/.exec(stdout);
	return m ? { phase: m[1], rerun: Boolean(m[2]) } : { phase: null, rerun: false };
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'resume-selftest-'));
try {
	console.log('=== resume selftest (US-010) — 임시 cwd, loop.mjs 를 자식으로 호출 ===');

	// harness/config.json: skipGitFlow=true 로 git-flow 우회 (merge 안전, 실제 git 미사용).
	mkdirSync(path.join(tmpDir, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpDir, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);

	const statePath = stateFilePath(tmpDir);

	// ───────────────────────── [A] 순수 단위: needsRerun 판정 ─────────────────────────
	console.log('[A] needsRerun — 미커밋 + 페이즈 done 표시 → 재실행 필요');
	// planSteps 소진(currentStepIdx >= length) + committed=false + status!=='done' 인 크래시 상태.
	const crashed = {
		...defaultState(['01-demo']),
		status: 'running',
		phase: 'merge',
		phaseSeq: 7,
		currentStepIdx: 1, // length(1) 이상 → "phase done" 으로 간주
		committed: false,
		checkpointToken: '7-merge-0',
	};
	check('[A] needsRerun(크래시 상태)=true (미커밋이라 재실행 필요)', needsRerun(crashed) === true);
	check('[A] needsRerun(커밋 완료 상태)=false', needsRerun({ ...crashed, committed: true }) === false);

	// ───────────────────────── [B] 통합: 크래시 상태에서 드라이버 재호출 → RERUN ─────────────────────────
	console.log('[B] 크래시 상태 주입 후 loop.mjs 재호출 → 같은 페이즈 RERUN (건너뛰지 않음)');

	// implement 페이즈를 막 마쳤으나(다음=verify 로 전진했어야) commit 직전 크래시한 상황을 모사:
	//   state 는 'verify' 페이즈인데 committed=false 이고, 이 페이즈가 done 으로 간주되도록
	//   planSteps 를 소진시킨다(단일 step, currentStepIdx=1).
	const beforeCrash = {
		...defaultState(['01-demo']),
		status: 'running',
		phase: 'verify',
		phaseSeq: 4,
		currentStepIdx: 1, // length(1) 이상 → needsRerun 트리거
		committed: false,
		checkpointToken: '4-verify-0',
	};
	writeState(statePath, beforeCrash);
	check('[B] 크래시 상태 기록 확인 (committed=false)', readState(statePath).committed === false);

	// 1차 재호출(턴 N): 같은 verify 페이즈를 RERUN 해야 한다(advance 전, rerun 플래그 true).
	const r1 = invokeLoop(tmpDir);
	check('[B] 1차 재호출 exit 0', r1.code === 0);
	const ex1 = parseExecuted(r1.stdout);
	check('[B] 재실행된 페이즈 = verify (건너뛰지 않음)', ex1.phase === 'verify');
	check('[B] RERUN 플래그 표시됨 (멱등 재개)', ex1.rerun === true);
	check('[B] 재호출 출력에 "RERUN — 멱등 재개" 문구', /RERUN — 멱등 재개/.test(r1.stdout));

	// 재호출 후: verify 가 멱등 재실행되고 다음 페이즈(evaluate)로 전진했는지.
	const stAfter1 = readState(statePath);
	const verifyIdx = PHASE_ORDER.indexOf('verify');
	check('[B] 재실행 후 다음 페이즈(evaluate)로 전진', stAfter1.phase === PHASE_ORDER[verifyIdx + 1]);

	// ───────────────────────── [C] phaseSeq / checkpointToken 단조 전진 ─────────────────────────
	console.log('[C] phaseSeq / checkpointToken 이 재호출(턴 경계) 사이에 올바르게 전진');
	const seqAfter1 = stAfter1.phaseSeq;
	const tokenAfter1 = stAfter1.checkpointToken;
	check('[C] 재실행 후 phaseSeq 증가 (4 → >4)', seqAfter1 > 4);
	check('[C] checkpointToken 재생성됨 (이전과 다름)', tokenAfter1 !== '4-verify-0');
	check('[C] checkpointToken 형식 = <phaseSeq>-<phase>-<counter>', tokenAfter1 === `${seqAfter1}-${stAfter1.phase}-0`);

	// 2차 재호출(턴 N+1): 더 전진하며 phaseSeq 단조 증가, checkpointToken 갱신.
	const r2 = invokeLoop(tmpDir);
	check('[C] 2차 재호출 exit 0', r2.code === 0);
	const stAfter2 = readState(statePath);
	check('[C] 2차 호출 후 phaseSeq 추가 증가 (단조)', stAfter2.phaseSeq > seqAfter1);
	check('[C] 2차 호출 후 checkpointToken 갱신', stAfter2.checkpointToken !== tokenAfter1);
	check(
		'[C] 2차 checkpointToken 형식 일관',
		stAfter2.checkpointToken === `${stAfter2.phaseSeq}-${stAfter2.phase}-0`,
	);

	// ───────────────────────── [D] 멱등성: 동일 미커밋 상태 재주입 → 동일 페이즈 재실행 ─────────────────────────
	console.log('[D] 멱등성 — 같은 미커밋 크래시 상태를 다시 주입하면 같은 페이즈를 또 재실행');
	// advancePhase 로 새 페이즈(implement)를 만들고, 다시 committed=false + 소진 상태로 강제.
	const reCrash = {
		...advancePhase({ ...beforeCrash, currentStepIdx: 1 }, 'implement'),
		status: 'running',
		currentStepIdx: 1,
		committed: false,
	};
	writeState(statePath, reCrash);
	const seqBeforeD = reCrash.phaseSeq;
	const d1 = invokeLoop(tmpDir);
	const exD1 = parseExecuted(d1.stdout);
	check('[D] 첫 재주입 → implement RERUN', exD1.phase === 'implement' && exD1.rerun === true);

	// 같은 페이즈를 다시 미커밋 상태로 강제(두 번째 크래시) → 또 implement 재실행되어야 함.
	writeState(statePath, { ...reCrash, phaseSeq: seqBeforeD });
	const d2 = invokeLoop(tmpDir);
	const exD2 = parseExecuted(d2.stdout);
	check('[D] 두 번째 재주입 → implement 또 RERUN (멱등, 건너뛰지 않음)', exD2.phase === 'implement' && exD2.rerun === true);
} catch (err) {
	failures.push(`예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

console.log('');
if (failures.length === 0) {
	console.log('RESUME SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`RESUME SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
