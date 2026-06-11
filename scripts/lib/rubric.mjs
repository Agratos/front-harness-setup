// rubric.mjs — 평가 루브릭 채점 (순수 함수, I/O 없음) (US-009)
//
// docs/eval-rubric.md 의 고정 채점 기준을 코드로 옮긴 것입니다.
// 4개 차원(UI/UX/기능/품질) × 체크리스트 항목 → 0~100 점.
// "불만(complaint) = 실패한 체크리스트 항목" 이며, 항목별 심각도(major/minor)는
// 여기에 고정됩니다(평가자 재량 아님). I/O 가 없으므로 selftest 에서 결정적으로 검증됩니다.

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
			{ id: 'ui.renders', weight: 40, severity: 'major', check: (o) => o.bodyNonEmpty === true },
			{ id: 'ui.title', weight: 20, severity: 'minor', check: (o) => o.titleMatches === true },
			{ id: 'ui.heading', weight: 30, severity: 'major', check: (o) => o.headingPresent === true },
			{ id: 'ui.no-console-error', weight: 10, severity: 'minor', check: (o) => (o.consoleErrors ?? 0) === 0 },
		],
	},
	{
		key: 'ux',
		label: 'UX',
		dimWeight: 0.2,
		items: [
			{ id: 'ux.load-fast', weight: 40, severity: 'major', check: (o) => o.serverReady === true },
			{ id: 'ux.layout-stable', weight: 20, severity: 'minor', check: (o) => o.layoutStable !== false },
			{ id: 'ux.responsive-meta', weight: 15, severity: 'minor', check: (o) => o.hasViewportMeta !== false },
			// 반응형: 좁은 뷰포트(모바일)에서 가로 overflow 가 없는가 (관찰 기반, 미관찰 시 기본 통과)
			{ id: 'ux.responsive-layout', weight: 15, severity: 'minor', check: (o) => o.responsiveLayout !== false },
			// a11y: 페이지에 landmark(nav/main 등)가 1개 이상인가 (관찰 기반, 미관찰 시 기본 통과)
			{ id: 'ux.a11y-landmarks', weight: 10, severity: 'minor', check: (o) => o.hasLandmarks !== false },
		],
	},
	{
		key: 'fn',
		label: '기능',
		dimWeight: 0.35,
		items: [
			{ id: 'fn.app-mounts', weight: 40, severity: 'major', check: (o) => o.appMounted === true },
			{ id: 'fn.no-runtime-error', weight: 40, severity: 'major', check: (o) => (o.runtimeErrors ?? 0) === 0 },
			{ id: 'fn.navigable', weight: 20, severity: 'minor', check: (o) => o.navigable !== false },
		],
	},
	{
		key: 'quality',
		label: '품질',
		dimWeight: 0.2,
		items: [
			{ id: 'q.gates-green', weight: 40, severity: 'major', check: (o) => o.gatesGreen !== false },
			{ id: 'q.screenshot', weight: 20, severity: 'minor', check: (o) => o.screenshotOk === true },
			{ id: 'q.observability', weight: 20, severity: 'minor', check: (o) => o.observable !== false },
			// a11y: 경량 접근성 점검(html lang / img alt / 접근가능한 이름) 위반 0건인가 (미관찰 시 기본 통과)
			{ id: 'q.a11y-clean', weight: 20, severity: 'minor', check: (o) => (o.a11yViolations ?? 0) === 0 },
		],
	},
];

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
				complaints.push({ dimension: dim.key, item: item.id, severity: item.severity });
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
