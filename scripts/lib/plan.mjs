// plan.mjs — 사용자 의도(수용기준 AC)를 기계가 읽는 형태로 잇는 모듈. (순수 함수 + 파일 읽기만)
//
// 왜 필요한가:
//   `/start-project` 인터뷰는 `docs/spec/interview-*.md` 를 남기지만, 하네스가 실제로 들고 있는
//   계획은 `state.planSteps` = **문자열 라벨 배열**뿐이었다. 그래서:
//     ① 루브릭은 "화면이 떴는가" 만 채점하고 "무엇을 만들어야 했는가" 는 모른다
//     ② "AC 4/4 달성" 을 사람이 손으로 세고 있었다
//     ③ step 이 무엇을 만족하면 끝인지 코드가 모른다 → **의도와 다르게 개발돼도 하네스가 모른다**
//
//   plan.json 은 그 빈칸을 채운다. step 별 수용기준(AC)을 선언하고, 상호작용 스펙
//   (`harness/eval-scenario.json`)의 단언마다 `"ac": "AC-1"` 태그로 어느 AC 를 덮는지 표시한다.
//   verify 는 **모든 AC 가 최소 1개 단언으로 덮였는지** 검사한다(커버리지 게이트).
//
//   → "테스트는 통과했지만 요구사항은 검증되지 않았다" 를 코드가 잡는다.
//
// 하위호환: `harness/plan.json` 이 **없으면 전부 no-op**(present=false). 기존 프로젝트·데모·
//   셀프테스트는 영향받지 않는다. 있으면 그 순간부터 커버리지가 강제된다.
//
// 스키마 (harness/plan.json):
//   {
//     "steps": [
//       {
//         "label": "01-task-board",           // state.planSteps 의 라벨과 일치시킨다
//         "goal": "작업을 등록하고 상태를 바꾼다",   // 사람이 읽는 한 줄(선택)
//         "acceptance": [
//           { "id": "AC-1", "text": "제목·담당자를 입력해 작업을 추가하면 목록에 보인다" },
//           { "id": "AC-2", "text": "추가 후 입력 폼이 비워진다" }
//         ]
//       }
//     ]
//   }
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// 정규화 JSON 은 eval-review 의 canonicalize 하나만 쓴다 — 해시 규칙을 두 곳에 적으면 반드시 어긋난다.
import { canonicalize } from '../eval-review.mjs';

/** harness/plan.json 경로. */
export function planPath(repoRoot) {
	return path.join(repoRoot, 'harness', 'plan.json');
}

/** harness/eval-scenario.json (상호작용 스펙 정본) 경로. */
export function scenarioSpecPath(repoRoot) {
	return path.join(repoRoot, 'harness', 'eval-scenario.json');
}

/**
 * 계획을 읽는다. 파일이 없으면 `{present:false}`(no-op), 깨졌으면 `{present:true, error}`.
 * @returns {{present:boolean, plan?:object, error?:string}}
 */
export function readPlan(repoRoot) {
	const p = planPath(repoRoot);
	if (!existsSync(p)) return { present: false };
	try {
		const plan = JSON.parse(readFileSync(p, 'utf8'));
		if (!Array.isArray(plan.steps)) {
			return { present: true, error: 'plan.json 형식 오류: steps 배열이 없습니다' };
		}
		return { present: true, plan };
	} catch (e) {
		return { present: true, error: `plan.json 파싱 실패: ${String(e?.message ?? e).slice(0, 200)}` };
	}
}

/**
 * 현재 step 에 해당하는 계획 항목을 찾는다.
 * 라벨 일치를 우선하고(계획을 재배열해도 안전), 없으면 인덱스로 폴백한다.
 * @param {object} plan readPlan().plan
 * @param {{label?:string, idx?:number}} where
 * @returns {{step:object|null, matchedBy:'label'|'index'|null}}
 */
export function findStep(plan, { label, idx }) {
	const steps = plan?.steps ?? [];
	if (label) {
		const byLabel = steps.find((s) => s?.label === label);
		if (byLabel) return { step: byLabel, matchedBy: 'label' };
	}
	if (Number.isInteger(idx) && idx >= 0 && idx < steps.length) {
		return { step: steps[idx], matchedBy: 'index' };
	}
	return { step: null, matchedBy: null };
}

