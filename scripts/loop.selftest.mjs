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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { specFingerprint } from './lib/plan.mjs';
import { readState, stateFilePath } from './lib/state.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const loopScript = path.join(scriptsDir, 'loop.mjs');

// 셀프테스트 표식 — env 게이트(구식 --init 라벨 시드 등)가 **명시적으로** 열린다.
// invokeLoop 의 자식 프로세스는 process.env 를 상속하므로 여기 한 곳이면 충분하다.
process.env.HARNESS_SELFTEST = '1';

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

// ── 시나리오 E: verify 가 상호작용(E2E) 검증을 실제로 호출한다 ──
console.log('');
console.log('=== loop selftest E: verify → eval-scenario 배선 ===');

// (E-1) 분류: verify 실패인데 결정적 게이트가 green 이면 = 상호작용 결함 → implement
{
	const c = classifyFailure('verify', { passed: true, gates: [{ name: 'test', ok: true }] });
	check('E: verify 실패 + 게이트 green → 구현결함 → implement', c.kind === '구현결함' && c.nextPhase === 'implement');
	check('E: 사유에 상호작용/E2E 명시', /상호작용|E2E/.test(c.why));
}

// (E-2) 통합: verify 페이즈가 eval-scenario.mjs 를 실제로 실행하는가 (마커 파일로 증명)
const tmpDirE = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-e2e-'));
try {
	mkdirSync(path.join(tmpDirE, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpDirE, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpDirE, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	// 통과하는 done-gate 스텁 + 호출되면 마커를 남기는 eval-scenario 스텁
	writeFileSync(path.join(tmpDirE, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	writeFileSync(
		path.join(tmpDirE, 'scripts', 'eval-scenario.mjs'),
		"import { writeFileSync } from 'node:fs';\nwriteFileSync('scenario-was-called.txt', process.argv.slice(2).join(' '));\nprocess.exit(0);\n",
		'utf8',
	);

	invokeLoop(tmpDirE, ['--init', '01-e2e']); // 시드
	// decompose → design → implement → verify 까지 전진
	for (let i = 0; i < 4; i++) invokeLoop(tmpDirE);

	const markerPath = path.join(tmpDirE, 'scenario-was-called.txt');
	check('E: verify 가 eval-scenario 를 실제로 호출함', existsSync(markerPath));
	if (existsSync(markerPath)) {
		const args = readFileSync(markerPath, 'utf8');
		check('E: 사이클 식별자를 --id 로 전달', /--id=scen-step-0-r0/.test(args));
	}
} catch (err) {
	failures.push(`E 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDirE, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

// (E-3) 통합: eval-scenario 가 실패하면 verify 가 통과하지 않는다
const tmpDirF = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-e2efail-'));
try {
	mkdirSync(path.join(tmpDirF, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpDirF, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpDirF, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpDirF, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	writeFileSync(path.join(tmpDirF, 'scripts', 'eval-scenario.mjs'), 'process.exit(1);\n', 'utf8'); // 단언 실패

	invokeLoop(tmpDirF, ['--init', '01-e2e-fail']);
	for (let i = 0; i < 3; i++) invokeLoop(tmpDirF); // decompose→design→implement, 다음이 verify
	const vr = invokeLoop(tmpDirF); // verify 실행 → 실패해야 함
	const stF = readState(stateFilePath(tmpDirF));
	check('E: 상호작용 실패 시 verify 에서 전진하지 않음', stF.phase === 'verify');
	check('E: 실패 카운터 증가', (stF.failures?.verify ?? 0) >= 1);
	check('E: 로그에 상호작용 단언 실패 표기', /eval-scenario|상호작용/.test(vr.stdout));
} catch (err) {
	failures.push(`F 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpDirF, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

// ── 시나리오 G: 2차 자기진단 반영 — evaluate 코드 강제 · E2E 검증불가 차단 · 크래시 재개 ──
console.log('');
console.log('=== loop selftest G: fail-open 반전 + evaluate 강제 ===');

// (G-1) 분류: E2E 검증 불가는 단언 실패와 다르게 라우팅된다
{
	const spec = classifyFailure('verify', { passed: true, gates: [] }, { e2e: 'unverifiable', unverifiable: 'no-spec' });
	check('G: 스펙 부재 → 설계결함 → design (AC 를 정의해야 함)', spec.kind === '설계결함' && spec.nextPhase === 'design');
	const boot = classifyFailure('verify', { passed: true, gates: [] }, { e2e: 'unverifiable', unverifiable: 'server-not-ready' });
	check('G: 서버 미기동 → 구현결함 → implement', boot.kind === '구현결함' && boot.nextPhase === 'implement');
	const assertFail = classifyFailure('verify', { passed: true, gates: [] }, { e2e: 'assert' });
	check('G: 단언 실패 → 구현결함 → implement (기존 동작 유지)', assertFail.kind === '구현결함' && assertFail.nextPhase === 'implement');
	const evalDefect = classifyFailure('evaluate', null, { evaluate: 'no-artifact' });
	check('G: 평가 산출물 미생성 → 검증결함 → evaluate', evalDefect.kind === '검증결함' && evalDefect.nextPhase === 'evaluate');
}

// (G-2) 통합: eval-scenario 가 exit 2(검증 불가)면 verify 에서 전진하지 않는다
const tmpG1 = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-unverifiable-'));
try {
	mkdirSync(path.join(tmpG1, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpG1, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpG1, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpG1, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	// 스펙이 없는 상황을 흉내내는 스텁. 실제 러너의 계약을 그대로 따른다:
	//   --preflight → preflight.json 에 원인 기록 후 exit 2 (scenario.json 은 쓰지 않는다)
	//   그 외      → scenario.json 에 기록 후 exit 2
	writeFileSync(
		path.join(tmpG1, 'scripts', 'eval-scenario.mjs'),
		[
			"import { mkdirSync, writeFileSync } from 'node:fs';",
			"const argv = process.argv.slice(2);",
			"const id = (argv.find((a) => a.startsWith('--id=')) ?? '--id=x').slice('--id='.length);",
			"mkdirSync(`harness/evaluations/${id}`, { recursive: true });",
			"const payload = JSON.stringify({ ok: false, passed: false, unverifiable: 'no-spec', reason: '스펙 파일 없음' });",
			"const file = argv.includes('--preflight') ? 'preflight.json' : 'scenario.json';",
			'writeFileSync(`harness/evaluations/${id}/${file}`, payload);',
			'process.exit(2);',
		].join('\n') + '\n',
		'utf8',
	);

	invokeLoop(tmpG1, ['--init', '01-unverifiable']);
	for (let i = 0; i < 3; i++) invokeLoop(tmpG1); // decompose→design→implement
	const vr = invokeLoop(tmpG1); // verify
	const stG1 = readState(stateFilePath(tmpG1));
	check('G: E2E 검증 불가 → verify 에서 전진하지 않음', stG1.phase === 'verify');
	check('G: 실패 카운터 증가', (stG1.failures?.verify ?? 0) >= 1);
	check('G: 로그에 원인 표기', /스펙 파일 없음/.test(vr.stdout));
	check('G: 설계결함으로 분류 표기', /설계결함/.test(vr.stdout));
	// 값싼 프리플라이트가 비싼 게이트보다 **먼저** 차단해야 한다 (게이트를 아예 돌리지 않음).
	check('G: 프리플라이트가 게이트 실행 전에 차단', /프리플라이트 실패\(게이트 실행 전 차단\)/.test(vr.stdout));
} catch (err) {
	failures.push(`G-2 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpG1, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// (G-3) 통합: evaluate 페이즈가 eval-playwright 를 실제로 호출한다 (마커로 증명)
const tmpG2 = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-evaluate-'));
try {
	mkdirSync(path.join(tmpG2, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpG2, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpG2, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpG2, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	writeFileSync(path.join(tmpG2, 'scripts', 'eval-scenario.mjs'), 'process.exit(0);\n', 'utf8');
	// 호출되면 마커 + 이번 사이클 평가 산출물을 남기는 eval-playwright 스텁
	writeFileSync(
		path.join(tmpG2, 'scripts', 'eval-playwright.mjs'),
		[
			"import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';",
			"writeFileSync('playwright-was-called.txt', 'yes');",
			"const st = JSON.parse(readFileSync('harness/state.json', 'utf8'));",
			'const cycleId = `step-${st.currentStepIdx ?? 0}#${st.reworkCount ?? 0}`;',
			"mkdirSync('harness/evaluations', { recursive: true });",
			"writeFileSync('harness/evaluations/eval-0001.json', JSON.stringify({ id: 'eval-0001', score: 100, majorComplaints: 0, cycleId, stepId: `step-${st.currentStepIdx ?? 0}` }));",
			'process.exit(0);',
		].join('\n') + '\n',
		'utf8',
	);

	invokeLoop(tmpG2, ['--init', '01-evaluate']);
	for (let i = 0; i < 4; i++) invokeLoop(tmpG2); // decompose→design→implement→verify
	const er = invokeLoop(tmpG2); // evaluate
	check('G: evaluate 가 eval-playwright 를 실제로 호출함', existsSync(path.join(tmpG2, 'playwright-was-called.txt')));
	check('G: 산출물 확인 로그 표기', /산출물 강제|eval-playwright ok/.test(er.stdout));
	const stG2 = readState(stateFilePath(tmpG2));
	check('G: 평가 산출물이 생겼으므로 debate 로 전진', stG2.phase === 'debate');
} catch (err) {
	failures.push(`G-3 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpG2, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// (G-4) 통합: eval-playwright 가 있는데 산출물이 안 생기면 evaluate 에서 막힌다
const tmpG3 = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-noeval-'));
try {
	mkdirSync(path.join(tmpG3, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpG3, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpG3, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpG3, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	writeFileSync(path.join(tmpG3, 'scripts', 'eval-scenario.mjs'), 'process.exit(0);\n', 'utf8');
	// 아무 산출물도 남기지 않는 평가 스텁 (예전 md-only 상태의 재현)
	writeFileSync(path.join(tmpG3, 'scripts', 'eval-playwright.mjs'), 'process.exit(0);\n', 'utf8');

	invokeLoop(tmpG3, ['--init', '01-noeval']);
	for (let i = 0; i < 4; i++) invokeLoop(tmpG3);
	const er = invokeLoop(tmpG3); // evaluate — 산출물 없음 → 실패
	const stG3 = readState(stateFilePath(tmpG3));
	check('G: 평가 산출물 미생성 → evaluate 에서 전진하지 않음', stG3.phase === 'evaluate');
	check('G: 검증결함으로 분류', /검증결함/.test(er.stdout));
	check('G: 실패 카운터 증가', (stG3.failures?.evaluate ?? 0) >= 1);
} catch (err) {
	failures.push(`G-4 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpG3, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// (G-5) 크래시 재개: 실행 착수만 기록된 상태에서 재호출하면 같은 페이즈를 RERUN 한다.
//       (예전에는 needsRerun 의 두 트리거가 드라이버 전이로 도달 불가여서 RERUN 이 한 번도 안 떴다.)
const tmpG4 = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-interrupt-'));
try {
	mkdirSync(path.join(tmpG4, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpG4, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	const statePathG4 = stateFilePath(tmpG4);
	invokeLoop(tmpG4, ['--init', '01-interrupt']);
	const r1 = invokeLoop(tmpG4); // decompose 실행 → design 으로 전진
	check('G: 정상 전진에는 RERUN 표시가 없다', !/RERUN/.test(r1.stdout));
	// 크래시 시뮬레이션: 착수 기록은 남았지만 전진(advancePhase)이 남지 않은 상태
	const stMid = readState(statePathG4);
	writeFileSync(
		statePathG4,
		JSON.stringify({ ...stMid, lastExecutedPhaseSeq: stMid.phaseSeq, committed: false }, null, 2) + '\n',
		'utf8',
	);
	const r2 = invokeLoop(tmpG4);
	check('G: 실행 중 크래시 상태 → 같은 페이즈 RERUN 표시', /RERUN — 멱등 재개/.test(r2.stdout));
} catch (err) {
	failures.push(`G-5 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpG4, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// ── 시나리오 H: 페이즈 산출물 계약 — 에이전트 페이즈가 증거 없이 전진하지 못한다 (v3 2단계 / F1) ──
//
// 왜 통합으로 보나: `run-cycle.md` 의 "⛔ 에이전트 페이즈를 no-op 로 건너뛰지 않는다" 는 오랫동안
// 검사자가 없는 문장이었다. 순수 함수 테스트(phase-gate.selftest)는 판정만 보고 **배선**은 못 본다 —
// F21(멱등 재개)이 정확히 그렇게 초록인 채 죽어 있었다. 그래서 실제로 loop 를 호출해 **결과**를 본다.
console.log('');
console.log('=== loop selftest H: 페이즈 산출물 계약 ===');
const tmpH = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-contract-'));
try {
	mkdirSync(path.join(tmpH, 'harness'), { recursive: true });
	mkdirSync(path.join(tmpH, 'scripts'), { recursive: true });
	writeFileSync(
		path.join(tmpH, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);
	// 계약을 **활성**으로 만드는 환경 조건: 기록 도구가 저장소에 있다는 표시.
	// (실행은 실제 스크립트를 절대경로로 호출한다 — 임시 cwd 에는 lib/ 가 없으므로 복사본은 동작하지 않는다)
	writeFileSync(path.join(tmpH, 'scripts', 'record-decision.mjs'), '// fixture: 기록 도구 존재 표시\n', 'utf8');
	writeFileSync(path.join(tmpH, 'scripts', 'done-gate.mjs'), 'process.exit(0);\n', 'utf8');
	writeFileSync(path.join(tmpH, 'scripts', 'eval-scenario.mjs'), 'process.exit(0);\n', 'utf8');

	const recorder = path.join(scriptsDir, 'record-decision.mjs');
	const record = (phase, extra = []) =>
		execFileSync('node', [recorder, `--phase=${phase}`, '--topic=t', '--conclusion=c', '--why=w', ...extra], {
			cwd: tmpH,
			encoding: 'utf8',
			stdio: 'pipe',
		});

	invokeLoop(tmpH, ['--init', '01-contract']);

	// (H-1) decompose — 기록이 없으면 전진하지 않는다 (예전엔 무조건 전진했다)
	const h1 = invokeLoop(tmpH);
	let stH = readState(stateFilePath(tmpH));
	check('H: 결정 기록 없음 → decompose 에서 전진하지 않음', stH.phase === 'decompose');
	check('H: 산출물결함으로 분류', /산출물결함/.test(h1.stdout));
	check('H: 실패 카운터 증가', (stH.failures?.decompose ?? 0) >= 1);
	check('H: 조치 명령(record-decision)을 안내', /record-decision\.mjs --phase=decompose/.test(h1.stdout));

	// (H-2) 기록을 남기면 전진한다 — 기록 도구가 사이클 스탬프를 자동으로 찍는다
	record('decompose');
	invokeLoop(tmpH);
	stH = readState(stateFilePath(tmpH));
	check('H: 기록을 남기면 design 으로 전진', stH.phase === 'design');

	// (H-3) design — 스펙·AC 부재는 verify 가 아니라 **design 에서** 막힌다 (implement 낭비 제거)
	const h3 = invokeLoop(tmpH);
	stH = readState(stateFilePath(tmpH));
	check('H: 스펙 없음 → design 에서 차단', stH.phase === 'design');
	check('H: verify 와 동일한 설계결함 분류', /설계결함/.test(h3.stdout));

	// (H-4) 스펙·AC 를 채우면 남는 요구는 설계 결정 기록뿐이다
	writeFileSync(
		path.join(tmpH, 'harness', 'plan.json'),
		JSON.stringify({ steps: [{ label: '01-contract', acceptance: [{ id: 'AC-1', text: '보인다' }] }] }, null, 2),
		'utf8',
	);
	writeFileSync(
		path.join(tmpH, 'harness', 'eval-scenario.json'),
		JSON.stringify({ scenarios: [{ name: 's', ac: 'AC-1', steps: [{ assert: 'textVisible', text: 'x' }] }] }, null, 2),
		'utf8',
	);
	const h4 = invokeLoop(tmpH);
	stH = readState(stateFilePath(tmpH));
	check('H: 스펙은 충족했지만 설계 기록이 없으면 여전히 차단', stH.phase === 'design' && /산출물결함/.test(h4.stdout));

	record('design');
	invokeLoop(tmpH);
	stH = readState(stateFilePath(tmpH));
	check('H: 설계 기록까지 남기면 implement 로 전진', stH.phase === 'implement');

	// (H-5) implement — git 이 없는 환경에서는 코드 검사를 **생략**한다(환경 부재는 skip)
	const h5 = invokeLoop(tmpH);
	stH = readState(stateFilePath(tmpH));
	check('H: git 없는 환경에서는 코드 검사 생략 → 전진', stH.phase === 'verify');
	check('H: 생략 사유를 로그에 남긴다', /코드 변경 검사 생략/.test(h5.stdout));
} catch (err) {
	failures.push(`H 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpH, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// ── 시나리오 I: 스펙 동결 — design 확정 이후 AC/시나리오 변경을 verify 가 잡는다 ──
console.log('');
console.log('=== loop selftest I: 스펙 동결(specFreeze) 대조 ===');
const tmpI = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-freeze-'));
try {
	mkdirSync(path.join(tmpI, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpI, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }) + '\n',
		'utf8',
	);
	writeFileSync(
		path.join(tmpI, 'harness', 'plan.json'),
		JSON.stringify({ steps: [{ label: '01-x', acceptance: [{ id: 'AC-1', text: '보인다' }] }] }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(
		path.join(tmpI, 'harness', 'eval-scenario.json'),
		JSON.stringify({ scenarios: [{ name: 's', ac: 'AC-1', steps: [{ assert: 'textVisible', text: 'x' }] }] }, null, 2) + '\n',
		'utf8',
	);
	const freezeState = (hash) => ({
		planSteps: ['01-x'],
		currentStepIdx: 0,
		phase: 'verify',
		phaseSeq: 4,
		lastExecutedPhaseSeq: 3,
		status: 'running',
		committed: false,
		reworkCount: 0,
		failures: {},
		escalations: 0,
		scores: {},
		specFreeze: { stepId: 'step-0', cycleId: 'step-0#0', hash },
	});

	// (I-1) design 시점과 다른 지문 → 스펙 동결 위반으로 verify 가 차단(재시도 1/3)
	writeFileSync(path.join(tmpI, 'harness', 'state.json'), JSON.stringify(freezeState('위조된-지문')) + '\n', 'utf8');
	const i1 = invokeLoop(tmpI);
	let stI = readState(stateFilePath(tmpI));
	check('I: 동결 지문 불일치 → verify 에서 전진 차단', stI.phase === 'verify' && (stI.failures?.verify ?? 0) === 1);
	check('I: 스펙 동결 위반 사유 노출', /스펙 동결 위반/.test(i1.stdout));
	check('I: 설계결함 분류(재시도 한도 후 design 으로)', /design/.test(i1.stdout));

	// (I-2) 실제 지문으로 동결하면 verify 는 통과한다 (임시 cwd — 게이트 도구 부재는 종전대로 skip)
	const fp = specFingerprint(tmpI, { label: '01-x', idx: 0 });
	check('I: specFingerprint 는 plan 이 있으면 present=true', fp.present === true && typeof fp.hash === 'string');
	writeFileSync(path.join(tmpI, 'harness', 'state.json'), JSON.stringify(freezeState(fp.hash)) + '\n', 'utf8');
	invokeLoop(tmpI);
	stI = readState(stateFilePath(tmpI));
	check('I: 동결 지문 일치 → verify 통과(evaluate 로 전진)', stI.phase === 'evaluate');
} catch (err) {
	failures.push(`I 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpI, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

// ── 시나리오 J: 최종 수용 게이트 — 모든 step 병합 후에도 계획 전체가 덮여야 done ──
console.log('');
console.log('=== loop selftest J: 최종 수용 게이트(checkFinalAcceptance) ===');
const tmpJ = mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-final-'));
try {
	mkdirSync(path.join(tmpJ, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpJ, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }) + '\n',
		'utf8',
	);
	writeFileSync(
		path.join(tmpJ, 'harness', 'plan.json'),
		JSON.stringify({ steps: [{ label: '01-x', acceptance: [{ id: 'AC-1', text: '보인다' }] }] }, null, 2) + '\n',
		'utf8',
	);
	const mergeState = () => ({
		planSteps: ['01-x'],
		currentStepIdx: 0,
		phase: 'merge',
		phaseSeq: 7,
		lastExecutedPhaseSeq: 6,
		status: 'running',
		committed: false,
		reworkCount: 0,
		failures: {},
		escalations: 0,
		scores: {},
	});

	// (J-1) AC-1 을 덮는 단언이 없음 → done 으로 위장하지 않고 blocked + 이유
	writeFileSync(path.join(tmpJ, 'harness', 'eval-scenario.json'), JSON.stringify({ scenarios: [], skipReason: '면제 주장' }) + '\n', 'utf8');
	writeFileSync(path.join(tmpJ, 'harness', 'state.json'), JSON.stringify(mergeState()) + '\n', 'utf8');
	const j1 = invokeLoop(tmpJ);
	let stJ = readState(stateFilePath(tmpJ));
	check('J: 미검증 AC 존재 → status=blocked (done 위장 금지)', stJ.status === 'blocked');
	check('J: blockedReason 에 최종 수용 사유', /최종 수용/.test(stJ.blockedReason ?? ''));
	check('J: exit 3 (blocked 비정상 종료)', j1.code === 3);

	// (J-2) 모든 AC 가 덮이면 done 으로 마감한다
	writeFileSync(
		path.join(tmpJ, 'harness', 'eval-scenario.json'),
		JSON.stringify({ scenarios: [{ name: 's', ac: 'AC-1', steps: [{ assert: 'textVisible', text: 'x' }] }] }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(tmpJ, 'harness', 'state.json'), JSON.stringify(mergeState()) + '\n', 'utf8');
	const j2 = invokeLoop(tmpJ);
	stJ = readState(stateFilePath(tmpJ));
	check('J: 전 AC 덮임 → status=done 정상 마감', stJ.status === 'done' && j2.code === 0);
} catch (err) {
	failures.push(`J 예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmpJ, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
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
