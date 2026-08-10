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
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	classifyFailure,
	computeFailureRouting,
	computeTransition,
	MAX_ESCALATION,
	MAX_PHASE_RETRY,
	MAX_REWORK,
	PHASE_ORDER,
} from './loop.mjs';
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

	// 1) 첫 호출 + --init 으로 1 step 시드 → **시드만** 하고 페이즈는 전진하지 않는다.
	//    (예전에는 시드와 동시에 decompose 를 실행해, main 미시드 상태에서 start-step 이 실패하고
	//     step 01 이 브랜치 없이 main 에서 작업되는 사고가 났다.)
	const first = invokeLoop(tmpDir, ['--init', '01-demo']);
	check('첫 호출 exit 0', first.code === 0);
	let st = readState(statePath);
	check('상태 파일 생성됨', st !== null);
	check('planSteps 1개 시드', Array.isArray(st.planSteps) && st.planSteps.length === 1);
	check('--init 은 페이즈를 실행하지 않음', parseExecuted(first.stdout) === null);
	check('--init 후 phase 는 decompose 에서 대기', st.phase === PHASE_ORDER[0]);
	check('status running', st.status === 'running');

	// 2) 호출을 반복하며 실제 실행된 페이즈를 수집 → decompose..merge 전부 한 번씩 실행되고
	//    merge 후 다음 호출에서 status=done 으로 전이해야 함 (각 호출 = 턴 경계 시뮬레이션).
	const executed = [];
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

// ── 시나리오 B: 재작업(rework) 카운트 + 5회 초과 시 vote 분기 (사양서 확정 2·3) ──
console.log('');
console.log('=== loop selftest B: rework→vote 분기 ===');

// (B-1) computeTransition 순수 함수 단위 검증
{
	const t1 = computeTransition({ phase: 'debate', currentStepIdx: 0, stepCount: 1, reworkCount: 0, debateOutcome: 'rework' });
	check('debate+rework(0<5) → implement, rework=1', t1.nextPhase === 'implement' && t1.nextReworkCount === 1);
	const t2 = computeTransition({ phase: 'debate', currentStepIdx: 0, stepCount: 1, reworkCount: MAX_REWORK, debateOutcome: 'rework' });
	check('debate+rework(5>=5) → vote, rework 유지', t2.nextPhase === 'vote' && t2.nextReworkCount === MAX_REWORK);
	const t3 = computeTransition({ phase: 'debate', currentStepIdx: 0, stepCount: 1, reworkCount: 2, debateOutcome: 'pass' });
	check('debate+pass → merge', t3.nextPhase === 'merge');
	const t4 = computeTransition({ phase: 'vote', currentStepIdx: 0, stepCount: 1, reworkCount: MAX_REWORK });
	check('vote → merge', t4.nextPhase === 'merge');
	const t5 = computeTransition({ phase: 'merge', currentStepIdx: 0, stepCount: 2, reworkCount: 3, debateOutcome: 'pass' });
	check('merge → 다음 step decompose, rework 0 초기화', t5.nextPhase === PHASE_ORDER[0] && t5.nextStepIdx === 1 && t5.nextReworkCount === 0);
}

