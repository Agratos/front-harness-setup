#!/usr/bin/env node
// phase-gate.selftest.mjs — 페이즈 산출물 계약 자가검증 (v3 2단계 / F1)
//
// 실행: node scripts/phase-gate.selftest.mjs
//
// 무엇을 검증하나 (뿌리 패턴 3 "셀프테스트가 배선을 안 본다" 를 의식해 **결과**를 본다):
//   [A] 스탬프 — 마커 형식이 쓰는 쪽/읽는 쪽에서 일치하고, 다른 사이클·페이즈는 증거로 세지 않는다
//   [B] 코드 지문 — harness/·docs/ 변경은 "코드 변경" 으로 세지 않는다 (이게 틀리면 검사가 무의미해진다)
//   [C] 계약 판정 — 증거 부재는 실패, 환경 부재는 skip, 면제는 기록으로만
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { artifactMarker, findPhaseRecord, phaseRecordSession, sessionMarker } from './lib/artifact.mjs';
import { logDecision } from './lib/log.mjs';
import { checkPhaseContract, codeFingerprint, contractActive, PHASE_CONTRACT, sessionIsolationActive } from './lib/phase-gate.mjs';

const failures = [];
function check(label, cond, extra) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
		failures.push(label);
	}
}

/** 계약을 **활성**으로 만드는 최소 환경: 기록 도구가 있다는 표시(실행은 실제 스크립트로 한다). */
function activateContract(dir) {
	mkdirSync(path.join(dir, 'scripts'), { recursive: true });
	writeFileSync(path.join(dir, 'scripts', 'record-decision.mjs'), '// fixture: 기록 도구가 존재함을 표시\n', 'utf8');
}

