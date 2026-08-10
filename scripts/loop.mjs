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

import { advancePhase, cycleIdOf, defaultState, markCommitted, needsRerun, readState, stateFilePath, writeState } from './lib/state.mjs';
import { evaluateHysteresis, loadLatestEvaluation, readGateStatus } from './done-gate.mjs';
import { logError } from './lib/log.mjs';

// step 당 페이즈 순서. merge 다음은 (다음 step 의) decompose 로 래핑한다.
export const PHASE_ORDER = ['decompose', 'design', 'implement', 'verify', 'evaluate', 'debate', 'merge'];

// 재작업(rework) 한도 — 사양서 확정 2. 이 횟수까지는 implement 로 되돌아가 재작업하고,
// 초과(= 그래도 debate 가 rework 판정)하면 vote 페이즈로 분기한다.
export const MAX_REWORK = 5;

// 결정적 페이즈(verify/merge) 연속 실패 재시도 한도. 이 횟수까지는 같은 페이즈를 다시 실행한다.
export const MAX_PHASE_RETRY = 3;
// 분기(에스컬레이션) 한도. 넘으면 status='blocked' 로 항복한다 — 무한 루프 금지의 마지막 방어선.
export const MAX_ESCALATION = 3;

// loop.mjs 가 직접 결정적으로 실행하는 페이즈
const DETERMINISTIC_PHASES = new Set(['verify', 'merge']);
// 에이전트 주도(=/run-cycle 커맨드가 담당) 페이즈.
// 'vote' 는 PHASE_ORDER 의 선형 시퀀스에는 없고, debate 의 rework 판정이 MAX_REWORK 를
// 초과할 때만 진입하는 분기 페이즈다(투표 내용·다수결·CEO 캐스팅보트는 에이전트가 수행).
const AGENT_PHASES = new Set(['decompose', 'design', 'implement', 'evaluate', 'debate', 'vote']);

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

/**
 * debate 페이즈의 결과(pass=통과 / rework=재작업)를 결정한다.
 * 우선순위:
 *   1) 명시 주입 — opts.debateOutcome 또는 env HARNESS_DEBATE_OUTCOME ('pass'|'rework'|'fail').
 *      (CI/테스트/오케스트레이터가 평가 결과를 직접 전달하는 경로)
 *   2) 최신 평가 파일 + 히스테리시스 임계(done-gate 와 동일 규칙)로 pass/rework 판정.
 *   3) 평가 데이터가 없으면(스켈레톤/데모) 'pass' — 자율 흐름을 막지 않는다.
 * @param {object} state
 * @param {string} repoRoot
 * @param {{debateOutcome?:string}} [opts]
 * @returns {'pass'|'rework'}
 */
export function resolveDebateOutcome(state, repoRoot, opts = {}) {
	const injected = opts.debateOutcome ?? process.env.HARNESS_DEBATE_OUTCOME;
	if (injected === 'rework' || injected === 'fail') return 'rework';
	if (injected === 'pass') return 'pass';
	try {
		const evaluation = loadLatestEvaluation(repoRoot);
		if (evaluation) {
			// ⚠️ 신선도 확인 — 예전에는 **아무 평가나 최신 파일 하나**를 읽어 판정했다.
			// 그래서 이전 step / 이전 재작업 회차의 평가로 debate 가 pass 를 내고,
			// merge 의 done-gate 는 그 평가를 stale 로 거부해 **탈출구 없는 무한 merge 재시도**가 났다.
			// 이제 이번 사이클 평가가 아니면 "판정 근거 없음"으로 보고 무시한다.
			// (그대로 pass 로 넘겨도 merge 의 done-gate 가 stale 을 잡고, 실패 라우팅이
			//  '검증결함 → evaluate' 로 되돌리므로 루프는 스스로 복구된다.)
			const want = cycleIdOf(state);
			if (evaluation.cycleId && evaluation.cycleId !== want) {
				log(`debate: 평가 ${evaluation.id} 은 다른 사이클(${evaluation.cycleId} ≠ ${want}) — 판정 근거에서 제외`);
			} else if (!evaluation.cycleId) {
				log(`debate: 평가 ${evaluation.id} 에 cycleId 스탬프 없음(구 형식) — 판정 근거에서 제외`);
			} else {
				const stepId = `step-${state.currentStepIdx ?? 0}`;
				const wasLatched = !!(state?.scores?.[stepId]?.latched);
				return evaluateHysteresis(evaluation, wasLatched).pass ? 'pass' : 'rework';
			}
		}
	} catch {
		// 평가 로드 실패 → 자율 유지 위해 pass 처리
	}
	return 'pass';
}

