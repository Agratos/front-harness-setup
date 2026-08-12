#!/usr/bin/env node
// run-phase-session.selftest.mjs — 격리 페이즈 세션 러너(세션 분리 3단계) 자가검증.
//
// 실행: node scripts/run-phase-session.selftest.mjs
//
// 왜 필요한가: 러너는 세션 지문(HARNESS_SESSION_ID)의 유일한 발급자이고, 그 지문이
// record-decision 스탬프 → phase-gate 교차 검증으로 이어지는 사슬의 출발점이다.
// 실제 claude 세션은 결정적이지 않으므로 HARNESS_PHASE_CMD(가짜 세션 — 우회 노출 지점이자
// 테스트 환경 조건)로 검증한다. 네트워크·실제 claude CLI 미사용, 임시 cwd 전용.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionMarker } from './lib/artifact.mjs';
import { buildPrompt, fileCycleId, makeSessionId, PHASE_TOOLS } from './run-phase-session.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptsDir, 'run-phase-session.mjs');
const recorderCli = path.join(scriptsDir, 'record-decision.mjs');

const failures = [];
function check(label, cond, extra) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
		failures.push(label);
	}
}

function run(cwd, args, env = {}) {
	try {
		const out = execFileSync(process.execPath, [cli, ...args], {
			cwd,
			encoding: 'utf8',
			stdio: 'pipe',
			env: { ...process.env, ...env },
		});
		return { code: 0, out };
	} catch (err) {
		return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
	}
}

function seedState(cwd, phase) {
	mkdirSync(path.join(cwd, 'harness'), { recursive: true });
	writeFileSync(
		path.join(cwd, 'harness', 'state.json'),
		JSON.stringify({
			planSteps: ['01-x'],
			currentStepIdx: 0,
			phase,
			phaseSeq: 3,
			status: 'running',
			committed: false,
			reworkCount: 0,
			failures: {},
			escalations: 0,
			scores: {},
		}) + '\n',
		'utf8',
	);
}

/** 가짜 세션 스크립트 — stdin(프롬프트)을 읽고, 받은 세션 env 를 파일로 남긴 뒤 지정 exit. */
function fakeSession(cwd, name, exitCode) {
	const p = path.join(cwd, name);
	writeFileSync(
		p,
		[
			`import { writeFileSync } from 'node:fs';`,
			`let d = '';`,
			`process.stdin.setEncoding('utf8');`,
			`process.stdin.on('data', (c) => (d += c));`,
			`process.stdin.on('end', () => {`,
			`  if (!d.includes('격리 페이즈 세션')) { console.error('프롬프트 미수신'); process.exit(9); }`,
			`  writeFileSync('session-env.txt', String(process.env.HARNESS_SESSION_ID ?? '') + '|' + String(process.env.HARNESS_SESSION_PHASE ?? ''), 'utf8');`,
			`  process.exit(${exitCode});`,
			`});`,
		].join('\n'),
		'utf8',
	);
	return `"${process.execPath}" "${p}"`;
}

// ── [A] 순수 함수 — 세션 id·프롬프트·도구 목록 ─────────────────────────────
console.log('[A] fileCycleId / makeSessionId / buildPrompt / PHASE_TOOLS');
{
	check('[A] fileCycleId 는 # 를 파일 안전 문자로', fileCycleId('step-0#2') === 'step-0-r2');
	const sid = makeSessionId('debate', 'step-0#1');
	check('[A] 세션 id 에 페이즈·사이클이 들어간다(사람이 추적 가능)', /^sess-debate-step-0-r1-/.test(sid));
	check('[A] 에이전트 페이즈 5종만 실행 대상', Object.keys(PHASE_TOOLS).join() === 'decompose,debate,vote,design,implement');
	check('[A] 판정 세션(debate)에는 쓰기 도구가 없다', !PHASE_TOOLS.debate.includes('Write') && !PHASE_TOOLS.debate.includes('Edit'));
	check('[A] 설계·구현 세션에는 쓰기 도구가 있다', PHASE_TOOLS.design.includes('Write') && PHASE_TOOLS.implement.includes('Edit'));

	const prompt = buildPrompt('/repo', { phase: 'debate', cycleId: 'step-0#0', stepLabel: '01-x', sessionId: 'sess-t' });
	check('[A] 프롬프트에 격리 신원·지문 명시', /격리 페이즈 세션/.test(prompt) && /sess-t/.test(prompt));
	check('[A] 프롬프트가 판정 입력을 격리 산출물로 제한', /격리 산출물만/.test(prompt));
	check('[A] 마감 명령(record-decision)을 안내', /record-decision\.mjs --phase=debate/.test(prompt));
	const implPrompt = buildPrompt('/repo', { phase: 'implement', cycleId: 'step-0#0', stepLabel: '01-x', sessionId: 's' });
	check('[A] implement 프롬프트는 면제 기록 경로를 안내', /코드 변경 불필요/.test(implPrompt));
}

