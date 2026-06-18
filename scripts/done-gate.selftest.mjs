#!/usr/bin/env node
// done-gate.selftest.mjs — done-gate.mjs 히스테리시스+래치 자가검증 (US-007)
//
// 실행: node scripts/done-gate.selftest.mjs
// 실제 yarn 게이트를 돌리지 않고(주입 점수 + 결정적부 stub), os.tmpdir 임시 상태에서만
// 히스테리시스/래치 규칙을 검증합니다. 성공 시 'DONEGATE SELFTEST: PASS' + exit 0.
//
// 검증 시나리오 (no-flap):
//   1) score=91 / major=0  → 통과 + 래치(latched=true)
//   2) score=89 / major=0  → 여전히 통과 (래치됨, hold band 88~90 안 → no-flap)
//   3) score=87 / major=0  → 탈락 (HOLD(88) 미만 → 래치 해제)
//   4) 88~90 경계에서 래치 후 반복 평가해도 플래핑 없음
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runDoneGate, evaluateHysteresis, ENTER_THRESHOLD, HOLD_THRESHOLD } from './done-gate.mjs';
import { defaultState, readState, stateFilePath, writeState } from './lib/state.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

/** 임시 repoRoot 에 harness/state.json 을 시드하고, 주입 점수로 done-gate 를 1회 실행 */
function runGateInjected(repoRoot, score, major) {
	const opts = {
		json: true,
		deterministicOnly: false,
		skipDeterministic: true, // 실제 yarn 게이트 미실행
		score,
		majorComplaints: major,
		stepId: undefined,
	};
	return runDoneGate(opts, repoRoot);
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'donegate-selftest-'));
try {
	console.log(`=== done-gate selftest (ENTER=${ENTER_THRESHOLD}, HOLD=${HOLD_THRESHOLD}) ===`);

	// 임계치 상수 sanity
	check('ENTER > HOLD (히스테리시스 폭 양수)', ENTER_THRESHOLD > HOLD_THRESHOLD);

	// 순수 함수(evaluateHysteresis) 단위 검증 — I/O 없이 규칙만
	check('미래치 91/0 → 진입 통과+래치', (() => {
		const r = evaluateHysteresis({ score: 91, majorComplaints: 0 }, false);
		return r.pass === true && r.latched === true;
	})());
	check('미래치 89/0 → 미진입(최초 진입은 ENTER 필요)', (() => {
		const r = evaluateHysteresis({ score: 89, majorComplaints: 0 }, false);
		return r.pass === false && r.latched === false;
	})());
	check('래치 89/0 → hold band 유지 통과(no-flap)', (() => {
		const r = evaluateHysteresis({ score: 89, majorComplaints: 0 }, true);
		return r.pass === true && r.latched === true;
	})());
	check('래치 87/0 → HOLD 미만 탈락+래치해제', (() => {
		const r = evaluateHysteresis({ score: 87, majorComplaints: 0 }, true);
		return r.pass === false && r.latched === false;
	})());
	check('래치 95 + major 1 → major 있으면 즉시 탈락', (() => {
		const r = evaluateHysteresis({ score: 95, majorComplaints: 1 }, true);
		return r.pass === false && r.latched === false;
	})());

	// 통합 검증 — 상태 영속(state.scores[stepId].latched) 을 통한 시나리오
	const statePath = stateFilePath(tmpDir);
	const seed = defaultState(['01-demo']);
	seed.status = 'running';
	seed.phase = 'evaluate';
	seed.currentStepIdx = 0;
	writeState(statePath, seed);

	// 1) 91/0 → 통과 + 래치 기록
	const r1 = runGateInjected(tmpDir, 91, 0);
	check('[1] 91/0 exitCode 0 (통과)', r1.exitCode === 0);
	check('[1] hysteresis.pass=true', r1.result.hysteresis.pass === true);
	const after1 = readState(statePath);
	const stepId = r1.result.stepId;
	check('[1] state.scores[stepId].latched=true 영속', after1.scores[stepId]?.latched === true);

	// 2) 89/0 → 래치 유지로 여전히 통과 (no-flap)
	const r2 = runGateInjected(tmpDir, 89, 0);
	check('[2] 89/0 exitCode 0 (래치 유지 통과)', r2.exitCode === 0);
	check('[2] hysteresis.pass=true (hold band)', r2.result.hysteresis.pass === true);
	const after2 = readState(statePath);
	check('[2] latched 여전히 true', after2.scores[stepId]?.latched === true);

	// 3) 87/0 → HOLD(88) 미만 탈락
	const r3 = runGateInjected(tmpDir, 87, 0);
	check('[3] 87/0 exitCode 1 (탈락)', r3.exitCode === 1);
	check('[3] hysteresis.pass=false', r3.result.hysteresis.pass === false);
	const after3 = readState(statePath);
	check('[3] latched 해제(false)', after3.scores[stepId]?.latched === false);

	// 4) 88~90 경계 플래핑 부재: 재진입(91)→89→88→89 반복해도 일관되게 통과 유지
	runGateInjected(tmpDir, 91, 0); // 재진입+래치
	const seq = [89, 88, 90, 89, 88];
	let flapping = false;
	for (const s of seq) {
		const r = runGateInjected(tmpDir, s, 0);
		if (r.exitCode !== 0) flapping = true; // 래치 후 88~90 은 항상 통과여야 함
	}
	check('[4] 88~90 경계 반복 평가에서 플래핑 없음(항상 통과)', !flapping);

	// 5) 래치 후 87 로 떨어지면 탈락(경계 아래는 정상 탈락)
	const r5 = runGateInjected(tmpDir, 87, 0);
	check('[5] 래치 후 87 → 탈락(exitCode 1)', r5.exitCode === 1);

	// 6) freshness 게이트 — 파일 기반 평가는 현재 step 의 것이어야 통과 (stale 가짜 통과 차단)
	const evalDir = path.join(tmpDir, 'harness', 'evaluations');
	mkdirSync(evalDir, { recursive: true });
	// (a) stepId 없는 stale 평가(score 100) → 거부
	writeFileSync(path.join(evalDir, 'eval-0001.json'), JSON.stringify({ id: 'eval-0001', score: 100, majorComplaints: 0 }) + '\n', 'utf8');
	const rStale = runDoneGate({ json: true, skipDeterministic: true }, tmpDir);
	check('[6a] stepId 없는 stale 평가(100) → 거부(exit 1)', rStale.exitCode === 1);
	check('[6a] 거부 사유에 "stale 평가 거부" 표기', /stale 평가 거부/.test(rStale.result.hysteresis?.reason ?? ''));
	// (b) 현재 step(step-0) 의 신선한 평가(95) → 통과
	writeFileSync(path.join(evalDir, 'eval-0002.json'), JSON.stringify({ id: 'eval-0002', stepId: 'step-0', score: 95, majorComplaints: 0 }) + '\n', 'utf8');
	const rFresh = runDoneGate({ json: true, skipDeterministic: true }, tmpDir);
	check('[6b] 현재 step(step-0) 신선 평가(95) → 통과(exit 0)', rFresh.exitCode === 0);
	check('[6b] 평가 source=file 로 채택', rFresh.result.evaluation?.source === 'file');
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
	console.log('DONEGATE SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`DONEGATE SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
