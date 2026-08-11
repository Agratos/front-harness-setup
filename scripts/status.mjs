#!/usr/bin/env node
// status.mjs — 하네스 상태를 **한 화면**으로 보여주는 읽기 전용 대시보드.
//
// 왜 필요한가:
//   예전 `/status` 는 `node -e "..."` 원라이너를 복붙해 `state.json` 을 눈으로 파싱하는 것이었다.
//   그런데 사용자가 실제로 알고 싶은 것은 상태 필드가 아니라 다음 네 가지다:
//     ① 지금 어디까지 왔나 (진행률)
//     ② 지금 무엇이 막고 있나 (막힌 이유 + 근거 파일)
//     ③ **다음에 뭘 해야 하나** (한 개의 명령)
//     ④ 만들려던 것이 만들어지고 있나 (수용기준 충족률)
//   이 정보는 state.json·gate-status.json·evaluations/*.json·scen-*/scenario.json·plan.json
//   **다섯 곳**에 흩어져 있었다. 이 스크립트가 그것을 모아 한 번에 보여준다.
//
// 읽기 전용: 어떤 파일도 쓰지 않고 페이즈를 전진시키지 않는다(loop.mjs 는 호출하면 전진한다).
//
// 실행: node scripts/status.mjs [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cycleIdOf, readState, stateFilePath } from './lib/state.mjs';
import { checkPhaseContract, PHASE_CONTRACT } from './lib/phase-gate.mjs';
import { acceptanceOf, allAcIds, checkAcCoverage, findStep, readPlan } from './lib/plan.mjs';

/** 페이즈 순서 — 진행 막대를 그리기 위해 loop 와 동일하게 유지한다. */
const PHASE_ORDER = ['decompose', 'design', 'implement', 'verify', 'evaluate', 'debate', 'merge'];

/** 페이즈별 "누가 무엇을 하는 자리인가" 한 줄 설명 (사용자가 페이즈 이름만 보고 모르는 문제 해소). */
const PHASE_MEANING = {
	decompose: '작업을 쪼개고 step 브랜치를 만드는 자리 (CEO·PM)',
	design: '무엇을 만족하면 끝인지(AC)와 구조를 정하는 자리 (architect)',
	implement: '실제 코드를 쓰는 자리 (entity-modeler·ui)',
	verify: '게이트 4종 + 실제 조작(E2E) 검증 — 코드가 자동 실행',
	evaluate: '캡처물을 보고 품질을 채점하는 자리 — 산출물 생성은 코드가 자동',
	debate: '평가 결과로 통과/재작업을 협의하는 자리 (PM 중재)',
	merge: 'done-gate 통과 시 main 병합 — 코드가 자동',
	vote: '재작업 5회 초과 → 투표로 진행 여부 의결 (CEO 캐스팅보트)',
};

function readJson(p) {
	try {
		return JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return null;
	}
}

/** 최신 평가(eval-NNNN.json) 하나를 읽는다. */
function latestEvaluation(repoRoot) {
	const dir = path.join(repoRoot, 'harness', 'evaluations');
	try {
		const files = readdirSync(dir)
			.filter((f) => /^eval-\d+\.json$/.test(f))
			.sort();
		if (!files.length) return null;
		return readJson(path.join(dir, files[files.length - 1]));
	} catch {
		return null;
	}
}

/** 이번 사이클의 상호작용 결과 + 프리플라이트 기록. */
function scenarioArtifacts(repoRoot, state) {
	const id = `scen-${cycleIdOf(state).replace('#', '-r')}`;
	const dir = path.join(repoRoot, 'harness', 'evaluations', id);
	return {
		id,
		outcome: readJson(path.join(dir, 'scenario.json')),
		preflight: readJson(path.join(dir, 'preflight.json')),
	};
}

/**
 * **다음 1개 행동** — 사용자가 이 화면에서 가져갈 단 하나의 결론.
 * 상태·막힌 이유에 따라 가장 값싼 다음 명령을 제안한다.
 * @returns {{action:string, why:string}}
 */