/**
 * 다음 (phase, stepIdx, reworkCount, done) 을 결정한다 (순수 함수, I/O 없음 — 테스트 용이).
 * 선형 전이는 nextTransition 에 위임하고, 재작업/투표 분기만 여기서 처리한다:
 *   - debate + pass  → merge
 *   - debate + rework, reworkCount < MAX_REWORK → implement 로 되돌아감, reworkCount+1 (재작업)
 *   - debate + rework, reworkCount >= MAX_REWORK → vote (한도 소진 → 투표)
 *   - vote → merge (투표 의결 후 진행. 완전 자율 — blocked 로 멈추지 않음)
 *   - merge → 다음 step 의 decompose 로 넘어가면 reworkCount 를 0 으로 초기화 (step 마다 독립)
 * @param {{phase:string, currentStepIdx:number, stepCount:number, reworkCount?:number, debateOutcome?:'pass'|'rework'}} p
 * @returns {{nextPhase:string, nextStepIdx:number, nextReworkCount:number, done:boolean}}
 */
export function computeTransition({ phase, currentStepIdx, stepCount, reworkCount = 0, debateOutcome = 'pass' }) {
	if (phase === 'debate') {
		if (debateOutcome === 'rework') {
			if (reworkCount >= MAX_REWORK) {
				// 5회까지 재작업했는데도 미합의 → 투표 페이즈로 분기 (카운트는 그대로 유지)
				return { nextPhase: 'vote', nextStepIdx: currentStepIdx, nextReworkCount: reworkCount, done: false };
			}
			// 재작업: implement 로 되돌아가 다시 구현·검증·평가한다. 카운트 1 증가.
			return { nextPhase: 'implement', nextStepIdx: currentStepIdx, nextReworkCount: reworkCount + 1, done: false };
		}
		// 통과 → merge
		return { nextPhase: 'merge', nextStepIdx: currentStepIdx, nextReworkCount: reworkCount, done: false };
	}
	if (phase === 'vote') {
		// 투표 의결 후 merge 로 진행 (주관 임계는 gateOverride 로 우회, 결정적 게이트는 유지)
		return { nextPhase: 'merge', nextStepIdx: currentStepIdx, nextReworkCount: reworkCount, done: false };
	}
	// 그 외 선형 전이
	const t = nextTransition(phase, currentStepIdx, stepCount);
	// merge 후 새 step 으로 진입하면 재작업 카운트 초기화
	const nextReworkCount = phase === 'merge' && !t.done ? 0 : reworkCount;
	return { ...t, nextReworkCount };
}

/**
 * 결정적 페이즈 실패를 **결함 종류로 분류**하고, 되돌릴 역할(페이즈)을 정한다 (순수 함수).
 *
 * 분류 체계는 사내 멀티에이전트 조직 가이드(HANDOFF 규약)의 3분류를 그대로 따른다:
 *   설계결함 → 설계자에게 되돌림(design)   구현결함 → 개발자에게(implement)   검증결함 → 평가에게(evaluate)
 *
 * 자동 분류 근거(게이트 실측 결과 `harness/gate-status.json` 기반):
 *   - `check-arch` 실패 = FSD 레이어/경계 위반 → **구조 문제이므로 설계결함**
 *   - typecheck/lint/test 실패 = 코드가 계약을 못 지킴 → **구현결함**
 *   - merge 인데 결정적 게이트는 green = 남은 실패 원인은 평가 임계·stale 평가 → **검증결함**
 *
 * @param {string} phase 실패한 페이즈 ('verify' | 'merge')
 * @param {{passed?:boolean, gates?:Array<{name:string, ok:boolean}>}|null} gateStatus
 * @returns {{kind:'설계결함'|'구현결함'|'검증결함', nextPhase:string, why:string}}
 */
