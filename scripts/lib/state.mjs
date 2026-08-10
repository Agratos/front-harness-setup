// state.mjs — 크래시-안전 상태 매니페스트 모듈 (US-005)
//
// 목적: 하니스 실행의 진행 상태(plan/phase/commit)를 단일 JSON 파일에
// 원자적으로(atomic) 기록·복원하여, rename↔commit 사이에 크래시가 나도
// "state 가 진실, 미커밋이면 재실행" 규칙으로 안전하게 재개할 수 있게 한다.
//
// 원자성: 쓰기는 항상 <statePath>.tmp 에 먼저 기록한 뒤 fs.renameSync 로
// 최종 경로로 교체한다. rename 은 동일 볼륨에서 원자적 연산이므로,
// 독자(reader)는 절대 반쯤 쓰인(half-written) 파일을 보지 않는다.
//
// 비-git 재개: useGit=false 이면 commit/sha 개념이 없으므로
// lastCommittedSha=null 을 그대로 허용하고, phaseSeq + checkpointToken 을
// 재개 앵커(anchor)로 사용한다.
//
// 스키마/규칙 상세 문서: docs/state-manifest.md
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 기본 상태 경로 헬퍼.
 * @param {string} repoRoot 저장소 루트 절대경로
 * @returns {string} harness/state.json 의 절대경로
 */
export function stateFilePath(repoRoot) {
	return path.join(repoRoot, 'harness', 'state.json');
}

/**
 * 현재 step 식별자 (`step-<idx>`).
 * @param {object|null} state
 * @returns {string}
 */
export function stepIdOf(state) {
	return `step-${state?.currentStepIdx ?? 0}`;
}

/**
 * 현재 **사이클** 식별자 (`step-<idx>#<reworkCount>`).
 *
 * 왜 step 이 아니라 사이클인가: 한 step 은 재작업(rework)마다 구현→검증→평가를 다시 돈다.
 * 신선도(freshness)를 step 단위로만 보면 **재작업 1회차의 평가가 3회차 merge 를 통과**시킨다
 * (실측 결함). reworkCount 를 포함시켜 "이번 라운드의 평가"만 유효하게 만든다.
 *
 * 한 라운드 안에서 evaluate→debate→merge 는 reworkCount 가 바뀌지 않으므로 id 가 유지되고,
 * debate 가 rework 판정을 내리는 순간(=다음 라운드 진입) 새 id 로 갈린다.
 *
 * @param {object|null} state
 * @returns {string}
 */
export function cycleIdOf(state) {
	return `${stepIdOf(state)}#${state?.reworkCount ?? 0}`;
}

/**
 * 페이즈 시퀀스를 입력받아 결정적(deterministic) checkpointToken 을 만든다.
 * 형식: `${phaseSeq}-${phase}-${counter}` (Math.random / Date 미사용).
 * counter 는 같은 (phaseSeq, phase) 조합의 재계산을 구분하기 위한 단조 카운터다.
 * @param {number} phaseSeq
 * @param {string} phase
 * @param {number} counter
 * @returns {string}
 */
function makeCheckpointToken(phaseSeq, phase, counter) {
	return `${phaseSeq}-${phase}-${counter}`;
}

/**
 * 새 상태 객체를 생성한다.
 * @param {string[]} [planSteps] 계획 단계 라벨 배열
 * @returns {{
 *   planSteps: string[],
 *   currentStepIdx: number,
 *   phase: string,
 *   phaseSeq: number,
 *   checkpointToken: string,
 *   committed: boolean,
 *   branch: string|null,
 *   lastCommittedSha: string|null,
 *   scores: object,
 *   reworkCount: number,
 *   failures: Record<string, number>,
 *   escalations: number,
 *   blockedReason: string|null,
 *   gateOverride: boolean,
 *   status: 'init'|'running'|'blocked'|'done'
 * }}
 */