export function nextAction(ctx) {
	const { state, scenario, ac } = ctx;
	if (!state) {
		return { action: 'node scripts/loop.mjs --init "01-<첫 step>"', why: '상태 파일이 없습니다 — 계획을 시드하세요' };
	}
	if (state.status === 'done') {
		return { action: '(없음 — 모든 step 완료)', why: 'status=done. 새 계획을 시드하면 다시 시작합니다' };
	}
	if (!Array.isArray(state.planSteps) || state.planSteps.length === 0) {
		return { action: 'node scripts/loop.mjs --init "01-a,02-b"', why: 'planSteps 가 비어 있습니다' };
	}
	if (state.status === 'blocked') {
		return {
			action: '원인 조치 → node scripts/loop.mjs --resume',
			why: `자동 복구를 포기한 상태입니다: ${state.blockedReason ?? '사유 미기록'} (조치로 저장소가 바뀌어야 재개 허용)`,
		};
	}
	// 검증 불가로 막혀 있으면, 페이즈를 또 돌리기 전에 그 원인을 먼저 없애야 한다.
	const un = scenario.preflight && scenario.preflight.ok === false ? scenario.preflight.unverifiable : null;
	if (un === 'no-spec') {
		return {
			action: 'harness/eval-scenario.json 작성 → node scripts/loop.mjs',
			why: '상호작용 검증 스펙이 없어 verify 가 게이트 실행 전에 차단됩니다 (예시: harness/eval-scenario.example.json)',
		};
	}
	if (un === 'ac-uncovered') {
		const miss = scenario.preflight?.coverage?.missing ?? [];
		return {
			action: `단언에 ac 태그 추가(${miss.join(', ') || 'AC-?'}) → node scripts/loop.mjs`,
			why: '수용기준이 선언됐지만 그것을 증명하는 단언이 없습니다',
		};
	}
	if (un) {
		return {
			action: `${scenario.preflight?.reason ?? un} 해결 → node scripts/loop.mjs`,
			why: '상호작용 검증 전제조건이 충족되지 않았습니다',
		};
	}
	if (ac?.present && ac.error) {
		return { action: 'harness/plan.json 수정 → node scripts/loop.mjs', why: ac.error };
	}
	// AC 공백 안내는 **그것을 채울 자리에 왔을 때** 한다.
	// decompose 에서 "단언에 ac 태그를 붙여라" 라고 하면 아직 스펙을 쓸 자리가 아닌데 앞질러 시키는 셈이다.
	// 스펙은 design 에서 확정되므로, design 이후부터 이 안내를 다음 행동으로 올린다.
	const acGap = ac?.applicable && !ac.ok;
	const afterDesign = ['design', 'implement', 'verify', 'evaluate', 'debate', 'merge', 'vote'].includes(state.phase);
	if (acGap && afterDesign && !['design', 'implement'].includes(state.phase)) {
		// verify/evaluate/debate/merge 에서 AC 가 비어 있으면 loop 를 불러도 차단만 된다 → 먼저 채우게 한다.
		return {
			action: `단언에 ac 태그 추가(${ac.missing.join(', ')}) → node scripts/loop.mjs`,
			why: `수용기준 ${ac.missing.length}개가 어떤 단언으로도 검증되지 않습니다 — verify 가 게이트 실행 전에 차단합니다`,
		};
	}
	// 페이즈 산출물 계약이 미충족이면 loop 를 불러도 차단만 된다 → 그 자리를 메우는 명령을 먼저 준다.
	// (계약이 없던 시절에는 에이전트 페이즈에서 항상 "/run-cycle" 만 안내했고, 산출물을 남기지 않아도
	//  전진했기 때문에 "무엇이 빠졌는지" 를 물을 대상 자체가 없었다.)
	if (ctx.contract && ctx.contract.ok === false) {
		return {
			action: ctx.contract.hint ?? '/run-cycle  (산출물 생성 후 node scripts/loop.mjs)',
			why: `'${state.phase}' 산출물 계약 미충족 — ${ctx.contract.reason}`,
		};
	}
	const isAgentPhase = ['decompose', 'design', 'implement', 'evaluate', 'debate', 'vote'].includes(state.phase);
	if (isAgentPhase) {
		// 에이전트 페이즈에서는 AC 공백을 "이유" 로 함께 알려준다(행동은 여전히 /run-cycle).
		const acNote = acGap ? ` · ⚠ 미검증 수용기준 ${ac.missing.join(', ')} — ${state.phase === 'design' ? '이 페이즈에서 단언을 작성하세요' : 'design 에서 채워야 verify 를 통과합니다'}` : '';
		return {
			action: '/run-cycle  (에이전트 작업 후 node scripts/loop.mjs 로 페이즈 마감)',
			why: `'${state.phase}' 는 에이전트가 산출물을 만드는 자리입니다 — ${PHASE_MEANING[state.phase] ?? ''}${acNote}`,
		};
	}
	return {
		action: 'node scripts/loop.mjs',
		why: `'${state.phase}' 는 코드가 결정적으로 실행합니다 — 호출하면 검사 후 전진/차단됩니다`,
	};
}