export function classifyFailure(phase, gateStatus) {
	const failedGates = (gateStatus?.gates ?? []).filter((g) => !g.ok).map((g) => g.name);

	// merge 인데 결정적 게이트가 통과 상태였다면, 남은 탈락 사유는 평가(임계/stale) 뿐이다.
	if (phase === 'merge' && gateStatus && gateStatus.passed === true) {
		return {
			kind: '검증결함',
			nextPhase: 'evaluate',
			why: '결정적 게이트는 green — 평가 임계 미달 또는 stale 평가로 판단',
		};
	}
	if (failedGates.includes('check-arch')) {
		return {
			kind: '설계결함',
			nextPhase: 'design',
			why: `check-arch 실패(레이어/경계 위반) — 구조 재설계 필요 [실패 게이트: ${failedGates.join(', ')}]`,
		};
	}
	if (failedGates.length > 0) {
		return {
			kind: '구현결함',
			nextPhase: 'implement',
			why: `결정적 게이트 실패 [${failedGates.join(', ')}]`,
		};
	}
	// 게이트 실측이 없으면(파일 부재 등) 가장 흔한 원인으로 보수적 분류.
	return { kind: '구현결함', nextPhase: 'implement', why: '게이트 실측 정보 없음 — 구현결함으로 보수적 분류' };
}

/**
 * 결정적 페이즈 실패 시의 진로를 정한다 (순수 함수, I/O 없음).
 *
 * 왜 필요한가: 예전에는 verify/merge 가 실패하면 전진하지 않고 **같은 페이즈를 영원히 재실행**했다.
 * 재시도 한도도 분기도 항복 조건도 없어 라이브락이 났다(실측 결함).
 * 이제 3단계로 처리한다 — 재시도 → 원인별 되돌림 → 항복(blocked).
 *
 *   retry    : 연속 실패가 MAX_PHASE_RETRY 미만 → 같은 페이즈 재실행 (일시적 실패 흡수)
 *   escalate : 한도 도달 → 결함 분류에 따라 design/implement/evaluate 로 되돌림, escalations++
 *   blocked  : escalations 가 MAX_ESCALATION 초과 → status='blocked' 로 멈추고 사람을 부른다
 *
 * "완전 자율"은 영원히 도는 것이 아니라, **막혔을 때 이유를 말하고 멈추는 것**까지 포함한다.
 *
 * @param {{phase:string, failCount:number, escalations:number, classification:{nextPhase:string}}} p
 * @returns {{action:'retry'|'escalate'|'blocked', nextPhase:string, nextEscalations:number}}
 */
export function computeFailureRouting({ phase, failCount, escalations = 0, classification }) {
	if (failCount < MAX_PHASE_RETRY) {
		return { action: 'retry', nextPhase: phase, nextEscalations: escalations };
	}
	const nextEscalations = escalations + 1;
	if (nextEscalations > MAX_ESCALATION) {
		return { action: 'blocked', nextPhase: phase, nextEscalations };
	}
	return { action: 'escalate', nextPhase: classification?.nextPhase ?? 'implement', nextEscalations };
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
		// gateOverride(=투표 의결)면 done-gate 의 주관 임계만 우회(결정적 게이트는 유지).
		const extra = state.gateOverride ? ['--vote-override'] : [];
		// merge-step 내부에서 done-gate(있으면) 또는 HARNESS_GATE_OK 로 재게이트한다.
		const r = runNode([gitFlow, 'merge-step', nn, slug, ...extra], repoRoot);
		return { ok: r.code === 0, note: `git-flow merge-step ${nn} ${slug}${extra.length ? ' --vote-override' : ''} exit ${r.code}` };
	}
	return { ok: true, note: 'no-op' };
}

/**
 * 한 번의 invocation = 현재 페이즈 1개 실행 후 전진. 상태를 원자적으로 기록한다.
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string[]|null} params.initSteps `--init` 으로 주입된 planSteps (옵션)
 * @param {string} [params.debateOutcome] debate 결과 주입('pass'|'rework'|'fail'). 미지정 시 평가 파일로 판정.
 * @returns {{state:object, executedPhase:string, rerun:boolean, note:string, done:boolean}}
 */