/**
 * 계획을 **시드 입력**으로 쓸 수 있는지 검증한다.
 *
 * 왜 필요한가: 예전에는 계획이 두 곳에 따로 있었다 —
 *   ① `loop.mjs --init "01-login,02-dashboard"` 의 문자열 인자 (state.planSteps 가 됨)
 *   ② `harness/plan.json` 의 수용기준
 * 같은 계획을 **두 번 적는** 구조라 라벨이 어긋나면 AC 가 엉뚱한 step 에 붙거나 조용히 무시됐다.
 * 이제 plan.json 이 정본이고 planSteps 는 여기서 **파생**된다(`--init-plan`).
 *
 * @param {object} plan
 * @returns {{ok:boolean, errors:string[], warnings:string[], labels:string[]}}
 */
export function validatePlan(plan) {
	const errors = [];
	const warnings = [];
	const steps = Array.isArray(plan?.steps) ? plan.steps : null;
	if (!steps) return { ok: false, errors: ['steps 가 배열이 아닙니다'], warnings, labels: [] };
	if (steps.length === 0) return { ok: false, errors: ['steps 가 비어 있습니다 — 최소 1개 step 이 필요합니다'], warnings, labels: [] };

	const labels = [];
	const seen = new Set();
	steps.forEach((s, i) => {
		const label = typeof s?.label === 'string' ? s.label.trim() : '';
		if (!label) {
			errors.push(`steps[${i}]: label 이 없습니다 (예: "01-login")`);
			return;
		}
		if (seen.has(label)) errors.push(`steps[${i}]: label 중복 — "${label}"`);
		seen.add(label);
		labels.push(label);
		// 라벨은 git 브랜치명(step/<nn>-<slug>)으로 직결되므로 형식을 권고한다.
		if (!/^\d{1,3}[-_ ]/.test(label)) {
			warnings.push(`steps[${i}] "${label}": "<nn>-<slug>" 형식을 권장합니다 (브랜치명 step/<nn>-<slug> 로 직결)`);
		}
	});

	// 첫 step 에 AC 가 없으면 첫 사이클이 "무엇을 만들려는지 모르는 상태"로 돌아간다 — 막는다.
	if (labels.length > 0 && acceptanceOf(steps[0]).length === 0) {
		errors.push(`steps[0] "${steps[0]?.label ?? '?'}": acceptance 가 비어 있습니다 — 첫 step 의 수용기준은 필수입니다`);
	}
	steps.slice(1).forEach((s, i) => {
		if (acceptanceOf(s).length === 0) {
			warnings.push(`steps[${i + 1}] "${s?.label ?? '?'}": acceptance 미작성 — design 페이즈에서 채우세요(그 전까지 AC 검사 비활성)`);
		}
	});

	return { ok: errors.length === 0, errors, warnings, labels };
}

/** step 의 AC 목록을 정규화(문자열 축약형도 허용: "AC-1: 텍스트"). */
export function acceptanceOf(step) {
	const raw = step?.acceptance ?? [];
	if (!Array.isArray(raw)) return [];
	return raw
		.map((a, i) => {
			if (typeof a === 'string') {
				const m = /^\s*(AC-[\w.]+)\s*[:：]\s*(.+)$/.exec(a);
				return m ? { id: m[1], text: m[2].trim() } : { id: `AC-${i + 1}`, text: a.trim() };
			}
			if (a && typeof a === 'object' && a.id) return { id: String(a.id), text: String(a.text ?? '') };
			return null;
		})
		.filter(Boolean);
}

/**
 * 시나리오 스펙에서 `ac` 태그를 모은다.
 * 단언(assert) 뿐 아니라 시나리오 레벨 `ac`(문자열 또는 배열)도 인정한다 —
 * 한 시나리오 전체가 하나의 AC 를 증명하는 경우가 흔하다.
 * @param {object} spec eval-scenario.json 내용
 * @returns {Set<string>}
 */