/** 상태 스냅샷 수집 (읽기 전용). */
export function collect(repoRoot) {
	const state = readState(stateFilePath(repoRoot));
	const gate = readJson(path.join(repoRoot, 'harness', 'gate-status.json'));
	const cycleId = cycleIdOf(state);
	const gateFresh = gate && gate.cycleId === cycleId;
	const evaluation = latestEvaluation(repoRoot);
	const evalFresh = evaluation && evaluation.cycleId === cycleId;
	const scenario = scenarioArtifacts(repoRoot, state);

	// 수용기준(AC) — 사용자 의도가 검증되고 있는지.
	const { present: planPresent, plan, error: planError } = readPlan(repoRoot);
	let ac = { present: planPresent, error: planError ?? null, applicable: false };
	if (planPresent && plan && state) {
		const idx = state.currentStepIdx ?? 0;
		const label = (state.planSteps ?? [])[idx];
		const { step: planStep, matchedBy } = findStep(plan, { label, idx });

		// 계획 정본(plan.json)과 실행 상태(state.planSteps)가 어긋났는지.
		// `--init "라벨,라벨"` 로 시드하고 plan.json 을 따로 적으면 생기는 실패 유형이다.
		// 라벨이 다르면 AC 가 엉뚱한 step 에 붙거나 조용히 무시된다 — 눈에 보이게 만든다.
		const planLabels = (plan.steps ?? []).map((s) => s?.label);
		const stateLabels = state.planSteps ?? [];
		const drift =
			planLabels.length !== stateLabels.length || planLabels.some((l, i) => l !== stateLabels[i])
				? { planLabels, stateLabels }
				: null;
		const specPath = path.join(repoRoot, 'harness', 'eval-scenario.json');
		const spec = existsSync(specPath) ? readJson(specPath) : null;
		const cov = checkAcCoverage(planStep, spec, { knownAcIds: allAcIds(plan) });
		ac = {
			present: true,
			error: planError ?? null,
			matchedBy,
			drift,
			source: plan.source ?? null,
			goal: planStep?.goal ?? null,
			list: acceptanceOf(planStep),
			...cov,
		};
	}

	// 페이즈 산출물 계약 — 지금 이 자리를 떠나려면 무엇이 있어야 하는가 (읽기 전용 판정).
	let contract = null;
	if (state && state.status === 'running' && PHASE_CONTRACT[state.phase]) {
		try {
			contract = { phase: state.phase, ...checkPhaseContract({ repoRoot, state, phase: state.phase }) };
		} catch {
			contract = null; // 계약 판정 실패가 대시보드를 죽이지 않는다
		}
	}

	const ctx = { state, gate, gateFresh, evaluation, evalFresh, scenario, cycleId, ac, contract };
	return { ...ctx, next: nextAction(ctx) };
}

/** 진행 막대: decompose ─ design ─ … ─ merge 중 현재 위치 표시. */
function phaseBar(phase) {
	return PHASE_ORDER.map((p) => (p === phase ? `[${p}]` : p)).join(' → ');
}

