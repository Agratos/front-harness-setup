// phase-gate.mjs — **페이즈 산출물 계약**(phase artifact contract). v3 2단계 / 1차 진단 F1.
//
// 왜 필요한가:
//   드라이버는 `verify`(E2E)와 `evaluate`(평가 산출물) **두 칸만** 코드로 막고 있었다.
//   나머지 에이전트 페이즈(decompose/design/implement/debate/vote)는 산출물을 아무것도
//   요구하지 않고 `PHASE <name> requires agent work` 를 찍고 **무조건 전진**했다.
//   즉 오케스트레이터가 그 페이즈를 통째로 건너뛰어도 하네스는 알아채지 못했다 —
//   `run-cycle.md` 의 "⛔ 에이전트 페이즈를 no-op 로 건너뛰지 않는다" 는 검사자가 없는 문장이었다.
//
//   이 모듈은 개별 배선(F4=verify, F17=evaluate)을 **페이즈 계약**으로 일반화한다:
//   각 페이즈는 "이번 사이클에 무엇을 남겨야 하는가" 를 선언하고, 드라이버는 전진 직전에 그것을 확인한다.
//
// 세 종류의 증거만 쓴다 (새 산출물 형식을 발명하지 않는다):
//   1) `decision` — `harness/decisions/*.md` 에 이번 (사이클, 페이즈) 스탬프가 찍힌 협의 기록
//      (decompose/design/debate/vote. 하네스가 이미 "단일 진실 공급원" 이라고 부르는 그 파일이다)
//   2) `spec`     — `harness/eval-scenario.json` + `harness/plan.json` 의 AC 커버리지
//      (design 전용. `eval-scenario --preflight` 와 **같은 판정 함수**를 재사용한다)
//   3) `code`     — 페이즈에 진입한 시점 대비 **실제 코드 변경**(git 지문 비교, harness/docs 제외)
//      (implement 전용)
//
// 뿌리 원칙 (2차 자기진단): **증거 부재는 통과가 아니다.**
//   skip 은 **환경 부재**에만 허용한다 — 이 계약의 환경 조건은 `scripts/record-decision.mjs`
//   (기록 도구)의 존재다. 스켈레톤·셀프테스트 임시 cwd 에는 그 도구가 없으므로 계약이 비활성이고,
//   도구를 갖춘 실제 저장소에서는 **전원 활성**이다. code 검사는 추가로 git 이 있어야 한다.
//
// 면제는 명시로: 코드 변경이 필요 없는 step(문서·설정만)은 `--phase=implement` 기록을 남겨
//   "왜 코드가 없는가" 를 적는다. 침묵의 통과는 없다.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { preflight } from '../eval-scenario.mjs';
import { artifactMarker, findPhaseRecord } from './artifact.mjs';
import { cycleIdOf } from './state.mjs';

/**
 * 페이즈별 계약. `kind` 는 요구하는 증거 종류다.
 * evaluate 는 `loop.mjs` 의 runEvaluatePhase 가 **산출물 생성까지** 강제하므로 여기서 중복 검사하지 않는다.
 */
export const PHASE_CONTRACT = {
	decompose: { kind: 'decision', what: 'step 분해 협의 기록' },
	design: { kind: 'spec+decision', what: '수용기준(AC)·상호작용 스펙 확정 + 설계 결정 기록' },
	implement: { kind: 'code', what: '실제 코드 변경(또는 명시적 면제 기록)' },
	evaluate: { kind: 'evaluation', what: '이번 사이클 평가 산출물 + 격리 리뷰 스탬프 (runEvaluatePhase 가 강제)' },
	debate: { kind: 'decision', what: '평가 결과 토론 결론 기록' },
	vote: { kind: 'decision', what: '투표 결과(표 분포·캐스팅보트) 기록' },
};

/** 기록 도구 경로 — 이 계약의 **환경 조건**이자, 실패 메시지가 안내하는 명령이다. */
export function recorderPath(repoRoot) {
	return path.join(repoRoot, 'scripts', 'record-decision.mjs');
}

/**
 * 계약이 활성인가 = 기록 도구가 있는가.
 * (도구가 없는 환경에서 기록을 요구하면 만들 방법이 없다 → 환경 부재로 skip)
 */
export function contractActive(repoRoot) {
	return existsSync(recorderPath(repoRoot));
}

// 스탬프 형식·스캐너는 leaf 모듈(`artifact.mjs`)이 단일 정의한다 — 쓰는 쪽(logDecision)과 공유한다.
export { artifactMarker, findPhaseRecord };