export function runOnce({ repoRoot, initSteps = null, debateOutcome: debateOutcomeOpt, resume = false } = {}) {
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

	// blocked: 자동 복구를 포기한 상태. --resume 으로 명시 해제하기 전까지 전진하지 않는다.
	// (조용히 계속 돌아 같은 실패를 반복하는 것보다, 멈춰서 이유를 보여주는 편이 안전하다.)
	if (state.status === 'blocked') {
		if (!resume) {
			return {
				state,
				executedPhase: null,
				rerun: false,
				note: `status=blocked — ${state.blockedReason ?? '사유 미기록'} / 조치 후 'node scripts/loop.mjs --resume' 로 재개`,
				done: false,
			};
		}
		// 재개: 실패 카운터·에스컬레이션을 리셋하고 running 으로 되돌린다.
		state = { ...state, status: 'running', blockedReason: null, failures: {}, escalations: 0, committed: false };
		log('--resume: blocked 해제, 실패 카운터·에스컬레이션 초기화');
	}

	// status=init → running 으로 전이하며 첫 페이즈(decompose) 진입
	if (state.status === 'init' || state.phase === 'init') {
		state = { ...state, status: 'running', phase: PHASE_ORDER[0], phaseSeq: (state.phaseSeq ?? 0) + 1, committed: false };
	}

	// 멱등 재개: committed=false 인데 done 표시 상태면 현재 페이즈 재실행 (advance 안 함)
	const rerun = needsRerun(state);

	const phase = state.phase;
	let note;

	// debate 페이즈면 평가 결과(pass/rework)를 먼저 결정한다 — 전이 분기와 로그에 함께 사용.
	const debateOutcome = phase === 'debate' ? resolveDebateOutcome(state, repoRoot, { debateOutcome: debateOutcomeOpt }) : 'pass';

	// 스텝 시작(decompose) 진입 시 git step 브랜치(step/<nn>-<slug>)를 생성·체크아웃한다.
	// 이후 모든 작업(구현·verify)이 main 이 아니라 step 브랜치에서 일어나고, merge 페이즈에서
	// 그 브랜치를 main 에 병합·push 한다. (skipGitFlow 이거나 git-flow.mjs 없으면 자동 no-op)
	if (phase === PHASE_ORDER[0]) {
		startStepBranch(state, repoRoot);
	}

	if (DETERMINISTIC_PHASES.has(phase)) {
		const r = runDeterministicPhase(phase, state, repoRoot);
		note = `결정적 페이즈 '${phase}': ${r.note}`;
		log(note);
		if (!r.ok) {
			const routed = handleDeterministicFailure({ state, phase, detail: r.note, repoRoot, statePath, rerun });
			return routed;
		}
		// 성공 → 이 페이즈의 연속 실패 카운터를 리셋한다.
		state = { ...state, failures: { ...(state.failures ?? {}), [phase]: 0 } };
	} else if (AGENT_PHASES.has(phase)) {
		if (phase === 'debate') {
			note = `PHASE debate (outcome=${debateOutcome}, rework=${state.reworkCount ?? 0}/${MAX_REWORK}) requires agent work via /run-cycle`;
		} else if (phase === 'vote') {
			note = `PHASE vote — 재작업 ${MAX_REWORK}회 초과: 에이전트 투표(다수결+CEO 캐스팅보트) requires agent work via /run-cycle`;
		} else {
			note = `PHASE ${phase} requires agent work via /run-cycle`;
		}
		log(note);
		appendCycleLog(repoRoot, cycleEntry(state, phase, 'agent-required', note));
	} else {
		note = `알 수 없는 페이즈 '${phase}' — 스킵`;
		log(note);
	}

	// 현재 페이즈 완료 → 커밋 표시(비-git/스켈레톤이므로 sha=null) 후 다음으로 전진
	const committedState = markCommitted(state, state.lastCommittedSha ?? null);
	const { nextPhase, nextStepIdx, nextReworkCount, done } = computeTransition({
		phase,
		currentStepIdx: committedState.currentStepIdx ?? 0,
		stepCount: state.planSteps.length,
		reworkCount: state.reworkCount ?? 0,
		debateOutcome,
	});

	// gateOverride 갱신: vote 를 마치면 다음 merge 의 주관 임계를 우회하도록 켠다.
	// 새 step 의 decompose 로 진입하면(merge 후 전진) 끈다. 그 외에는 기존 값 유지.
	let gateOverride = state.gateOverride ?? false;
	if (phase === 'vote') gateOverride = true;
	if (phase === 'merge' && !done) gateOverride = false;

	// 새 step 으로 넘어가면 실패 카운터·에스컬레이션도 초기화한다 (step 마다 독립 — reworkCount 와 동일 정책).
	const stepChanged = phase === 'merge' && !done;
	const nextFailures = stepChanged ? {} : (state.failures ?? {});
	const nextEscalations = stepChanged ? 0 : (state.escalations ?? 0);

	let advanced;
	if (done) {
		advanced = { ...committedState, status: 'done', reworkCount: nextReworkCount, gateOverride };
	} else {
		advanced = {
			...advancePhase({ ...committedState, currentStepIdx: nextStepIdx }, nextPhase),
			reworkCount: nextReworkCount,
			failures: nextFailures,
			escalations: nextEscalations,
			gateOverride,
		};
	}
	writeState(statePath, advanced);

	// Notion 허브(계획·진행 상황·이슈·배포·top-3 불릿·콜아웃)는 /run-cycle 오케스트레이터가
	// 매 사이클 **커넥터로 직접 비파괴 갱신**한다(docs/notion-hub-layout.md). loop.mjs 는 git·상태만
	// 결정적으로 책임지며, 구조를 지우는 옛 REST 미러(upsertDashboard/flush)는 더 이상 수행하지 않는다.

	return { state: advanced, executedPhase: phase, rerun, note, done };
}

