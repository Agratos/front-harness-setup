#!/usr/bin/env node
// resume-watch.selftest.mjs — 재개 루프 코드화(resume-watch) 자가검증.
//
// 실행: node scripts/resume-watch.selftest.mjs
//
// 왜 필요한가: 재개 프로토콜은 "활성 세션과 충돌하지 않으면서, 멈춘 루프만 인수" 가 전부다.
// 그 경계(fresh/stale, 잠금, blocked, 러너 유무, 무전진)를 하나라도 잘못 읽으면
// ① 활성 세션을 덮치거나 ② 멈춘 루프를 영영 방치한다. tick() 을 in-process 로 결정적으로 검증한다.
// 네트워크·실제 드라이버 미사용(HARNESS_DRIVER_CMD 스텁), 임시 cwd 전용.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { staleness, tick } from './resume-watch.mjs';

const failures = [];
function check(label, cond, extra) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
		failures.push(label);
	}
}

function seed(cwd, state, { staleMinutes = 0 } = {}) {
	mkdirSync(path.join(cwd, 'harness'), { recursive: true });
	const p = path.join(cwd, 'harness', 'state.json');
	writeFileSync(p, JSON.stringify(state) + '\n', 'utf8');
	if (staleMinutes > 0) {
		const t = new Date(Date.now() - staleMinutes * 60_000);
		utimesSync(p, t, t);
	}
	return p;
}

const baseState = (over = {}) => ({
	planSteps: ['01-x'],
	currentStepIdx: 0,
	phase: 'verify',
	phaseSeq: 4,
	status: 'running',
	committed: false,
	reworkCount: 0,
	failures: {},
	escalations: 0,
	scores: {},
	...over,
});

/** 드라이버 스텁 커맨드 — 지정 동작(js 코드)을 임시 cwd 에서 수행한다. */
function driverStub(cwd, name, body) {
	const p = path.join(cwd, name);
	writeFileSync(p, body, 'utf8');
	return `"${process.execPath}" "${p}"`;
}

console.log('=== resume-watch selftest (tick 경계 판정) ===');

