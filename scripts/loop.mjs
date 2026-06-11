#!/usr/bin/env node
// loop.mjs — 재호출 가능(re-invokable) 루프 드라이버 (US-007)
//
// 왜 이렇게 설계했나:
//   서브에이전트는 서로 직접 대화하지 못하고, 오케스트레이션을 하나의 거대한 턴 안에
//   몰아넣어서도 안 됩니다. 그래서 loop.mjs 는 "한 번 호출 = 한 페이즈 진행" 의
//   결정적(deterministic) 상태 기계로 만들어, 턴 경계/크래시를 넘어 실행이 살아남게 합니다.
//
//   각 페이즈의 실제 에이전트 추론은 /run-cycle 커맨드(서브에이전트 스폰)가 담당하고,
//   loop.mjs 는 결정적 골격만 책임집니다:
//     - 페이즈 시퀀싱(아래 PHASE_ORDER)
//     - 상태 영속화(scripts/lib/state.mjs 의 원자적 write)
//     - 결정적 페이즈 실행: verify(=done-gate 결정적 부분), merge(=git-flow merge-step)
//     - 에이전트 주도 페이즈(design/implement/evaluate/debate)는 "/run-cycle 필요" 로그 +
//       harness/cycles/ 에 사이클 로그 1줄 append 후 다음 페이즈로 전진.
//
// 멱등 재개(idempotent resume):
//   needsRerun(state) 가 true(=committed=false 인데 phase 가 done 표시) 면
//   건너뛰지 않고 현재 페이즈를 다시 실행합니다.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { advancePhase, defaultState, markCommitted, needsRerun, readState, stateFilePath, writeState } from './lib/state.mjs';

// step 당 페이즈 순서. merge 다음은 (다음 step 의) decompose 로 래핑한다.
export const PHASE_ORDER = ['decompose', 'design', 'implement', 'verify', 'evaluate', 'debate', 'merge'];

// loop.mjs 가 직접 결정적으로 실행하는 페이즈
const DETERMINISTIC_PHASES = new Set(['verify', 'merge']);
// 에이전트 주도(=/run-cycle 커맨드가 담당) 페이즈
const AGENT_PHASES = new Set(['decompose', 'design', 'implement', 'evaluate', 'debate']);

function log(msg) {
	console.log(`[loop] ${msg}`);
}

/** harness/cycles/ 에 사이클 로그 1줄을 append (감사 추적용). */
export function appendCycleLog(repoRoot, entry) {
	const dir = path.join(repoRoot, 'harness', 'cycles');
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'cycle-log.ndjson');
	appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
	return file;
}

/**
 * 현재 step 의 <nn>/<slug> 를 planSteps 라벨에서 유도.
 * 라벨이 "01-login" 형태면 그대로, 아니면 zero-padded idx + 슬러그화.
 * @param {object} state
 * @returns {{nn:string, slug:string, label:string}}
 */
export function deriveStepRef(state) {
	const idx = state.currentStepIdx ?? 0;
	const label = (Array.isArray(state.planSteps) ? state.planSteps[idx] : undefined) ?? `step-${idx}`;
	const m = /^(\d{1,3})[-_ ]+(.+)$/.exec(label);
	if (m) {
		return { nn: m[1].padStart(2, '0'), slug: slugify(m[2]), label };
	}
	return { nn: String(idx + 1).padStart(2, '0'), slug: slugify(label), label };
}

function slugify(s) {
	return String(s)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9가-힣]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'step';
}

/**
 * 다음 (phase, currentStepIdx, status) 를 결정한다 (순수 함수).
 * merge 다음은 다음 step 의 decompose; step 소진 시 status='done'.
 * @param {string} phase 방금 실행을 마친 현재 페이즈
 * @param {number} currentStepIdx
 * @param {number} stepCount planSteps.length
 * @returns {{nextPhase:string, nextStepIdx:number, done:boolean}}
 */