export function defaultState(planSteps = []) {
	const phase = 'init';
	const phaseSeq = 0;
	return {
		planSteps: Array.isArray(planSteps) ? [...planSteps] : [],
		currentStepIdx: 0,
		phase,
		phaseSeq,
		checkpointToken: makeCheckpointToken(phaseSeq, phase, 0),
		committed: false,
		branch: null,
		lastCommittedSha: null,
		scores: {},
		reworkCount: 0,
		// 결정적 페이즈(verify/merge)의 **연속** 실패 횟수. 성공하면 그 페이즈 키가 0 으로 리셋된다.
		// 한도(MAX_PHASE_RETRY)를 넘으면 loop 가 같은 자리에 머무르지 않고 원인별로 분기한다.
		failures: {},
		// 분기(에스컬레이션) 횟수. 한도(MAX_ESCALATION)를 넘으면 status='blocked' 로 항복한다.
		// step 이 바뀌면 0 으로 초기화된다 — 무한 루프 방지의 마지막 안전장치.
		escalations: 0,
		// blocked 사유(사람이 읽는 한 줄). status!=='blocked' 면 null.
		blockedReason: null,
		// 투표 오버라이드: 5회 재작업 후 에이전트 투표가 "주관 임계(90점) 대체"를 의결하면
		// true 가 되어 다음 merge 의 done-gate 가 결정적 게이트만 강제(주관 임계 우회)하게 한다.
		// 새 step 으로 넘어가면 false 로 초기화된다 (step 마다 독립).
		gateOverride: false,
		status: 'init',
	};
}

/**
 * 상태 파일을 읽어 파싱한다.
 * @param {string} statePath state.json 경로
 * @returns {object|null} 파일이 없거나 파싱 실패 시 null
 */
export function readState(statePath) {
	if (!existsSync(statePath)) return null;
	try {
		return JSON.parse(readFileSync(statePath, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * 상태를 원자적으로 기록한다 (temp → rename).
 * 부모 디렉터리가 없으면 생성한다.
 * @param {string} statePath state.json 경로
 * @param {object} state 직렬화할 상태 객체
 */
export function writeState(statePath, state) {
	const dir = path.dirname(statePath);
	mkdirSync(dir, { recursive: true });
	const tmpPath = `${statePath}.tmp`;
	// 1) 임시 파일에 완전히 기록
	writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
	// 2) 원자적 rename 으로 최종 경로 교체 (동일 볼륨 → atomic)
	renameSync(tmpPath, statePath);
}

/**
 * 다음 페이즈로 진행한다. phaseSeq 단조 증가, phase 갱신,
 * checkpointToken 재생성, committed=false 리셋.
 * 원본을 변경하지 않고 새 객체를 반환한다(immutable).
 * @param {object} state 현재 상태
 * @param {string} nextPhase 다음 페이즈 이름
 * @returns {object} 새 상태
 */
export function advancePhase(state, nextPhase) {
	const phaseSeq = (state.phaseSeq ?? 0) + 1;
	return {
		...state,
		phase: nextPhase,
		phaseSeq,
		// counter=0: 새 phaseSeq 이므로 토큰 충돌 없음. phaseSeq 단조증가가 유일성 보장.
		checkpointToken: makeCheckpointToken(phaseSeq, nextPhase, 0),
		committed: false,
	};
}

/**
 * 현재 페이즈를 커밋 완료로 표시한다.
 * useGit=false 경로에서는 sha 가 null 일 수 있다.
 * 원본을 변경하지 않고 새 객체를 반환한다(immutable).
 * @param {object} state 현재 상태
 * @param {string|null} [sha] 커밋 SHA (비-git 이면 null)
 * @returns {object} 새 상태
 */
export function markCommitted(state, sha = null) {
	return {
		...state,
		committed: true,
		lastCommittedSha: sha,
	};
}

/**
 * 재실행 필요 여부 판정.
 * 규칙: phase 가 종료(done)로 간주되는데 committed=false 이면 true.
 *   - rename(=state 기록) 은 성공했지만 commit 직전/직후 크래시한 상태를 의미.
 *   - "state 가 진실, 미커밋이면 멱등 재실행" 정책에 따라 해당 페이즈를 다시 실행한다.
 * 여기서 "phase done" 은 status==='done' 또는 모든 planSteps 를 소진
 * (currentStepIdx >= planSteps.length 이고 planSteps.length > 0) 한 경우로 본다.
 * @param {object} state
 * @returns {boolean}
 */
export function needsRerun(state) {
	if (!state) return false;
	const phaseDone =
		state.status === 'done' ||
		(Array.isArray(state.planSteps) &&
			state.planSteps.length > 0 &&
			state.currentStepIdx >= state.planSteps.length);
	return phaseDone && state.committed === false;
}