/**
 * 결정적 페이즈 실패를 분류·라우팅하고 상태를 기록한다 (I/O 담당 — 판정은 순수 함수에 위임).
 * @returns {{state:object, executedPhase:string, rerun:boolean, note:string, done:boolean}}
 */
function handleDeterministicFailure({ state, phase, detail, repoRoot, statePath, rerun }) {
	const failures = { ...(state.failures ?? {}) };
	const failCount = (failures[phase] ?? 0) + 1;
	failures[phase] = failCount;

	const gateStatus = readGateStatus(repoRoot, cycleIdOf(state));
	const classification = classifyFailure(phase, gateStatus);
	const routing = computeFailureRouting({
		phase,
		failCount,
		escalations: state.escalations ?? 0,
		classification,
	});

	const head = `'${phase}' 실패 ${failCount}/${MAX_PHASE_RETRY} — ${classification.kind} (${classification.why})`;

	if (routing.action === 'retry') {
		const next = { ...state, failures, committed: false };
		appendCycleLog(repoRoot, cycleEntry(state, phase, 'fail', `${detail} | ${head} → 재시도`));
		writeState(statePath, next);
		const note = `${head} → 같은 페이즈 재시도 (한도 도달 시 ${classification.nextPhase} 로 되돌림)`;
		log(note);
		return { state: next, executedPhase: phase, rerun, note, done: false };
	}

	if (routing.action === 'escalate') {
		// 되돌림: 카운터를 리셋하고 결함 분류가 지목한 페이즈로 보낸다.
		const committedState = markCommitted({ ...state, failures: { ...failures, [phase]: 0 } }, state.lastCommittedSha ?? null);
		const next = {
			...advancePhase(committedState, classification.nextPhase),
			escalations: routing.nextEscalations,
		};
		appendCycleLog(
			repoRoot,
			cycleEntry(state, phase, 'escalate', `${detail} | ${head} → ${classification.nextPhase} 로 되돌림`),
		);
		writeState(statePath, next);
		const note = `${head} → **${classification.kind}** 로 분류, '${classification.nextPhase}' 페이즈로 되돌림 (에스컬레이션 ${routing.nextEscalations}/${MAX_ESCALATION})`;
		log(note);
		return { state: next, executedPhase: phase, rerun, note, done: false };
	}

	// blocked — 항복. 이유를 남기고 멈춘다 (사람 호출).
	const reason = `${head} — 되돌림 ${MAX_ESCALATION}회를 모두 소진해 자동 복구 실패`;
	const next = { ...state, failures, escalations: routing.nextEscalations, status: 'blocked', blockedReason: reason, committed: false };
	appendCycleLog(repoRoot, cycleEntry(state, phase, 'blocked', `${detail} | ${reason}`));
	try {
		logError(repoRoot, {
			phase,
			where: `loop: 결정적 페이즈 '${phase}' (cycle ${cycleIdOf(state)})`,
			message: detail,
			cause: reason,
			fixSummary: `TBD — 수동 조치 후 'node scripts/loop.mjs --resume' 로 재개하세요. 분류: ${classification.kind} → ${classification.nextPhase}`,
		});
	} catch {
		// 오류 로그 실패는 blocked 판정에 영향 없음
	}
	writeState(statePath, next);
	log(`BLOCKED: ${reason}`);
	return { state: next, executedPhase: phase, rerun, note: `BLOCKED — ${reason}`, done: false };
}