export function nextTransition(phase, currentStepIdx, stepCount) {
	const i = PHASE_ORDER.indexOf(phase);
	// 현재 phase 가 시퀀스에 없으면(예: 'init') 첫 페이즈로 진입
	if (i === -1) {
		return { nextPhase: PHASE_ORDER[0], nextStepIdx: currentStepIdx, done: false };
	}
	if (i < PHASE_ORDER.length - 1) {
		return { nextPhase: PHASE_ORDER[i + 1], nextStepIdx: currentStepIdx, done: false };
	}
	// merge 완료 → 다음 step
	const nextStepIdx = currentStepIdx + 1;
	if (nextStepIdx >= stepCount) {
		return { nextPhase: 'merge', nextStepIdx: currentStepIdx, done: true };
	}
	return { nextPhase: PHASE_ORDER[0], nextStepIdx, done: false };
}

/** node 자식 프로세스 실행 → {code} (출력 상속) */
function runNode(args, repoRoot) {
	try {
		execFileSync('node', args, { cwd: repoRoot, stdio: 'inherit' });
		return { code: 0 };
	} catch (err) {
		return { code: err.status ?? 1 };
	}
}

/**
 * 결정적 페이즈 실행.
 * - verify: done-gate.mjs --deterministic-only 셸아웃 (없으면 통과 처리, 게이트는 merge 에서 재확인)
 * - merge:  git-flow.mjs merge-step <nn> <slug> 가드 호출
 * @returns {{ok:boolean, note:string}}
 */
function runDeterministicPhase(phase, state, repoRoot) {
	if (phase === 'verify') {
		const gate = path.join(repoRoot, 'scripts', 'done-gate.mjs');
		if (!existsSync(gate)) return { ok: true, note: 'done-gate.mjs 없음 → verify 통과 처리(merge 에서 재검증)' };
		const r = runNode([gate, '--deterministic-only'], repoRoot);
		return { ok: r.code === 0, note: `done-gate --deterministic-only exit ${r.code}` };
	}
	if (phase === 'merge') {
		const gitFlow = path.join(repoRoot, 'scripts', 'git-flow.mjs');
		if (!existsSync(gitFlow)) return { ok: true, note: 'git-flow.mjs 없음 → merge no-op' };
		const { nn, slug } = deriveStepRef(state);
		// merge-step 내부에서 done-gate(있으면) 또는 HARNESS_GATE_OK 로 재게이트한다.
		const r = runNode([gitFlow, 'merge-step', nn, slug], repoRoot);
		return { ok: r.code === 0, note: `git-flow merge-step ${nn} ${slug} exit ${r.code}` };
	}
	return { ok: true, note: 'no-op' };
}

/**
 * 한 번의 invocation = 현재 페이즈 1개 실행 후 전진. 상태를 원자적으로 기록한다.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string[]|null} params.initSteps `--init` 으로 주입된 planSteps (옵션)
 * @returns {{state:object, executedPhase:string, rerun:boolean, note:string, done:boolean}}
 */