export function coveredAcIds(spec) {
	const covered = new Set();
	const add = (v) => {
		if (typeof v === 'string' && v.trim()) covered.add(v.trim());
		else if (Array.isArray(v)) v.forEach(add);
	};
	for (const sc of spec?.scenarios ?? []) {
		add(sc?.ac);
		for (const step of sc?.steps ?? []) add(step?.ac);
	}
	return covered;
}

/**
 * 계획 전체(모든 step)의 AC id 집합.
 *
 * 왜 필요한가: 상호작용 스펙은 이전 step 의 시나리오를 **회귀 검증으로 남긴다**(권장 운용).
 * 그 시나리오의 `ac` 태그는 다른 step 의 AC 이므로, 현재 step 기준으로만 보면
 * "계획에 없는 태그"(=오타 신호)로 오탐된다 — step 이 쌓일수록 목록이 길어져 **진짜 오타를 가린다**
 * (테스트벤치 시행 6, T6-1 실측).
 * @param {object|null} plan readPlan().plan
 * @returns {Set<string>}
 */
export function allAcIds(plan) {
	const ids = new Set();
	for (const step of plan?.steps ?? []) {
		for (const ac of acceptanceOf(step)) ids.add(ac.id);
	}
	return ids;
}

/**
 * AC 커버리지 판정 — 이 step 의 모든 AC 가 최소 1개 단언/시나리오로 덮였는가.
 *
 * @param {object|null} planStep findStep().step
 * @param {object|null} spec eval-scenario.json 내용 (없으면 null)
 * @param {{knownAcIds?: Set<string>}} [opts] 계획 전체의 AC id 집합(`allAcIds(plan)`).
 *   주면 다른 step 의 AC 태그를 오타(`unknown`)와 **구분**한다. 안 주면 종전과 동일하게 동작한다.
 * @returns {{
 *   applicable: boolean,      // 이 step 에 AC 가 선언돼 있는가 (없으면 검사 대상 아님)
 *   total: number,
 *   covered: string[],
 *   missing: string[],
 *   unknown: string[],        // 계획 어디에도 없는 AC id (오타 탐지 — 이것만 경고 가치가 있다)
 *   otherSteps: string[],     // 다른 step 의 AC id (회귀 시나리오 — 정상)
 *   ok: boolean
 * }}
 */
export function checkAcCoverage(planStep, spec, opts = {}) {
	const acs = acceptanceOf(planStep);
	if (acs.length === 0) {
		return { applicable: false, total: 0, covered: [], missing: [], unknown: [], otherSteps: [], ok: true };
	}
	const tagged = coveredAcIds(spec);
	const ids = acs.map((a) => a.id);
	const covered = ids.filter((id) => tagged.has(id));
	const missing = ids.filter((id) => !tagged.has(id));
	// 이 step 의 AC 가 아닌 태그들. 계획 전체를 알면 "다른 step 의 것(정상)" 과
	// "계획 어디에도 없는 것(오타·낡은 계획)" 으로 갈라야 경고가 신호로 남는다.
	const foreign = [...tagged].filter((id) => !ids.includes(id));
	const known = opts.knownAcIds instanceof Set ? opts.knownAcIds : null;
	const otherSteps = known ? foreign.filter((id) => known.has(id)) : [];
	const unknown = known ? foreign.filter((id) => !known.has(id)) : foreign;
	return { applicable: true, total: ids.length, covered, missing, unknown, otherSteps, ok: missing.length === 0 };
}

/**
 * 사람이 읽는 커버리지 한 줄 요약.
 * @param {ReturnType<typeof checkAcCoverage>} cov
 */
export function formatCoverage(cov) {
	if (!cov.applicable) return 'AC 미선언 (plan.json 에 이 step 의 acceptance 가 없음)';
	const head = `AC ${cov.covered.length}/${cov.total} 덮임`;
	const miss = cov.missing.length ? ` · 미검증: ${cov.missing.join(', ')}` : '';
	// 다른 step 의 AC 는 회귀 시나리오의 정상 신호이므로 **건수만** 알린다(목록을 나열하면 소음이 된다).
	const other = cov.otherSteps?.length ? ` · 회귀(다른 step AC) ${cov.otherSteps.length}건` : '';
	const unk = cov.unknown.length ? ` · ⚠ 계획에 없는 태그: ${cov.unknown.join(', ')}` : '';
	return head + miss + other + unk;
}