/**
 * 스텝 시작 시 git step 브랜치(step/<nn>-<slug>)를 생성·체크아웃한다 (결정적 git 사이드이펙트).
 * 내부적으로 git-flow.mjs 의 start-step 을 호출한다:
 *   - skipGitFlow=true(=useGit=false) 면 git-flow 가 자동 no-op
 *   - scripts/git-flow.mjs 가 없으면(예: 셀프테스트 temp cwd) 호출 자체를 생략
 * start-step 실패(예: main 미시드)도 루프는 막지 않는다(로그만 — 문제는 merge 에서 드러남).
 */
function startStepBranch(state, repoRoot) {
	const gitFlow = path.join(repoRoot, 'scripts', 'git-flow.mjs');
	if (!existsSync(gitFlow)) return;
	const { nn, slug } = deriveStepRef(state);
	const r = runNode([gitFlow, 'start-step', nn, slug], repoRoot);
	log(`step 브랜치 준비: git-flow start-step ${nn} ${slug} (exit ${r.code})`);
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

/** CLI 인자: --debate=pass|rework|fail (env HARNESS_DEBATE_OUTCOME 폴백) */
function parseDebate(argv) {
	for (const a of argv) {
		if (a.startsWith('--debate=')) return a.slice('--debate='.length);
		if (a === '--debate') return undefined; // 값 없는 --debate 는 무시(평가 파일 판정)
	}
	return undefined;
}

function main() {
	const argv = process.argv.slice(2);
	const repoRoot = process.cwd();
	const initSteps = parseInit(argv);
	const debateOutcome = parseDebate(argv);
	const resume = argv.includes('--resume');

	const { state, executedPhase, rerun, note, done } = runOnce({ repoRoot, initSteps, debateOutcome, resume });

	const failNow = (state.failures ?? {})[state.phase] ?? 0;
	console.log('=== loop (1 phase / invocation) ===');
	console.log(`step: ${state.currentStepIdx + 1}/${state.planSteps.length} (${(state.planSteps ?? [])[state.currentStepIdx] ?? '-'})`);
	console.log(`cycle: ${cycleIdOf(state)}`);
	console.log(`phase: ${state.phase}  phaseSeq: ${state.phaseSeq}  status: ${state.status}  rework: ${state.reworkCount ?? 0}/${MAX_REWORK}${state.gateOverride ? '  (gateOverride)' : ''}`);
	if (failNow > 0 || (state.escalations ?? 0) > 0) {
		console.log(`failures: ${state.phase}=${failNow}/${MAX_PHASE_RETRY}  escalations: ${state.escalations ?? 0}/${MAX_ESCALATION}`);
	}
	if (executedPhase) console.log(`executed: ${executedPhase}${rerun ? ' (RERUN — 멱등 재개)' : ''}`);
	if (note) console.log(`note: ${note}`);
	if (done) console.log('루프 완료: 모든 step 소진 → status=done');
	if (state.status === 'blocked') {
		console.log('');
		console.log('*** BLOCKED — 자동 복구 실패. 아래를 확인한 뒤 재개하세요 ***');
		console.log(`  사유: ${state.blockedReason ?? '(미기록)'}`);
		console.log('  상세: harness/errors/ 최신 항목');
		console.log('  재개: node scripts/loop.mjs --resume');
	}

	// blocked 는 비정상 종료로 알린다 — 스크립트/오케스트레이터가 조용히 지나치지 않도록.
	process.exit(state.status === 'blocked' ? 3 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