export function runOnce({ repoRoot, initSteps = null }) {
	const statePath = stateFilePath(repoRoot);
	let state = readState(statePath);

	// 초기화: 상태가 없거나 init 이고 planSteps 가 비었으면 seed
	if (!state) {
		state = defaultState(initSteps ?? []);
	} else if ((state.status === 'init' || !state.phase || state.phase === 'init') && initSteps) {
		state = { ...defaultState(initSteps), scores: state.scores ?? {} };
	}

	// planSteps 가 비어 있으면 진행 불가
	if (!Array.isArray(state.planSteps) || state.planSteps.length === 0) {
		writeState(statePath, state);
		return { state, executedPhase: null, rerun: false, note: 'planSteps 비어있음 — --init 으로 시드 필요', done: false };
	}

	// 이미 done 이면 더 진행하지 않음
	if (state.status === 'done') {
		return { state, executedPhase: null, rerun: false, note: '이미 status=done', done: true };
	}

	// status=init → running 으로 전이하며 첫 페이즈(decompose) 진입
	if (state.status === 'init' || state.phase === 'init') {
		state = { ...state, status: 'running', phase: PHASE_ORDER[0], phaseSeq: (state.phaseSeq ?? 0) + 1, committed: false };
	}

	// 멱등 재개: committed=false 인데 done 표시 상태면 현재 페이즈 재실행 (advance 안 함)
	const rerun = needsRerun(state);

	const phase = state.phase;
	let note;

	if (DETERMINISTIC_PHASES.has(phase)) {
		const r = runDeterministicPhase(phase, state, repoRoot);
		note = `결정적 페이즈 '${phase}': ${r.note}`;
		log(note);
		if (!r.ok) {
			// 실패 시 전진하지 않고 committed=false 로 두어 다음 호출에서 재실행 (멱등 재개)
			appendCycleLog(repoRoot, cycleEntry(state, phase, 'fail', r.note));
			const blocked = { ...state, committed: false };
			writeState(statePath, blocked);
			return { state: blocked, executedPhase: phase, rerun, note: `${note} → 실패, 전진 안 함`, done: false };
		}
	} else if (AGENT_PHASES.has(phase)) {
		note = `PHASE ${phase} requires agent work via /run-cycle`;
		log(note);
		appendCycleLog(repoRoot, cycleEntry(state, phase, 'agent-required', note));
	} else {
		note = `알 수 없는 페이즈 '${phase}' — 스킵`;
		log(note);
	}

	// 현재 페이즈 완료 → 커밋 표시(비-git/스켈레톤이므로 sha=null) 후 다음으로 전진
	const committedState = markCommitted(state, state.lastCommittedSha ?? null);
	const { nextPhase, nextStepIdx, done } = nextTransition(phase, committedState.currentStepIdx ?? 0, state.planSteps.length);

	let advanced;
	if (done) {
		advanced = { ...committedState, status: 'done' };
	} else {
		advanced = advancePhase({ ...committedState, currentStepIdx: nextStepIdx }, nextPhase);
	}
	writeState(statePath, advanced);

	return { state: advanced, executedPhase: phase, rerun, note, done };
}

/** cycles 로그 엔트리 구성 (결정적 — Date 대신 phaseSeq/checkpointToken 사용) */
function cycleEntry(state, phase, outcome, detail) {
	return {
		checkpointToken: state.checkpointToken,
		phaseSeq: state.phaseSeq,
		stepIdx: state.currentStepIdx,
		stepLabel: (state.planSteps ?? [])[state.currentStepIdx] ?? null,
		phase,
		outcome,
		detail,
	};
}

/** CLI 인자: --init "<s1>,<s2>" */
function parseInit(argv) {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--init') {
			const v = argv[i + 1];
			if (!v) return [];
			return v
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		}
		if (argv[i].startsWith('--init=')) {
			return argv[i]
				.slice('--init='.length)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		}
	}
	return null;
}

function main() {
	const argv = process.argv.slice(2);
	const repoRoot = process.cwd();
	const initSteps = parseInit(argv);

	const { state, executedPhase, rerun, note, done } = runOnce({ repoRoot, initSteps });

	console.log('=== loop (1 phase / invocation) ===');
	console.log(`step: ${state.currentStepIdx + 1}/${state.planSteps.length} (${(state.planSteps ?? [])[state.currentStepIdx] ?? '-'})`);
	console.log(`phase: ${state.phase}  phaseSeq: ${state.phaseSeq}  status: ${state.status}`);
	if (executedPhase) console.log(`executed: ${executedPhase}${rerun ? ' (RERUN — 멱등 재개)' : ''}`);
	if (note) console.log(`note: ${note}`);
	if (done) console.log('루프 완료: 모든 step 소진 → status=done');

	process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