/** git 명령 실행 → trim 된 stdout, 실패하면 null. */
function git(repoRoot, args) {
	try {
		return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
	} catch {
		return null;
	}
}

/** 산출물·문서 경로인가 — 코드 변경 판정에서 제외한다. */
function isArtifactPath(p) {
	return p.startsWith('harness/') || p.startsWith('docs/') || p.startsWith('.omc/');
}

/** porcelain/numstat 한 줄에서 경로만 뽑는다(rename 은 `->` 뒤가 새 경로). */
function pathOfLine(line) {
	const s = line.replace(/^"|"$/g, '');
	const arrow = s.split(' -> ');
	const tail = arrow[arrow.length - 1];
	const parts = tail.trim().split(/\s+/);
	return parts[parts.length - 1].replace(/^"|"$/g, '');
}

/**
 * **코드** 지문 — HEAD + (harness/docs 를 제외한) 작업트리 변경 상태.
 *
 * 왜 `loop.mjs` 의 repoFingerprint 와 따로 두는가: 저 지문은 "무엇이든 달라졌는가"(blocked 재개 판정)를
 * 보고, 이 지문은 **"코드가 달라졌는가"** 를 본다. 하네스는 매 페이즈 `harness/` 에 상태·로그를 쓰므로
 * 그것을 포함시키면 **구현을 안 해도 항상 "변경 있음"** 이 되어 검사가 무의미해진다.
 *
 * @returns {string|null} git 을 쓸 수 없으면 null (환경 부재)
 */
export function codeFingerprint(repoRoot) {
	const head = git(repoRoot, ['rev-parse', 'HEAD']);
	if (head === null) return null; // git 저장소가 아니거나 커밋이 없다
	const pick = (text) =>
		String(text ?? '')
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.filter((l) => !isArtifactPath(pathOfLine(l)))
			.sort()
			.join(';');
	// numstat = 추가/삭제 줄 수까지 포함 → 같은 파일 내부 수정도 감지한다.
	const numstat = pick(git(repoRoot, ['diff', 'HEAD', '--numstat']));
	const porcelain = pick(git(repoRoot, ['status', '--porcelain']));
	return `${head}|${numstat}|${porcelain}`;
}

/**
 * decision 증거 검사 (decompose/design/debate/vote 공용).
 * @returns {{ok:boolean, reason:string, hint?:string}}
 */
function checkDecisionRecord(repoRoot, state, phase) {
	const cycleId = cycleIdOf(state);
	const { found, file } = findPhaseRecord(repoRoot, cycleId, phase);
	if (found) return { ok: true, reason: `결정 기록 확인 — ${file}` };
	return {
		ok: false,
		reason: `이번 사이클(${cycleId})의 '${phase}' 결정 기록이 없습니다 — ${PHASE_CONTRACT[phase]?.what ?? '협의 기록'}`,
		hint: `node scripts/record-decision.mjs --phase=${phase} --topic="<안건>" --conclusion="<결론>" --why="<근거>"`,
	};
}

/**
 * design 의 스펙·AC 계약 검사.
 * `eval-scenario --preflight` 와 **같은 함수**를 쓴다 — 두 곳에 규칙을 적으면 반드시 어긋난다.
 * 여기서 막으면 verify 까지 가서 `implement` 를 통째로 낭비한 뒤 되돌아오는 왕복이 사라진다.
 * @returns {{ok:boolean, reason:string, unverifiable?:string}}
 */
function checkSpecContract(repoRoot) {
	// 러너가 없는 환경(스켈레톤)에서는 스펙 계약을 강제하지 않는다 — verify 의 E2E 강제와 동일한 조건.
	if (!existsSync(path.join(repoRoot, 'scripts', 'eval-scenario.mjs'))) {
		return { ok: true, reason: '스펙 계약 생략(eval-scenario.mjs 없음 — 환경 부재)' };
	}
	const pf = preflight({ spec: null, id: 'phase-gate' }, repoRoot);
	if (pf.ok) return { ok: true, reason: `스펙·AC 계약 충족 — ${pf.reason}` };
	return { ok: false, unverifiable: pf.unverifiable, reason: `스펙·AC 계약 미충족(${pf.unverifiable}) — ${pf.reason}` };
}

/**
 * implement 의 코드 변경 검사.
 * 기준선은 **이 페이즈에 진입한 시점**의 코드 지문(`state.phaseEntryCode`)이다.
 * 재작업(rework) 라운드도 같은 규칙을 받으므로 "아무것도 고치지 않은 빈 재작업" 이 통과하지 못한다.
 * @returns {{ok:boolean, reason:string, hint?:string}}
 */