// [1] state 없음 → 인수할 것 없음
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-nostate-'));
	try {
		check('[1] state 없음 → no-state', tick(dir).action === 'no-state');
		check('[1] staleness 는 null', staleness(dir) === null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [2] fresh 상태(방금 갱신) → 활성 세션 추정, 손대지 않는다
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-fresh-'));
	try {
		seed(dir, baseState());
		const r = tick(dir, { staleMin: 30 });
		check('[2] fresh → idle-fresh(인수 금지)', r.action === 'idle-fresh' && r.driverRuns === 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [3] done / blocked 상태 → 드라이버를 부르지 않는다
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-terminal-'));
	try {
		seed(dir, baseState({ status: 'done' }), { staleMinutes: 60 });
		check('[3] done → 감시 종료 신호', tick(dir).action === 'done');
		seed(dir, baseState({ status: 'blocked', blockedReason: 'verify 3회 실패' }), { staleMinutes: 60 });
		const b = tick(dir);
		check('[3] blocked → 자동 재개 금지(blocked-wait)', b.action === 'blocked-wait' && b.driverRuns === 0);
		check('[3] blocked 사유를 그대로 노출', /verify 3회 실패/.test(b.detail));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [4] stale + 결정적 페이즈 → 드라이버 인수, done 도달 시 종료 보고
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-resume-'));
	try {
		seed(dir, baseState(), { staleMinutes: 45 });
		// 스텁: phaseSeq+1 + status=done 으로 갱신 (한 번에 완료되는 가장 단순한 전진)
		const cmd = driverStub(
			dir,
			'stub-done.mjs',
			[
				`import { readFileSync, writeFileSync } from 'node:fs';`,
				`const p = 'harness/state.json';`,
				`const s = JSON.parse(readFileSync(p, 'utf8'));`,
				`writeFileSync(p, JSON.stringify({ ...s, phaseSeq: s.phaseSeq + 1, status: 'done' }) + '\\n', 'utf8');`,
			].join('\n'),
		);
		const r = tick(dir, { staleMin: 30, driverCmd: cmd });
		check('[4] stale → 인수 + done 도달 보고(resumed-done)', r.action === 'resumed-done' && r.driverRuns === 1, JSON.stringify(r));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [5] 드라이버 잠금(exit 4) → 활성 세션에 양보 / blocked(exit 3) → 사람 몫
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-exitcodes-'));
	try {
		seed(dir, baseState(), { staleMinutes: 45 });
		const lockCmd = driverStub(dir, 'stub-lock.mjs', 'process.exit(4);');
		check('[5] exit 4 → lock-held(양보)', tick(dir, { staleMin: 30, driverCmd: lockCmd }).action === 'lock-held');
		const blockedCmd = driverStub(dir, 'stub-blocked.mjs', 'process.exit(3);');
		check('[5] exit 3 → blocked(자동 --resume 금지)', tick(dir, { staleMin: 30, driverCmd: blockedCmd }).action === 'blocked');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [6] 에이전트 페이즈 + 러너 미가용 → 대신 지어내지 않고 오케스트레이터를 부른다
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-agent-'));
	try {
		seed(dir, baseState({ phase: 'debate' }), { staleMinutes: 45 });
		const r = tick(dir, { staleMin: 30, driverCmd: 'node -e "process.exit(0)"' });
		check('[6] 러너 미가용 → agent-required(드라이버 미호출)', r.action === 'agent-required' && r.driverRuns === 0);
		check('[6] 안내에 /run-cycle 포함', /run-cycle/.test(r.detail));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [7] 에이전트 페이즈 + sessionIsolation + 러너 존재 → 러너 → 드라이버 순서로 전진
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-runner-'));
	try {
		seed(dir, baseState({ phase: 'debate' }), { staleMinutes: 45 });
		mkdirSync(path.join(dir, 'scripts'), { recursive: true });
		writeFileSync(path.join(dir, 'harness', 'config.json'), JSON.stringify({ sessionIsolation: true }) + '\n', 'utf8');
		// 러너 스텁: 실행 흔적을 남기고 성공
		writeFileSync(
			path.join(dir, 'scripts', 'run-phase-session.mjs'),
			`import { writeFileSync } from 'node:fs'; writeFileSync('runner-ran.txt', 'yes', 'utf8'); process.exit(0);`,
			'utf8',
		);
		const cmd = driverStub(
			dir,
			'stub-advance.mjs',
			[
				`import { readFileSync, writeFileSync } from 'node:fs';`,
				`const p = 'harness/state.json';`,
				`const s = JSON.parse(readFileSync(p, 'utf8'));`,
				`writeFileSync(p, JSON.stringify({ ...s, phaseSeq: s.phaseSeq + 1, status: 'done' }) + '\\n', 'utf8');`,
			].join('\n'),
		);
		const r = tick(dir, { staleMin: 30, driverCmd: cmd });
		check('[7] 러너 1회 + 드라이버 1회로 전진', r.runnerRuns === 1 && r.driverRuns === 1, JSON.stringify(r));
		check('[7] 러너가 실제 실행됨(흔적 파일)', readFileSync(path.join(dir, 'runner-ran.txt'), 'utf8') === 'yes');
		check('[7] done 도달 보고', r.action === 'resumed-done');

		// 러너 실패는 그대로 멈춘다 (지어내기 금지)
		seed(dir, baseState({ phase: 'debate' }), { staleMinutes: 45 });
		writeFileSync(path.join(dir, 'scripts', 'run-phase-session.mjs'), 'process.exit(5);', 'utf8');
		const rf = tick(dir, { staleMin: 30, driverCmd: cmd });
		check('[7] 러너 실패 → runner-failed(전진 중단)', rf.action === 'runner-failed' && /exit 5/.test(rf.detail));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// [8] 전진 없음(무한 재시도 금지) → stuck 으로 멈추고 사람을 부른다
{
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rw-stuck-'));
	try {
		seed(dir, baseState(), { staleMinutes: 45 });
		const noopCmd = driverStub(dir, 'stub-noop.mjs', 'process.exit(0);');
		const r = tick(dir, { staleMin: 30, driverCmd: noopCmd });
		check('[8] phaseSeq 무변화 → stuck(같은 tick 내 재시도 금지)', r.action === 'stuck' && r.driverRuns === 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log('');
if (failures.length) {
	console.log(`RESUME-WATCH SELFTEST: FAIL (${failures.length}건)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
console.log('RESUME-WATCH SELFTEST: PASS');