// ── [B] CLI — 가짜 세션으로 지문 전파·로그·exit 패스스루 ────────────────────
console.log('');
console.log('[B] CLI (HARNESS_PHASE_CMD 가짜 세션)');
const tmpB = mkdtempSync(path.join(os.tmpdir(), 'phasesess-selftest-'));
try {
	seedState(tmpB, 'debate');
	const okCmd = fakeSession(tmpB, 'fake-ok.mjs', 0);

	// B1: 정상 실행 — 프롬프트 보존 + 세션 로그 + env 지문 전파
	const b1 = run(tmpB, [], { HARNESS_PHASE_CMD: okCmd });
	check('[B1] exit 0', b1.code === 0, b1.out.slice(-300));
	const promptPath = path.join(tmpB, 'harness', 'sessions', 'step-0-r0-debate-prompt.md');
	check('[B1] 프롬프트 파일 보존(감사 추적)', existsSync(promptPath));
	const logFile = path.join(tmpB, 'harness', 'sessions', 'log.ndjson');
	check('[B1] 세션 로그 생성', existsSync(logFile));
	const entry1 = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n')[0]);
	check('[B1] 로그에 사이클·페이즈·지문·cmd 기록', entry1.cycleId === 'step-0#0' && entry1.phase === 'debate' && /^sess-debate-/.test(entry1.sessionId) && /custom\(/.test(entry1.cmd));
	const envSeen = readFileSync(path.join(tmpB, 'session-env.txt'), 'utf8');
	check('[B1] 자식 세션에 HARNESS_SESSION_ID/PHASE 전파', envSeen === `${entry1.sessionId}|debate`);

	// B2: 자식 실패는 exit 패스스루 + 로그에 code 기록
	const failCmd = fakeSession(tmpB, 'fake-fail.mjs', 7);
	const b2 = run(tmpB, [], { HARNESS_PHASE_CMD: failCmd });
	check('[B2] 자식 exit 7 → 러너 exit 7(패스스루)', b2.code === 7, b2.out.slice(-300));
	const lines = readFileSync(logFile, 'utf8').trim().split('\n');
	check('[B2] 실패도 세션 로그에 남는다(code=7)', JSON.parse(lines[lines.length - 1]).code === 7);

	// B3: 결정적 페이즈는 이 러너의 대상이 아니다
	const b3 = run(tmpB, ['--phase=verify'], { HARNESS_PHASE_CMD: okCmd });
	check('[B3] verify 요청 → 거부(exit 2)', b3.code === 2 && /에이전트 페이즈/.test(b3.out));

	// B4: --phase 오버라이드 — state 의 페이즈와 무관하게 지정 페이즈 실행
	const b4 = run(tmpB, ['--phase=vote'], { HARNESS_PHASE_CMD: okCmd });
	check('[B4] --phase=vote 오버라이드 실행', b4.code === 0 && /격리 페이즈 세션 시작 — vote/.test(b4.out));
} finally {
	rmSync(tmpB, { recursive: true, force: true });
}

// state 없음 → exit 2
const tmpB2 = mkdtempSync(path.join(os.tmpdir(), 'phasesess-nostate-'));
try {
	const noState = run(tmpB2, [], { HARNESS_PHASE_CMD: 'node -e "process.exit(0)"' });
	check('[B5] state 없음 → exit 2', noState.code === 2);
} finally {
	rmSync(tmpB2, { recursive: true, force: true });
}

// ── [C] 지문 사슬 — 러너 env → record-decision CLI → 기록 스탬프 ─────────────
console.log('');
console.log('[C] 세션 지문 사슬 (env → record-decision → 기록)');
const tmpC = mkdtempSync(path.join(os.tmpdir(), 'phasesess-chain-'));
try {
	seedState(tmpC, 'debate');
	// 러너가 심는 것과 동일한 env 계약으로 실제 record-decision CLI 를 실행한다.
	const out = execFileSync(
		process.execPath,
		[recorderCli, '--phase=debate', '--topic=판정', '--conclusion=pass', '--why=근거'],
		{ cwd: tmpC, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HARNESS_SESSION_ID: 'sess-chain-1' } },
	);
	check('[C] record-decision 이 세션 지문을 출력', /세션 지문: sess-chain-1/.test(out));
	const decisions = path.join(tmpC, 'harness', 'decisions');
	const files = (existsSync(decisions) ? readFileSync(path.join(decisions, 'decision-0001.md'), 'utf8') : '');
	check('[C] 기록 파일에 세션 마커가 찍힌다', files.includes(sessionMarker('sess-chain-1')));
	// env 없이 실행하면 지문 없이 기록된다(종전 동작 — 격리 옵트인 전 프로젝트 무영향)
	const out2 = execFileSync(
		process.execPath,
		[recorderCli, '--phase=debate', '--topic=판정2', '--conclusion=pass', '--why=근거'],
		{ cwd: tmpC, encoding: 'utf8', stdio: 'pipe' },
	);
	check('[C] env 없으면 지문 없이 기록(하위호환)', !/세션 지문:/.test(out2));
} finally {
	rmSync(tmpC, { recursive: true, force: true });
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
	console.log(`RUN-PHASE-SESSION SELFTEST: FAIL (${failures.length}건)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
console.log('RUN-PHASE-SESSION SELFTEST: PASS');