function writeState(dir, state) {
	mkdirSync(path.join(dir, 'harness'), { recursive: true });
	writeFileSync(path.join(dir, 'harness', 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

const baseState = { currentStepIdx: 0, reworkCount: 0, planSteps: ['01-a'], phase: 'decompose' };

// ── [A] 스탬프: 쓰는 쪽(logDecision) ↔ 읽는 쪽(findPhaseRecord) 일치 ──────────────
console.log('=== phase-gate selftest A: 산출물 스탬프 ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-stamp-'));
	try {
		const file = logDecision(dir, {
			topic: '스탬프 검증',
			conclusion: '기록됨',
			why: '계약 증거',
			cycleId: 'step-0#0',
			phase: 'debate',
		});
		check('logDecision 이 파일을 생성', typeof file === 'string');
		const hit = findPhaseRecord(dir, 'step-0#0', 'debate');
		check('A: 같은 (사이클, 페이즈) 기록을 찾는다', hit.found === true, JSON.stringify(hit));
		check('A: 찾은 경로가 harness/decisions 아래', /^harness\/decisions\//.test(hit.file ?? ''));
		check('A: 다른 페이즈는 증거로 세지 않는다', findPhaseRecord(dir, 'step-0#0', 'design').found === false);
		check('A: 다른 사이클(재작업 회차)은 증거로 세지 않는다', findPhaseRecord(dir, 'step-0#1', 'debate').found === false);
		check('A: 다른 step 은 증거로 세지 않는다', findPhaseRecord(dir, 'step-1#0', 'debate').found === false);

		// 스탬프 없이 기록하면(구 호출부) 계약 증거가 되지 않는다 — 침묵의 통과 방지.
		const plain = mkdtempSync(path.join(os.tmpdir(), 'pg-plain-'));
		try {
			logDecision(plain, { topic: '스탬프 없음', conclusion: 'x', why: 'y' });
			check('A: 스탬프 없는 기록은 증거로 인정되지 않는다', findPhaseRecord(plain, 'step-0#0', 'debate').found === false);
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}
		check('A: 마커 형식 고정', artifactMarker('step-2#1', 'vote') === '<!-- harness:artifact cycleId=step-2#1 phase=vote -->');
	} catch (err) {
		failures.push(`A 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── [B] 코드 지문: harness/·docs/ 변경은 코드 변경이 아니다 ──────────────────────
console.log('');
console.log('=== phase-gate selftest B: 코드 지문(산출물 경로 제외) ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-code-'));
	try {
		check('B: git 저장소가 아니면 null (환경 부재)', codeFingerprint(dir) === null);

		const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
		git(['init', '-q']);
		git(['config', 'user.name', 'Harness Selftest']);
		git(['config', 'user.email', 'selftest@harness.local']);
		git(['config', 'commit.gpgsign', 'false']);
		mkdirSync(path.join(dir, 'src'), { recursive: true });
		mkdirSync(path.join(dir, 'harness'), { recursive: true });
		mkdirSync(path.join(dir, 'docs'), { recursive: true });
		writeFileSync(path.join(dir, 'src', 'app.tsx'), 'export const a = 1;\n', 'utf8');
		git(['add', '-A']);
		git(['commit', '-q', '-m', 'init']);

		const base = codeFingerprint(dir);
		check('B: 커밋 후 지문이 생긴다', typeof base === 'string' && base.length > 0);

		// 산출물 경로만 바뀐 경우 — 하네스는 매 페이즈 harness/ 에 상태·로그를 쓴다.
		// 이것이 "코드 변경" 으로 세어지면 implement 검사가 항상 통과해 무의미해진다.
		writeFileSync(path.join(dir, 'harness', 'state.json'), '{"phase":"implement"}\n', 'utf8');
		writeFileSync(path.join(dir, 'docs', 'note.md'), '# 문서\n', 'utf8');
		check('B: harness/·docs/ 변경은 지문을 바꾸지 않는다', codeFingerprint(dir) === base, `${base} vs ${codeFingerprint(dir)}`);

		// 코드가 바뀌면 지문이 바뀐다 (추적 파일 수정)
		writeFileSync(path.join(dir, 'src', 'app.tsx'), 'export const a = 2;\n', 'utf8');
		const afterEdit = codeFingerprint(dir);
		check('B: 코드 수정은 지문을 바꾼다', afterEdit !== base);

		// 새 파일(미추적)도 코드 변경이다
		writeFileSync(path.join(dir, 'src', 'new.tsx'), 'export const b = 3;\n', 'utf8');
		check('B: 미추적 새 코드 파일도 지문을 바꾼다', codeFingerprint(dir) !== afterEdit);

		// 커밋해도 (HEAD 가 바뀌므로) 지문은 달라진다 — 커밋으로 마감한 작업도 "변경 있음" 이다.
		git(['add', '-A']);
		git(['commit', '-q', '-m', 'feat: work']);
		check('B: 커밋으로 마감한 작업도 지문 변화로 남는다', codeFingerprint(dir) !== base);
	} catch (err) {
		failures.push(`B 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── [C] 계약 판정 ─────────────────────────────────────────────────────────────
console.log('');
console.log('=== phase-gate selftest C: 계약 판정(증거 부재=실패, 환경 부재=skip) ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-contract-'));
	try {
		writeState(dir, baseState);

		// 환경 부재 — 기록 도구가 없으면 계약은 비활성(skip)이다. 스켈레톤·셀프테스트가 막히지 않는다.
		check('C: 기록 도구 없으면 contractActive=false', contractActive(dir) === false);
		const off = checkPhaseContract({ repoRoot: dir, state: baseState, phase: 'decompose' });
		check('C: 계약 비활성이면 skip + 통과', off.ok === true && off.skipped === true);

		activateContract(dir);
		check('C: 기록 도구가 있으면 contractActive=true', contractActive(dir) === true);

		// decompose — 증거 부재는 실패, 되돌릴 곳은 같은 자리
		const before = checkPhaseContract({ repoRoot: dir, state: baseState, phase: 'decompose' });
		check('C: decompose 기록 없음 → 실패', before.ok === false && before.skipped === false);
		check('C: 원인이 decision 산출물로 분류', before.cause?.artifact === 'decision');
		check('C: 조치 명령을 안내한다', /record-decision\.mjs --phase=decompose/.test(before.hint ?? ''));

		logDecision(dir, { topic: 't', conclusion: 'c', why: 'w', cycleId: 'step-0#0', phase: 'decompose' });
		const after = checkPhaseContract({ repoRoot: dir, state: baseState, phase: 'decompose' });
		check('C: 기록을 남기면 통과', after.ok === true && after.skipped === false);

		// 재작업 라운드(step-0#1)에는 이전 회차 기록이 통하지 않는다 — 신선도.
		const reworked = { ...baseState, reworkCount: 1 };
		check('C: 다른 사이클에서는 이전 기록이 통하지 않는다', checkPhaseContract({ repoRoot: dir, state: reworked, phase: 'decompose' }).ok === false);

		// evaluate 는 runEvaluatePhase 가 강제 → 여기서 중복 검사하지 않는다
		const ev = checkPhaseContract({ repoRoot: dir, state: baseState, phase: 'evaluate' });
		check('C: evaluate 는 계약 중복검사 skip', ev.ok === true && ev.skipped === true);

		// 계약이 없는 페이즈(verify/merge)는 통과
		check('C: verify 는 계약 대상 아님', checkPhaseContract({ repoRoot: dir, state: baseState, phase: 'verify' }).skipped === true);
		check('C: PHASE_CONTRACT 에 에이전트 페이즈 5종 + evaluate 선언', Object.keys(PHASE_CONTRACT).length === 6);
	} catch (err) {
		failures.push(`C 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── [C-2] implement 계약: 코드 변경 또는 **명시적 면제 기록** ────────────────────
console.log('');
console.log('=== phase-gate selftest C-2: implement 계약(코드 변경 / 명시 면제) ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-impl-'));
	try {
		activateContract(dir);
		const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
		git(['init', '-q']);
		git(['config', 'user.name', 'Harness Selftest']);
		git(['config', 'user.email', 'selftest@harness.local']);
		git(['config', 'commit.gpgsign', 'false']);
		mkdirSync(path.join(dir, 'src'), { recursive: true });
		writeFileSync(path.join(dir, 'src', 'app.tsx'), 'export const a = 1;\n', 'utf8');
		git(['add', '-A']);
		git(['commit', '-q', '-m', 'init']);

		const entry = codeFingerprint(dir);
		const st = { ...baseState, phase: 'implement', phaseEntryCode: entry };
		writeState(dir, st);

		const idle = checkPhaseContract({ repoRoot: dir, state: st, phase: 'implement' });
		check('C-2: 코드 변경 없음 → 실패', idle.ok === false);
		check('C-2: 원인이 code 로 분류(구현결함 라우팅)', idle.cause?.artifact === 'code');

		// 면제는 기록으로 — 코드가 필요 없는 step 은 이유를 남긴다.
		logDecision(dir, { topic: '문서만 변경', conclusion: '코드 변경 불필요', why: '타입 주석 정리', cycleId: 'step-0#0', phase: 'implement' });
		const exempt = checkPhaseContract({ repoRoot: dir, state: st, phase: 'implement' });
		check('C-2: 명시적 면제 기록이 있으면 통과', exempt.ok === true);
		check('C-2: 통과 사유에 면제임이 남는다', /면제/.test(exempt.reason ?? ''));

		// 실제 코드가 바뀌면 면제 기록 없이도 통과 (다른 임시 저장소로 확인)
		writeFileSync(path.join(dir, 'src', 'app.tsx'), 'export const a = 2;\n', 'utf8');
		const worked = checkPhaseContract({ repoRoot: dir, state: st, phase: 'implement' });
		check('C-2: 코드가 바뀌면 통과', worked.ok === true && /코드 변경 확인/.test(worked.reason ?? ''));

		// 기준선이 없는 구 상태 파일은 검사하지 않는다 (업그레이드 하위호환)
		const legacy = { ...baseState, phase: 'implement' };
		const lg = checkPhaseContract({ repoRoot: dir, state: legacy, phase: 'implement' });
		check('C-2: 진입 기준선 없으면 생략(하위호환)', lg.ok === true && /기준선 없음/.test(lg.reason ?? ''));
	} catch (err) {
		failures.push(`C-2 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── [C-3] design 계약: 스펙·AC 는 verify 와 **같은 판정 함수**를 쓴다 ────────────
console.log('');
console.log('=== phase-gate selftest C-3: design 계약(스펙·AC + 결정 기록) ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-design-'));
	try {
		activateContract(dir);
		writeState(dir, { ...baseState, phase: 'design' });
		// 스펙 계약은 러너가 있는 환경에서만 강제된다(verify 의 E2E 강제와 같은 조건).
		const noRunner = checkPhaseContract({ repoRoot: dir, state: { ...baseState, phase: 'design' }, phase: 'design' });
		check('C-3: 러너 없으면 스펙 계약 생략 → 기록만 요구', noRunner.ok === false && noRunner.cause?.artifact === 'decision');

		writeFileSync(path.join(dir, 'scripts', 'eval-scenario.mjs'), '// fixture: 러너 존재\n', 'utf8');
		const noSpec = checkPhaseContract({ repoRoot: dir, state: { ...baseState, phase: 'design' }, phase: 'design' });
		check('C-3: 스펙 없음 → 실패', noSpec.ok === false);
		check('C-3: verify 와 같은 분류를 받는다(unverifiable/no-spec)', noSpec.cause?.e2e === 'unverifiable' && noSpec.cause?.unverifiable === 'no-spec');

		// AC 를 선언하고 그것을 덮는 단언까지 쓰면 스펙 계약이 충족된다.
		writeFileSync(
			path.join(dir, 'harness', 'plan.json'),
			JSON.stringify({ steps: [{ label: '01-a', acceptance: [{ id: 'AC-1', text: '추가하면 목록에 보인다' }] }] }, null, 2),
			'utf8',
		);
		writeFileSync(
			path.join(dir, 'harness', 'eval-scenario.json'),
			JSON.stringify({ scenarios: [{ name: 's', ac: 'AC-1', steps: [{ assert: 'textVisible', text: 'x' }] }] }, null, 2),
			'utf8',
		);
		const covered = checkPhaseContract({ repoRoot: dir, state: { ...baseState, phase: 'design' }, phase: 'design' });
		check('C-3: 스펙·AC 충족 후에는 결정 기록만 남는다', covered.ok === false && covered.cause?.artifact === 'decision');

		// AC 를 덮지 않는 스펙은 design 에서 막힌다 — verify 까지 가서 implement 를 낭비하지 않는다.
		writeFileSync(
			path.join(dir, 'harness', 'eval-scenario.json'),
			JSON.stringify({ scenarios: [{ name: 's', steps: [{ assert: 'textVisible', text: 'x' }] }] }, null, 2),
			'utf8',
		);
		const uncovered = checkPhaseContract({ repoRoot: dir, state: { ...baseState, phase: 'design' }, phase: 'design' });
		check('C-3: AC 미커버 → design 에서 차단(ac-uncovered)', uncovered.ok === false && uncovered.cause?.unverifiable === 'ac-uncovered');
	} catch (err) {
		failures.push(`C-3 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── [D] 세션 격리(세션 분리 3단계): 판정 세션 ≠ 설계/구현 세션 (opt-in) ────────────
console.log('');
console.log('=== phase-gate selftest D: 세션 지문 교차 검증(sessionIsolation opt-in) ===');
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-session-'));
	try {
		activateContract(dir);
		mkdirSync(path.join(dir, 'harness'), { recursive: true });
		writeFileSync(
			path.join(dir, 'harness', 'config.json'),
			JSON.stringify({ useGit: false, sessionIsolation: true }) + '\n',
			'utf8',
		);
		check('D: config.sessionIsolation=true → 활성', sessionIsolationActive(dir) === true);

		// 지문 왕복 — logDecision(sessionId) → phaseRecordSession 이 같은 값을 읽는다
		logDecision(dir, { topic: 't', conclusion: 'c', why: 'w', cycleId: 'step-0#9', phase: 'design', sessionId: 'sess-round' });
		const round = phaseRecordSession(dir, 'step-0#9', 'design');
		check('D: 세션 지문 왕복(logDecision → phaseRecordSession)', round.found === true && round.sessionId === 'sess-round');
		check('D: 마커 형식 고정', sessionMarker('sess-x') === '<!-- harness:session id=sess-x -->');

		// (D-1) 격리 활성 + 지문 없는 debate 기록 → 실패 (오케스트레이터 직접 기록으로 판단)
		const st0 = { ...baseState, phase: 'debate', reworkCount: 0 };
		writeState(dir, st0);
		logDecision(dir, { topic: '판정', conclusion: 'pass', why: 'w', cycleId: 'step-0#0', phase: 'debate' });
		const d1 = checkPhaseContract({ repoRoot: dir, state: st0, phase: 'debate' });
		check('D-1: 지문 없는 판정 기록 → 실패', d1.ok === false && /세션 지문이 없습니다/.test(d1.reason));
		check('D-1: 조치로 run-phase-session 안내', /run-phase-session/.test(d1.hint ?? ''));

		// (D-2) 설계/구현과 다른 세션의 판정 → 통과
		const st1 = { ...baseState, phase: 'debate', reworkCount: 1 };
		logDecision(dir, { topic: '설계', conclusion: 'c', why: 'w', cycleId: 'step-0#1', phase: 'design', sessionId: 'sess-design-1' });
		logDecision(dir, { topic: '면제', conclusion: '코드 변경 불필요', why: 'w', cycleId: 'step-0#1', phase: 'implement', sessionId: 'sess-impl-1' });
		logDecision(dir, { topic: '판정', conclusion: 'pass', why: 'w', cycleId: 'step-0#1', phase: 'debate', sessionId: 'sess-judge-1' });
		const d2 = checkPhaseContract({ repoRoot: dir, state: st1, phase: 'debate' });
		check('D-2: 판정 세션이 설계/구현과 다르면 통과', d2.ok === true && /세션 지문 확인/.test(d2.reason));

		// (D-3) 구현 세션과 같은 지문의 판정 → 실패 (같은 손이 만들고 판정)
		const st2 = { ...baseState, phase: 'debate', reworkCount: 2 };
		logDecision(dir, { topic: '구현', conclusion: 'c', why: 'w', cycleId: 'step-0#2', phase: 'implement', sessionId: 'sess-same' });
		logDecision(dir, { topic: '판정', conclusion: 'pass', why: 'w', cycleId: 'step-0#2', phase: 'debate', sessionId: 'sess-same' });
		const d3 = checkPhaseContract({ repoRoot: dir, state: st2, phase: 'debate' });
		check('D-3: 구현 세션과 동일한 판정 세션 → 실패', d3.ok === false && /세션 격리 위반/.test(d3.reason));

		// (D-4) 격리 옵트인 해제 → 지문 없는 기록도 종전대로 통과 (기존 프로젝트 무영향)
		writeFileSync(path.join(dir, 'harness', 'config.json'), JSON.stringify({ useGit: false }) + '\n', 'utf8');
		check('D-4: config 미설정 → 비활성', sessionIsolationActive(dir) === false);
		const d4 = checkPhaseContract({ repoRoot: dir, state: st0, phase: 'debate' });
		check('D-4: 격리 꺼짐 → 지문 없는 기록도 통과(하위호환)', d4.ok === true);
	} catch (err) {
		failures.push(`D 예외: ${err?.stack ?? String(err)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log('');
if (failures.length === 0) {
	console.log('PHASE-GATE SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`PHASE-GATE SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