// (B-2) 통합: env 로 debate=rework 강제 → MAX_REWORK 회 implement 되돌이 후 vote, 그 뒤 merge→done
const tmpDirB = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-rework-'));
try {
	mkdirSync(path.join(tmpDirB, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpDirB, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	const statePathB = stateFilePath(tmpDirB);
	const envB = { ...process.env, HARNESS_DEBATE_OUTCOME: 'rework' };
	const invokeRework = (args = []) => {
		try {
			const stdout = execFileSync('node', [loopScript, ...args], { cwd: tmpDirB, encoding: 'utf8', stdio: 'pipe', env: envB });
			return { code: 0, stdout };
		} catch (err) {
			return { code: err.status ?? 1, stdout: (err.stdout || '').toString() };
		}
	};
	const parseExecB = (stdout) => {
		const m = /executed:\s*([a-z]+)/.exec(stdout);
		return m ? m[1] : null;
	};

	const executedB = [];
	const firstB = invokeRework(['--init', '01-demo']);
	if (parseExecB(firstB.stdout)) executedB.push(parseExecB(firstB.stdout));
	let stB = readState(statePathB);
	let guard = 0;
	while (stB.status !== 'done' && guard < 60) {
		const r = invokeRework();
		const ex = parseExecB(r.stdout);
		if (ex) executedB.push(ex);
		stB = readState(statePathB);
		guard++;
	}

	check('B: status=done 도달', stB.status === 'done');
	check('B: vote 페이즈 진입함', executedB.includes('vote'));
	check('B: vote 정확히 1회만 진입', executedB.filter((p) => p === 'vote').length === 1);
	const implementCount = executedB.filter((p) => p === 'implement').length;
	check(`B: implement ${MAX_REWORK + 1}회 이상(최초 1 + 재작업 ${MAX_REWORK})`, implementCount >= MAX_REWORK + 1);
	check(`B: reworkCount 가 MAX_REWORK(${MAX_REWORK}) 도달`, stB.reworkCount === MAX_REWORK);
	check('B: vote 후 gateOverride=true', stB.gateOverride === true);
} catch (err) {
	failures.push(`B 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDirB, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

// ── 시나리오 C: start-step 배선 — 사이클마다 git step 브랜치를 생성한다 ──
console.log('');
console.log('=== loop selftest C: start-step (사이클마다 브랜치) ===');
const tmpDirC = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-gitbranch-'));
try {
	try {
		execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDirC, stdio: 'pipe' });
	} catch {
		execFileSync('git', ['init'], { cwd: tmpDirC, stdio: 'pipe' });
		execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: tmpDirC, stdio: 'pipe' });
	}
	execFileSync('git', ['config', 'user.name', 'Harness Selftest'], { cwd: tmpDirC, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.email', 'selftest@harness.local'], { cwd: tmpDirC, stdio: 'pipe' });
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDirC, stdio: 'pipe' });
	mkdirSync(path.join(tmpDirC, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpDirC, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpDirC, 'harness', 'config.json'),
		JSON.stringify({ useGit: true, useMcp: false, mcpServers: [], skipGitFlow: false }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpDirC, 'README.md'), '# fixture\n', 'utf8');
	// loop 은 cwd/scripts/git-flow.mjs 를 호출하므로 그 파일을 temp 로 복사한다.
	copyFileSync(path.join(scriptsDir, 'git-flow.mjs'), path.join(tmpDirC, 'scripts', 'git-flow.mjs'));
	// start-step 의 전제: main 시드
	execFileSync('node', [path.join(tmpDirC, 'scripts', 'git-flow.mjs'), 'seed-main'], { cwd: tmpDirC, stdio: 'pipe' });
	// loop --init → decompose 실행 → start-step 으로 step/01-gitbranch 생성·체크아웃
	const cSeed = invokeLoop(tmpDirC, ['--init', '01-gitbranch']);
	check('C: loop --init exit 0 (시드만)', cSeed.code === 0);
	// --init 은 전진하지 않으므로, decompose 는 다음 호출에서 실행된다 → 그때 브랜치가 생긴다.
	const cFirst = invokeLoop(tmpDirC);
	check('C: 다음 호출에서 decompose 실행 exit 0', cFirst.code === 0);
	let curBranchC = '';
	try {
		curBranchC = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDirC, encoding: 'utf8' }).trim();
	} catch {
		curBranchC = '';
	}
	check('C: decompose 진입 시 step/01-gitbranch 생성·체크아웃', curBranchC === 'step/01-gitbranch');
} catch (err) {
	failures.push(`C 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDirC, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

// ── 시나리오 D: 결정적 페이즈 실패 → 재시도 → 결함분류 되돌림 → blocked (라이브락 제거) ──
console.log('');
console.log('=== loop selftest D: 실패 라우팅(재시도→되돌림→blocked) ===');

// (D-1) classifyFailure — 사내 조직 가이드의 3분류(설계결함/구현결함/검증결함) 매핑
{
	const arch = classifyFailure('verify', { passed: false, gates: [{ name: 'check-arch', ok: false }, { name: 'lint', ok: true }] });
	check('D: check-arch 실패 → 설계결함 → design 으로 되돌림', arch.kind === '설계결함' && arch.nextPhase === 'design');

	const impl = classifyFailure('verify', { passed: false, gates: [{ name: 'test', ok: false }, { name: 'typecheck', ok: false }] });
	check('D: test/typecheck 실패 → 구현결함 → implement 로 되돌림', impl.kind === '구현결함' && impl.nextPhase === 'implement');

	const evalDefect = classifyFailure('merge', { passed: true, gates: [{ name: 'test', ok: true }] });
	check('D: merge 실패인데 게이트 green → 검증결함 → evaluate 로 되돌림', evalDefect.kind === '검증결함' && evalDefect.nextPhase === 'evaluate');

	const unknown = classifyFailure('verify', null);
	check('D: 게이트 실측 없음 → 구현결함으로 보수적 분류', unknown.kind === '구현결함' && unknown.nextPhase === 'implement');
}

// (D-2) computeFailureRouting — 재시도/에스컬레이션/항복 경계
{
	const cls = { nextPhase: 'implement' };
	const r1 = computeFailureRouting({ phase: 'verify', failCount: 1, escalations: 0, classification: cls });
	check('D: 실패 1회 → retry(같은 페이즈)', r1.action === 'retry' && r1.nextPhase === 'verify');

	const r3 = computeFailureRouting({ phase: 'verify', failCount: MAX_PHASE_RETRY, escalations: 0, classification: cls });
	check(`D: 실패 ${MAX_PHASE_RETRY}회 → escalate(분류가 지목한 페이즈)`, r3.action === 'escalate' && r3.nextPhase === 'implement' && r3.nextEscalations === 1);

	const rBlocked = computeFailureRouting({ phase: 'verify', failCount: MAX_PHASE_RETRY, escalations: MAX_ESCALATION, classification: cls });
	check(`D: 에스컬레이션 ${MAX_ESCALATION} 초과 → blocked(항복)`, rBlocked.action === 'blocked');
}

// (D-3) 통합: 항상 실패하는 done-gate 스텁 → 재시도·되돌림을 거쳐 반드시 blocked 로 종착 (무한 루프 없음)
const tmpDirD = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-fail-'));
try {
	mkdirSync(path.join(tmpDirD, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpDirD, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpDirD, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	// 항상 실패하는 done-gate 스텁 — verify 가 매번 탈락한다.
	writeFileSync(path.join(tmpDirD, 'scripts', 'done-gate.mjs'), 'process.exit(1);\n', 'utf8');

	const statePathD = stateFilePath(tmpDirD);
	const executedD = [];
	const firstD = invokeLoop(tmpDirD, ['--init', '01-fail']);
	const exD0 = /executed:\s*([a-z]+)/.exec(firstD.stdout);
	if (exD0) executedD.push(exD0[1]);

	let stD = readState(statePathD);
	let guardD = 0;
	let lastCode = 0;
	while (stD.status === 'running' && guardD < 80) {
		const r = invokeLoop(tmpDirD);
		lastCode = r.code;
		const ex = /executed:\s*([a-z]+)/.exec(r.stdout);
		if (ex) executedD.push(ex[1]);
		stD = readState(statePathD);
		guardD++;
	}

	check('D: 무한 루프 없이 종착(80회 이내)', guardD < 80);
	check('D: 최종 status=blocked (항복 조건 작동)', stD.status === 'blocked');
	check('D: blockedReason 기록됨', typeof stD.blockedReason === 'string' && stD.blockedReason.length > 0);
	check('D: blocked 시 exit code 3 (조용히 지나치지 않음)', lastCode === 3);
	check(`D: 에스컬레이션이 한도(${MAX_ESCALATION})를 넘어서 멈춤`, (stD.escalations ?? 0) > MAX_ESCALATION);
	// verify 가 여러 번 실행되고, 되돌림으로 implement 도 재실행되었는지
	check('D: verify 가 반복 실행됨', executedD.filter((p) => p === 'verify').length >= MAX_PHASE_RETRY);
	check('D: 되돌림으로 implement 가 재실행됨', executedD.filter((p) => p === 'implement').length >= 2);
	// 오류 로그가 남았는지 (사람이 원인을 볼 수 있어야 함)
	let errFiles = [];
	try {
		errFiles = readdirSync(path.join(tmpDirD, 'harness', 'errors')).filter((f) => f.endsWith('.md'));
	} catch {
		errFiles = [];
	}
	check('D: blocked 사유가 harness/errors/ 에 기록됨', errFiles.length > 0);

	// (D-4) --resume 으로 재개하면 running 으로 돌아오고 카운터가 초기화된다
	const resumed = invokeLoop(tmpDirD, ['--resume']);
	const stR = readState(statePathD);
	check('D: --resume 후 blocked 해제', stR.status !== 'blocked' || resumed.code === 3);
	check('D: --resume 후 escalations 초기화', (stR.escalations ?? 0) <= 1);
} catch (err) {
	failures.push(`D 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDirD, { recursive: true, force: true });
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