function mark(ok) {
	return ok === true ? '✅' : ok === false ? '❌' : '—';
}

/**
 * 표시 폭 계산 — CJK(한글/한자/일본어) 글자는 터미널에서 **2칸**을 차지한다.
 * `String.padEnd` 는 코드 단위로 세므로 한글 라벨이 섞이면 열이 어긋난다.
 */
function displayWidth(s) {
	let w = 0;
	for (const ch of String(s)) {
		const c = ch.codePointAt(0);
		// CJK 통합 한자·한글 음절·전각 기호·가나 등 광폭 구간
		const wide =
			(c >= 0x1100 && c <= 0x115f) ||
			(c >= 0x2e80 && c <= 0xa4cf) ||
			(c >= 0xac00 && c <= 0xd7a3) ||
			(c >= 0xf900 && c <= 0xfaff) ||
			(c >= 0xfe30 && c <= 0xfe6f) ||
			(c >= 0xff00 && c <= 0xff60) ||
			(c >= 0xffe0 && c <= 0xffe6);
		w += wide ? 2 : 1;
	}
	return w;
}

/** 표시 폭 기준 좌측 정렬 패딩. */
function padDisplay(s, width) {
	const pad = width - displayWidth(s);
	return String(s) + ' '.repeat(pad > 0 ? pad : 0);
}