function checkCodeWork(repoRoot, state) {
	const now = codeFingerprint(repoRoot);
	if (now === null) return { ok: true, reason: '코드 변경 검사 생략(git 사용 불가 — 환경 부재)' };
	const before = state?.phaseEntryCode;
	if (typeof before !== 'string') {
		// 이 페이즈 진입 시점의 기준선이 없다(구 버전 상태 파일에서 업그레이드된 경우).
		// 기준선 없이 판정하면 무엇과 비교했는지 말할 수 없으므로 검사하지 않는다 — 다음 페이즈부터 활성.
		return { ok: true, reason: '코드 변경 검사 생략(진입 시점 기준선 없음 — 다음 사이클부터 활성)' };
	}
	if (now !== before) return { ok: true, reason: '코드 변경 확인(진입 시점 대비 diff 있음)' };
	// 코드가 없다 → 명시적 면제 기록이 있으면 통과시킨다(면제는 침묵이 아니라 기록으로).
	const cycleId = cycleIdOf(state);
	const { found, file } = findPhaseRecord(repoRoot, cycleId, 'implement');
	if (found) return { ok: true, reason: `코드 변경 없음 — 명시적 면제 기록 확인(${file})` };
	return {
		ok: false,
		reason: `implement 진입 이후 코드 변경이 없습니다(harness/·docs/ 제외) — 구현을 건너뛰었거나 빈 재작업 라운드입니다`,
		hint: `구현하거나, 코드가 필요 없다면 면제를 기록하세요: node scripts/record-decision.mjs --phase=implement --topic="<이 step>" --conclusion="코드 변경 불필요" --why="<이유>"`,
	};
}

/**
 * 페이즈 산출물 계약 확인 — 드라이버가 **전진 직전**에 호출한다.
 *
 * @param {{repoRoot:string, state:object, phase:string}} p
 * @returns {{ok:boolean, skipped:boolean, kind:string|null, reason:string, hint?:string,
 *            cause?:{artifact?:string, e2e?:string, unverifiable?:string}}}
 */
export function checkPhaseContract({ repoRoot, state, phase }) {
	const contract = PHASE_CONTRACT[phase];
	if (!contract) return { ok: true, skipped: true, kind: null, reason: `'${phase}' 는 산출물 계약이 없는 페이즈` };
	// evaluate 는 산출물 생성 자체를 코드가 수행하므로(runEvaluatePhase) 여기서 중복 검사하지 않는다.
	if (phase === 'evaluate') return { ok: true, skipped: true, kind: contract.kind, reason: 'evaluate 계약은 runEvaluatePhase 가 강제' };
	if (!contractActive(repoRoot)) {
		return {
			ok: true,
			skipped: true,
			kind: contract.kind,
			reason: '페이즈 산출물 계약 비활성(scripts/record-decision.mjs 없음 — 환경 부재)',
		};
	}

	if (phase === 'implement') {
		const r = checkCodeWork(repoRoot, state);
		return { ...r, skipped: false, kind: contract.kind, cause: r.ok ? undefined : { artifact: 'code' } };
	}

	if (phase === 'design') {
		// 값싼 순서: 스펙·AC(파일 읽기만) → 결정 기록. 둘 다 0초지만 스펙 실패가 더 구체적인 지시를 준다.
		const spec = checkSpecContract(repoRoot);
		if (!spec.ok) {
			return {
				ok: false,
				skipped: false,
				kind: contract.kind,
				reason: spec.reason,
				hint: 'harness/plan.json 의 acceptance[] 와 harness/eval-scenario.json 의 단언(ac 태그)을 이 페이즈에서 확정하세요',
				// 스펙·AC 문제는 verify 와 **같은 분류**를 받는다(설계결함) — 규칙이 두 갈래로 갈리지 않게.
				cause: { e2e: 'unverifiable', unverifiable: spec.unverifiable },
			};
		}
		const rec = checkDecisionRecord(repoRoot, state, phase);
		return {
			...rec,
			skipped: false,
			kind: contract.kind,
			reason: `${spec.reason} / ${rec.reason}`,
			cause: rec.ok ? undefined : { artifact: 'decision' },
		};
	}

	const rec = checkDecisionRecord(repoRoot, state, phase);
	return { ...rec, skipped: false, kind: contract.kind, cause: rec.ok ? undefined : { artifact: 'decision' } };
}

export default {
	PHASE_CONTRACT,
	recorderPath,
	contractActive,
	artifactMarker,
	findPhaseRecord,
	codeFingerprint,
	checkPhaseContract,
};