/** 상호작용 스펙 파일을 파싱해 반환 (없거나 깨지면 null — 지문/최종 검사는 null 도 입력으로 취급). */
function readScenarioSpec(repoRoot) {
	try {
		return JSON.parse(readFileSync(scenarioSpecPath(repoRoot), 'utf8'));
	} catch {
		return null;
	}
}

/**
 * 스펙 지문 — 현재 step 의 수용기준(AC) + 상호작용 스펙(eval-scenario.json) 전체의 정규화 sha256.
 *
 * 왜 필요한가: AC 와 E2E 단언을 확정하는 세션(design)이 곧 구현을 지휘하는 세션이라,
 * 구현이 어려우면 **같은 세션이 검증 기준을 사후 완화**해도 탐지 장치가 없었다(감사 발견 —
 * phase-gate 는 커버리지의 '존재'만 검사하지 '불변'은 검사하지 않는다). design 이 확정 시점에
 * 이 지문을 동결(state.specFreeze)로 남기고, verify 와 done-gate 가 대조한다.
 * 정당한 기준 변경은 design 재진입(재설계)으로만 — 그때 지문이 재동결된다.
 *
 * @param {string} repoRoot
 * @param {{label?:string, idx?:number}} where 현재 step (findStep 규칙과 동일)
 * @returns {{present:boolean, hash:string|null}} plan.json 이 없으면 present=false(동결 비활성)
 */
export function specFingerprint(repoRoot, where = {}) {
	const { present, plan, error } = readPlan(repoRoot);
	if (!present || error || !plan) return { present: false, hash: null };
	const { step } = findStep(plan, where);
	const core = { acceptance: acceptanceOf(step), scenario: readScenarioSpec(repoRoot) };
	return { present: true, hash: createHash('sha256').update(canonicalize(core), 'utf8').digest('hex') };
}

/**
 * 최종 수용 검사 — 모든 step 을 병합했다고 끝내기 전에, **계획 전체**가 검증으로 덮였는지 본다.
 *
 * 왜 필요한가: step 게이트는 "그 step 에 선언된 AC" 만 본다. 그래서 두 구멍이 남았다(감사 발견):
 *   ① acceptance 를 끝내 채우지 않은 step(후행 step 은 경고만)은 AC 검사 없이 완주한다
 *   ② `status=done` = "모든 step 이 merge 됨" 일 뿐, 사용자 목적 전체의 달성 검사가 없다
 * ①과 "선언됐지만 미검증인 AC" 는 여기서 결정적으로 잡는다. (step 분해 자체가 인터뷰 목표를
 * 빠뜨린 경우는 코드가 알 수 없다 — gaps 가 비어도 인터뷰 문서 대조는 별도 리뷰의 몫이다.)
 *
 * @param {string} repoRoot
 * @returns {{applicable:boolean, ok:boolean, gaps:string[]}} plan.json 없으면 applicable=false(하위호환)
 */
export function checkFinalAcceptance(repoRoot) {
	const { present, plan, error } = readPlan(repoRoot);
	if (!present) return { applicable: false, ok: true, gaps: [] };
	if (error || !plan) return { applicable: true, ok: false, gaps: [`plan.json 읽기 실패 — ${error ?? '형식 오류'}`] };
	const spec = readScenarioSpec(repoRoot);
	const known = allAcIds(plan);
	const gaps = [];
	(plan.steps ?? []).forEach((step, i) => {
		const label = step?.label ?? `steps[${i}]`;
		if (acceptanceOf(step).length === 0) {
			gaps.push(`"${label}": acceptance 미작성(design 에서 끝내 채워지지 않음)`);
			return;
		}
		const cov = checkAcCoverage(step, spec, { knownAcIds: known });
		if (!cov.ok) gaps.push(`"${label}": AC 미검증 — ${cov.missing.join(', ')}`);
	});
	return { applicable: true, ok: gaps.length === 0, gaps };
}

export default {
	planPath,
	scenarioSpecPath,
	readPlan,
	validatePlan,
	findStep,
	acceptanceOf,
	allAcIds,
	coveredAcIds,
	checkAcCoverage,
	formatCoverage,
	specFingerprint,
	checkFinalAcceptance,
};
