#!/usr/bin/env node
// loop.selftest.mjs — loop.mjs 재호출 드라이버 자가검증 (US-007)
//
// 실행: node scripts/loop.selftest.mjs
// os.tmpdir 의 임시 작업 디렉터리에서 loop.mjs 를 자식 프로세스로 "여러 번" 호출하여
// (각 호출 = 턴 경계 시뮬레이션) decompose→...→merge→done 으로 전진하고 상태가
// 호출 사이에 영속됨을 검증합니다. 성공 시 'LOOP SELFTEST: PASS' + exit 0.
//
// 임시 cwd 에는 scripts/done-gate.mjs / scripts/git-flow.mjs 가 없으므로
// verify/merge 결정적 페이즈는 no-op 통과 처리되어, 시퀀싱만 순수하게 검증됩니다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHASE_ORDER } from './loop.mjs';
import { readState, stateFilePath } from './lib/state.mjs';

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

/** 임시 cwd 에서 loop.mjs 1회 호출 (실제 turn boundary 시뮬레이션) → {code, stdout} */
function invokeLoop(cwd, args = []) {
	try {
		const stdout = execFileSync('node', [loopScript, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.status ?? 1, stdout: (err.stdout || '').toString() };
	}
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-'));
try {
	console.log('=== loop selftest (임시 cwd, loop.mjs 를 자식으로 N회 호출) ===');
	// harness/config.json: skipGitFlow=true 로 git-flow 우회 (merge 안전)
	mkdirSync(path.join(tmpDir, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpDir, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);

	const statePath = stateFilePath(tmpDir);

	// stdout 의 "executed: <phase>" 라인에서 이번 호출이 실제로 실행한 페이즈를 추출
	function parseExecuted(stdout) {
		const m = /executed:\s*([a-z]+)/.exec(stdout);
		return m ? m[1] : null;
	}

	// 1) 첫 호출 + --init 으로 1 step 시드 → status init→running, 첫 페이즈 decompose 실행
	const first = invokeLoop(tmpDir, ['--init', '01-demo']);
	check('첫 호출 exit 0', first.code === 0);
	let st = readState(statePath);
	check('상태 파일 생성됨', st !== null);
	check('planSteps 1개 시드', Array.isArray(st.planSteps) && st.planSteps.length === 1);
	check('첫 호출에서 decompose 실행됨', parseExecuted(first.stdout) === PHASE_ORDER[0]);
	check('첫 호출 후 다음 페이즈 design 으로 전진', st.phase === PHASE_ORDER[1]);
	check('status running', st.status === 'running');

	// 2) 호출을 반복하며 실제 실행된 페이즈를 수집 → decompose..merge 전부 한 번씩 실행되고
	//    merge 후 다음 호출에서 status=done 으로 전이해야 함 (각 호출 = 턴 경계 시뮬레이션).
	const executed = [parseExecuted(first.stdout)];
	const maxCalls = PHASE_ORDER.length + 3; // 여유분
	let doneSeen = false;
	for (let i = 0; i < maxCalls; i++) {
		const r = invokeLoop(tmpDir);
		check(`반복 호출 ${i + 1} exit 0`, r.code === 0);
		const ex = parseExecuted(r.stdout);
		if (ex) executed.push(ex);
		st = readState(statePath);
		if (st.status === 'done') {
			doneSeen = true;
			break;
		}
	}

	check('최종 status=done 도달', doneSeen === true);
	check('phaseSeq 단조 증가(>0)', st.phaseSeq > 0);

	// 3) decompose→design→implement→verify→evaluate→debate→merge 가 순서대로 실행되었는지
	check('실행 페이즈 시퀀스가 PHASE_ORDER 와 일치', JSON.stringify(executed) === JSON.stringify(PHASE_ORDER));
	for (const p of PHASE_ORDER) {
		check(`페이즈 '${p}' 실행됨`, executed.includes(p));
	}

	// 4) 상태가 호출 사이에 영속 — cycles 로그가 누적되었는지 (에이전트 페이즈 4종 + 결정적)
	const cyclesLog = path.join(tmpDir, 'harness', 'cycles', 'cycle-log.ndjson');
	let cycleLines = 0;
	try {
		cycleLines = readFileSync(cyclesLog, 'utf8').trim().split('\n').filter(Boolean).length;
	} catch {
		cycleLines = 0;
	}
	check('cycles 로그에 엔트리 누적됨(>=4)', cycleLines >= 4);

	// 5) done 이후 재호출은 멱등 (status 유지, 추가 전진 없음)
	const afterDone = invokeLoop(tmpDir);
	check('done 이후 재호출 exit 0', afterDone.code === 0);
	const stFinal = readState(statePath);
	check('done 이후 status 유지', stFinal.status === 'done');
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
	console.log('LOOP SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`LOOP SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