function printHuman(s) {
	const st = s.state;
	// 라벨은 한글이므로 표시 폭(CJK=2칸) 기준으로 정렬한다 — padEnd 로는 열이 어긋난다.
	const line = (k, v) => console.log(`  ${padDisplay(k, 16)} ${v}`);

	console.log('');
	console.log('┌─ 하네스 상태 ─────────────────────────────────────────────');
	if (!st) {
		console.log('│ 상태 파일이 없습니다 (harness/state.json)');
		console.log('└───────────────────────────────────────────────────────────');
		console.log('');
		console.log(`▶ 다음 1개 행동: ${s.next.action}`);
		console.log(`  이유: ${s.next.why}`);
		console.log('');
		return;
	}

	const total = (st.planSteps ?? []).length;
	const idx = st.currentStepIdx ?? 0;
	const label = (st.planSteps ?? [])[idx] ?? '-';
	const statusIcon = st.status === 'blocked' ? '🛑' : st.status === 'done' ? '🏁' : '🔵';

	console.log(`│ ${statusIcon} ${st.status}   step ${Math.min(idx + 1, total)}/${total}  ${label}`);
	console.log(`│ 사이클 ${s.cycleId}   재작업 ${st.reworkCount ?? 0}/5${st.gateOverride ? '  (gateOverride)' : ''}`);
	console.log('├─ 페이즈 ──────────────────────────────────────────────────');
	console.log(`│ ${phaseBar(st.phase)}`);
	console.log(`│ 지금: ${st.phase} — ${PHASE_MEANING[st.phase] ?? '(설명 없음)'}`);
	console.log('├─ 최신 검사 결과 (이번 사이클) ────────────────────────────');
	console.log('└───────────────────────────────────────────────────────────');

	// 게이트
	if (!s.gate) line('게이트 4종', '— 미실행 (verify 를 아직 안 돌렸습니다)');
	else if (!s.gateFresh) line('게이트 4종', `⚠ 다른 사이클 결과(${s.gate.cycleId}) — 이번 사이클에선 미실행`);
	else {
		const failed = (s.gate.gates ?? []).filter((g) => !g.ok).map((g) => g.name);
		line('게이트 4종', `${mark(s.gate.passed)} ${s.gate.passed ? 'green' : `실패: ${failed.join(', ')}`}`);
	}

	// 상호작용(E2E)
	const oc = s.scenario.outcome;
	const pf = s.scenario.preflight;
	if (pf && pf.ok === false) {
		line('상호작용 E2E', `❌ 전제조건 실패 — ${pf.reason}`);
	} else if (!oc) {
		line('상호작용 E2E', '— 미실행');
	} else if (oc.exempt) {
		line('상호작용 E2E', `⚠ 면제(명시) — ${oc.reason}`);
	} else if (oc.unverifiable) {
		line('상호작용 E2E', `❌ 검증 불가 — ${oc.reason}`);
	} else {
		const fails = (oc.failures ?? []).length;
		line('상호작용 E2E', `${mark(oc.passed)} 시나리오 ${oc.scenarioCount ?? 0}개${fails ? `, 실패 단언 ${fails}건` : ''}`);
	}

	// 평가
	if (!s.evaluation) line('평가', '— 미실행');
	else if (!s.evalFresh) line('평가', `⚠ ${s.evaluation.id}: 다른 사이클(${s.evaluation.cycleId}) — 이번 사이클 평가 필요`);
	else {
		const pass = s.evaluation.score >= 90 && s.evaluation.majorComplaints === 0;
		line(
			'평가',
			`${mark(pass)} ${s.evaluation.id}: 종합 ${s.evaluation.score}/100, major ${s.evaluation.majorComplaints}건 (mode=${s.evaluation.mode})`,
		);
	}

	// 페이즈 산출물 계약 — "이 자리를 떠나려면 무엇이 있어야 하나"
	if (s.contract) {
		const c = s.contract;
		if (c.skipped) line('산출물 계약', `— ${c.reason}`);
		else if (c.ok) line('산출물 계약', `✅ ${PHASE_CONTRACT[c.phase]?.what ?? c.kind} — ${c.reason}`);
		else line('산출물 계약', `❌ ${c.reason}`);
	}

	// 수용기준 — "만들려던 것이 만들어지고 있나"
	if (!s.ac.present) {
		line('수용기준 AC', '— plan.json 없음 (AC 추적 비활성 — 만든 것이 의도와 맞는지 코드가 모릅니다)');
	} else if (s.ac.error) {
		line('수용기준 AC', `❌ ${s.ac.error}`);
	} else if (!s.ac.applicable) {
		line('수용기준 AC', `— 이 step(${label})에 acceptance 미선언`);
	} else {
		line('수용기준 AC', `${mark(s.ac.ok)} ${s.ac.covered.length}/${s.ac.total} 단언으로 덮임${s.ac.missing.length ? ` · 미검증: ${s.ac.missing.join(', ')}` : ''}`);
		if (s.ac.source) line('', `출처: ${s.ac.source}`);
		if (s.ac.goal) line('', `목표: ${s.ac.goal}`);
		for (const a of s.ac.list) {
			const covered = s.ac.covered.includes(a.id);
			line('', `${covered ? '✓' : '·'} ${a.id} ${a.text}`);
		}
	}

	// 계획 정본 ↔ 실행 상태 불일치 — AC 가 엉뚱한 step 에 붙는 원인
	if (s.ac.drift) {
		line('⚠ 계획 불일치', `plan.json 라벨 [${s.ac.drift.planLabels.join(', ')}]`);
		line('', `state.planSteps [${s.ac.drift.stateLabels.join(', ')}]`);
		line('', 'plan.json 을 정본으로 다시 시드하세요: node scripts/loop.mjs --init-plan (진행 중이면 라벨을 수동 일치)');
	}

	// 실패 카운터
	const fails = st.failures ?? {};
	const activeFails = Object.entries(fails).filter(([, n]) => n > 0);
	if (activeFails.length || (st.escalations ?? 0) > 0) {
		line('실패 카운터', `${activeFails.map(([p, n]) => `${p}=${n}/3`).join(' ')}  에스컬레이션 ${st.escalations ?? 0}/3`);
	}

	if (st.status === 'blocked') {
		console.log('');
		console.log(`🛑 막힌 이유: ${st.blockedReason ?? '(미기록)'}`);
		console.log('   상세: harness/errors/ 최신 항목');
	}

	console.log('');
	console.log(`▶ 다음 1개 행동: ${s.next.action}`);
	console.log(`  이유: ${s.next.why}`);
	console.log('');
}

function main() {
	const argv = process.argv.slice(2);
	const s = collect(process.cwd());
	if (argv.includes('--json')) {
		process.stdout.write(JSON.stringify(s, null, 2) + '\n');
		return;
	}
	printHuman(s);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
