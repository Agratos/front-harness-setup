// rubric.mjs — 평가 루브릭 채점 (순수 함수, I/O 없음) (US-009)
//
// docs/eval-rubric.md 의 고정 채점 기준을 코드로 옮긴 것입니다.
// 4개 차원(UI/UX/기능/품질) × 체크리스트 항목 → 0~100 점.
// "불만(complaint) = 실패한 체크리스트 항목" 이며, 항목별 심각도(major/minor)는
// 여기에 고정됩니다(평가자 재량 아님). I/O 가 없으므로 selftest 에서 결정적으로 검증됩니다.
//
// ── 미관찰(null/undefined)은 통과가 아니다 (2차 자기진단 F19) ──────────────────
// 예전에는 관찰 기반 항목이 `o.x !== false` 형태여서, **관찰하지 못한 값(undefined)** 이
// 통과로 계산됐다. 정적 폴백은 그 위에 `appMounted: serverReady===true` 처럼 관찰하지 않은
// 사실까지 참으로 채워 넣어, **브라우저를 한 번도 띄우지 않고 종합 92점 / major 0** 을 받았다.
// 이제 관찰 기반 항목은 `=== true`(또는 유한한 수)만 통과로 인정하고, 미관찰은 불만으로 남긴다.
// 결과적으로 정적 폴백은 구조적으로 done-gate 임계(90)를 넘을 수 없다 — 모르면 통과시키지 않는다.

/** 관찰된 참값만 통과. null/undefined(미관찰) → 실패. */
const observedTrue = (v) => v === true;
/** 관찰된 카운트가 0 이어야 통과. null/undefined(미관찰) → 실패. */
const observedZero = (v) => Number.isFinite(v) && Number(v) === 0;

/**
 * 차원 정의. 각 항목: { id, weight(배점, 차원 합=100), severity('major'|'minor'),
 * check(obs)→boolean (관찰값으로 통과 판정) }.
 * dimWeight 합은 1.00 (docs/eval-rubric.md §3).
 */
export const DIMENSIONS = [
	{
		key: 'ui',
		label: 'UI',
		dimWeight: 0.25,
		items: [
			{ id: 'ui.renders', weight: 40, severity: 'major', check: (o) => observedTrue(o.bodyNonEmpty) },
			{ id: 'ui.title', weight: 20, severity: 'minor', check: (o) => observedTrue(o.titleMatches) },
			{ id: 'ui.heading', weight: 30, severity: 'major', check: (o) => observedTrue(o.headingPresent) },
			{ id: 'ui.no-console-error', weight: 10, severity: 'minor', check: (o) => observedZero(o.consoleErrors) },
		],
	},
	{
		key: 'ux',
		label: 'UX',
		dimWeight: 0.2,
		items: [
			{ id: 'ux.load-fast', weight: 40, severity: 'major', check: (o) => observedTrue(o.serverReady) },
			{ id: 'ux.layout-stable', weight: 20, severity: 'minor', check: (o) => observedTrue(o.layoutStable) },
			{ id: 'ux.responsive-meta', weight: 15, severity: 'minor', check: (o) => observedTrue(o.hasViewportMeta) },
			// 반응형: 좁은 뷰포트(모바일)에서 가로 overflow 가 없는가 (관찰 필수 — 미관찰은 불만)
			{ id: 'ux.responsive-layout', weight: 15, severity: 'minor', check: (o) => observedTrue(o.responsiveLayout) },
			// a11y: 페이지에 landmark(nav/main 등)가 1개 이상인가 (관찰 필수 — 미관찰은 불만)
			{ id: 'ux.a11y-landmarks', weight: 10, severity: 'minor', check: (o) => observedTrue(o.hasLandmarks) },
		],
	},
	{
		key: 'fn',
		label: '기능',
		dimWeight: 0.35,
		items: [
			{ id: 'fn.app-mounts', weight: 30, severity: 'major', check: (o) => observedTrue(o.appMounted) },
			{ id: 'fn.no-runtime-error', weight: 30, severity: 'major', check: (o) => observedZero(o.runtimeErrors) },
			// ⭐ 상호작용 실증 (2차 자기진단 F18) — "떴는가" 가 아니라 **"조작했을 때 기대대로 됐는가"**.
			// eval-scenario 가 남긴 이번 사이클 산출물(scenario.json)의 passed 를 읽는다.
			// 이 항목이 없던 동안 루브릭 16항목 전부가 "렌더/에러/게이트" 였고, 그래서
			// **기능 0개 빈 스캐폴드가 종합 100점 / major 0** 을 받았다(실측).
			// 근본 해결(요구사항→AC→E2E 추적성)은 plan.json 이 필요하지만, 그 전에도
			// "상호작용 단언이 실제로 통과했다" 는 사실은 점수에 반영돼야 한다.
			{ id: 'fn.e2e-verified', weight: 30, severity: 'major', check: (o) => observedTrue(o.e2ePassed) },
			{ id: 'fn.navigable', weight: 10, severity: 'minor', check: (o) => observedTrue(o.navigable) },
		],
	},
	{
		key: 'quality',
		label: '품질',
		dimWeight: 0.2,
		items: [
			{ id: 'q.gates-green', weight: 40, severity: 'major', check: (o) => observedTrue(o.gatesGreen) },
			{ id: 'q.screenshot', weight: 20, severity: 'minor', check: (o) => observedTrue(o.screenshotOk) },
			{ id: 'q.observability', weight: 20, severity: 'minor', check: (o) => observedTrue(o.observable) },
			// a11y: 경량 접근성 점검(html lang / img alt / 접근가능한 이름) 위반 0건인가 (관찰 필수)
			{ id: 'q.a11y-clean', weight: 20, severity: 'minor', check: (o) => observedZero(o.a11yViolations) },
		],
	},
];

/** 항목 → 근거 관찰값 키 (불만에 "미관찰" 사유를 붙이기 위한 매핑). */
const OBSERVATION_KEY = {
	'ui.renders': 'bodyNonEmpty',
	'ui.title': 'titleMatches',
	'ui.heading': 'headingPresent',
	'ui.no-console-error': 'consoleErrors',
	'ux.load-fast': 'serverReady',
	'ux.layout-stable': 'layoutStable',
	'ux.responsive-meta': 'hasViewportMeta',
	'ux.responsive-layout': 'responsiveLayout',
	'ux.a11y-landmarks': 'hasLandmarks',
	'fn.app-mounts': 'appMounted',
	'fn.no-runtime-error': 'runtimeErrors',
	'fn.e2e-verified': 'e2ePassed',
	'fn.navigable': 'navigable',
	'q.gates-green': 'gatesGreen',
	'q.screenshot': 'screenshotOk',
	'q.observability': 'observable',
	'q.a11y-clean': 'a11yViolations',
};

/** 관찰값이 아예 없었는지(미관찰) 판정 — 불만 사유 표기용. */
function isUnobserved(obs, itemId) {
	const key = OBSERVATION_KEY[itemId];
	if (!key) return false;
	const v = obs?.[key];
	return v === undefined || v === null;
}

/**
 * 관찰값(observations)으로 차원·종합 점수와 불만 목록을 산출한다 (결정적).
 * @param {object} obs 관찰값 (eval-playwright 가 수집; 미정 키는 항목별 기본 처리됨)
 * @returns {{
 *   score: number,                 // 종합 0~100 (반올림 정수)
 *   majorComplaints: number,       // major 불만 수 (done-gate 계약)
 *   dimensions: Record<string,{score:number, weight:number, label:string}>,
 *   complaints: Array<{dimension:string,item:string,severity:string}>
 * }}
 */
export function scoreObservations(obs = {}) {
	const dimensions = {};
	const complaints = [];
	let weightedSum = 0;

	for (const dim of DIMENSIONS) {
		let dimScore = 0;
		for (const item of dim.items) {
			let passed;
			try {
				passed = !!item.check(obs);
			} catch {
				passed = false;
			}
			if (passed) {
				dimScore += item.weight;
			} else {
				// reason 을 함께 남긴다 — "관찰했더니 틀렸다"와 "관찰 자체를 못 했다"는 원인이 다르고,
				// 사람이 평가 로그를 볼 때 이 구분이 곧 다음 조치를 결정한다.
				complaints.push({
					dimension: dim.key,
					item: item.id,
					severity: item.severity,
					reason: isUnobserved(obs, item.id) ? 'unobserved' : 'failed',
				});
			}
		}
		dimensions[dim.key] = { score: dimScore, weight: dim.dimWeight, label: dim.label };
		weightedSum += dim.dimWeight * dimScore;
	}

	const score = Math.round(weightedSum);
	const majorComplaints = complaints.filter((c) => c.severity === 'major').length;
	return { score, majorComplaints, dimensions, complaints };
}

/**
 * 주입 오버라이드 적용 (테스트/CI 용). docs/eval-rubric.md §5.4 계약.
 * --score / --major-complaints 가 주어지면 관찰 기반 산출 대신 그 값으로 덮어쓴다.
 * @param {{score:number,majorComplaints:number,complaints:Array,dimensions:object}} computed scoreObservations 결과
 * @param {{score?:number, majorComplaints?:number}} injected
 * @returns {object} 오버라이드 반영 결과 (injected 표시 포함)
 */
export function applyInjectedScore(computed, injected = {}) {
	const out = { ...computed };
	let usedInjection = false;
	if (injected.score !== undefined && Number.isFinite(Number(injected.score))) {
		out.score = Number(injected.score);
		usedInjection = true;
	}
	if (injected.majorComplaints !== undefined && Number.isFinite(Number(injected.majorComplaints))) {
		const n = Number(injected.majorComplaints);
		out.majorComplaints = n;
		// 주입된 major 수를 불만 목록에도 합성하여 일관성 유지 (사람용 로그 가독성).
		const synthetic = [];
		for (let i = 0; i < n; i++) {
			synthetic.push({ dimension: 'injected', item: `injected.major.${i + 1}`, severity: 'major' });
		}
		out.complaints = [...synthetic, ...(computed.complaints ?? []).filter((c) => c.severity !== 'major')];
		usedInjection = true;
	}
	out.injected = usedInjection;
	return out;
}
