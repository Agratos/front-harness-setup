#!/usr/bin/env node
// plan.selftest.mjs — 수용기준(AC) 추적 + 상태 대시보드 자가검증.
//
// 검증 대상:
//   [A] plan.mjs — AC 정규화 / 라벨·인덱스 매칭 / 커버리지 판정(누락·오타 태그)
//   [B] eval-scenario --preflight — 값싼 전제조건이 **게이트보다 먼저** 차단하는가 (exit 2)
//   [C] status.mjs — 흩어진 산출물을 모아 "다음 1개 행동"을 뽑는가
//
// 네트워크·Playwright·dev 서버 미사용. 임시 cwd 에서만 동작하며 실제 repo 를 오염시키지 않는다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acceptanceOf, checkAcCoverage, coveredAcIds, findStep, readPlan, validatePlan } from './lib/plan.mjs';
import { resolveInitPlan } from './loop.mjs';
import { collect, nextAction } from './status.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
const failures = [];
function check(label, cond) {
	if (cond) {
		pass++;
		console.log(`  ✓ ${label}`);
	} else {
		failures.push(label);
		console.log(`  ✗ ${label}`);
	}
}

/** 임시 repo 하나를 만들고 파일들을 심는다. */
function fixture(files) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-selftest-'));
	mkdirSync(path.join(dir, 'harness'), { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const full = path.join(dir, rel);
		mkdirSync(path.dirname(full), { recursive: true });
		writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
	}
	return dir;
}

const STATE = {
	planSteps: ['01-task-board', '02-filter'],
	currentStepIdx: 0,
	phase: 'verify',
	phaseSeq: 4,
	status: 'running',
	committed: false,
	reworkCount: 0,
	failures: {},
	escalations: 0,
	gateOverride: false,
	scores: {},
};
const PLAN = {
	steps: [
		{
			label: '01-task-board',
			goal: '작업을 등록한다',
			acceptance: [
				{ id: 'AC-1', text: '추가하면 목록에 보인다' },
				{ id: 'AC-2', text: '추가 후 폼이 비워진다' },
			],
		},
		{ label: '02-filter', acceptance: ['AC-3: 완료만 남는다'] },
	],
};
const SPEC_FULL = {
	scenarios: [
		{
			name: '추가',
			steps: [
				{ fill: { label: '제목', value: 'x' } },
				{ assert: 'textVisible', text: 'x', ac: 'AC-1' },
				{ assert: 'inputEmpty', label: '제목', ac: 'AC-2' },
			],
		},
	],
};
const SPEC_PARTIAL = {
	scenarios: [{ name: '추가', steps: [{ assert: 'textVisible', text: 'x', ac: 'AC-1' }] }],
};

// ───────────────────────── [A] plan.mjs 순수 로직 ─────────────────────────
console.log('[A] plan.mjs — AC 정규화 · 매칭 · 커버리지');
{
	// 축약형(문자열 "AC-3: 텍스트")도 정규화된다
	const short = acceptanceOf({ acceptance: ['AC-3: 완료만 남는다'] });
	check('[A] 문자열 축약형 AC 정규화 (id/text 분리)', short.length === 1 && short[0].id === 'AC-3' && short[0].text === '완료만 남는다');
	// id 없는 순수 문장은 순번으로 id 부여
	const bare = acceptanceOf({ acceptance: ['그냥 문장'] });
	check('[A] id 없는 문장 → AC-1 자동 부여', bare[0].id === 'AC-1');
	check('[A] acceptance 없으면 빈 배열', acceptanceOf({}).length === 0);

	// 라벨 우선 매칭 (계획을 재배열해도 안전)
	const byLabel = findStep(PLAN, { label: '02-filter', idx: 0 });
	check('[A] 라벨 우선 매칭', byLabel.matchedBy === 'label' && byLabel.step.label === '02-filter');
	const byIdx = findStep(PLAN, { label: '없는-라벨', idx: 1 });
	check('[A] 라벨 불일치 시 인덱스 폴백', byIdx.matchedBy === 'index' && byIdx.step.label === '02-filter');
	check('[A] 둘 다 실패하면 null', findStep(PLAN, { label: 'x', idx: 99 }).step === null);

	// 태그 수집 — 단언 레벨 + 시나리오 레벨 + 배열
	const tags = coveredAcIds({ scenarios: [{ ac: ['AC-9', 'AC-8'], steps: [{ assert: 'x', ac: 'AC-1' }] }] });
	check('[A] 시나리오 레벨 ac(배열) + 단언 레벨 ac 모두 수집', tags.has('AC-9') && tags.has('AC-8') && tags.has('AC-1'));

	// 커버리지 판정
	const full = checkAcCoverage(PLAN.steps[0], SPEC_FULL);
	check('[A] 모든 AC 덮임 → ok', full.ok === true && full.total === 2 && full.missing.length === 0);
	const partial = checkAcCoverage(PLAN.steps[0], SPEC_PARTIAL);
	check('[A] 일부 미덮임 → ok=false + missing 목록', partial.ok === false && partial.missing.join() === 'AC-2');
	const noSpec = checkAcCoverage(PLAN.steps[0], null);
	check('[A] 스펙 없음 → 전부 미덮임', noSpec.ok === false && noSpec.covered.length === 0);
	// 계획에 없는 태그(오타) 탐지
	const typo = checkAcCoverage(PLAN.steps[0], {
		scenarios: [{ steps: [{ ac: 'AC-1' }, { ac: 'AC-2' }, { ac: 'AC-99' }] }],
	});
	check('[A] 계획에 없는 태그를 unknown 으로 보고(오타 탐지)', typo.ok === true && typo.unknown.join() === 'AC-99');
	// AC 미선언 step 은 검사 대상 아님
	const na = checkAcCoverage({ label: 'x' }, SPEC_FULL);
	check('[A] AC 미선언 step → applicable=false, ok=true', na.applicable === false && na.ok === true);

	// plan.json 부재 = no-op (하위호환)
	const emptyRepo = fixture({});
	try {
		check('[A] plan.json 없으면 present=false (하위호환 no-op)', readPlan(emptyRepo).present === false);
	} finally {
		rmSync(emptyRepo, { recursive: true, force: true });
	}
	// 깨진 plan.json 은 조용히 넘기지 않는다
	const badRepo = fixture({ 'harness/plan.json': '{ broken' });
	try {
		const r = readPlan(badRepo);
		check('[A] 깨진 plan.json → present=true + error', r.present === true && typeof r.error === 'string');
	} finally {
		rmSync(badRepo, { recursive: true, force: true });
	}
}

// ───────── [B] preflight — 값싼 검사가 비싼 게이트보다 먼저 차단한다 ─────────
console.log('[B] eval-scenario --preflight (서버·브라우저 미사용)');
{
	const run = (cwd) => {
		try {
			execFileSync('node', [path.join(scriptsDir, 'eval-scenario.mjs'), '--preflight', '--id=scen-step-0-r0'], {
				cwd,
				stdio: 'pipe',
			});
			return 0;
		} catch (err) {
			return err.status ?? 1;
		}
	};

	// AC 전부 덮임 → 통과
	const okRepo = fixture({
		'harness/state.json': STATE,
		'harness/plan.json': PLAN,
		'harness/eval-scenario.json': SPEC_FULL,
	});
	try {
		check('[B] AC 전부 덮임 → exit 0', run(okRepo) === 0);
	} finally {
		rmSync(okRepo, { recursive: true, force: true });
	}

	// AC 누락 → 검증 불가(exit 2)
	const gapRepo = fixture({
		'harness/state.json': STATE,
		'harness/plan.json': PLAN,
		'harness/eval-scenario.json': SPEC_PARTIAL,
	});
	try {
		check('[B] AC 누락 → exit 2 (게이트 실행 전 차단)', run(gapRepo) === 2);
	} finally {
		rmSync(gapRepo, { recursive: true, force: true });
	}

	// plan.json 없으면 AC 검사 생략 — 기존 프로젝트 무영향
	const legacyRepo = fixture({ 'harness/state.json': STATE, 'harness/eval-scenario.json': SPEC_PARTIAL });
	try {
		check('[B] plan.json 없음 → AC 검사 생략, exit 0 (하위호환)', run(legacyRepo) === 0);
	} finally {
		rmSync(legacyRepo, { recursive: true, force: true });
	}

	// 면제 선언 + AC 존재 = 모순 → 차단
	const contradictRepo = fixture({
		'harness/state.json': STATE,
		'harness/plan.json': PLAN,
		'harness/eval-scenario.json': { scenarios: [], skipReason: '화면 변경 없음' },
	});
	try {
		check('[B] 면제 선언인데 AC 가 있음 → exit 2 (모순 차단)', run(contradictRepo) === 2);
	} finally {
		rmSync(contradictRepo, { recursive: true, force: true });
	}

	// 프리플라이트는 scenario.json 을 쓰지 않는다 (검증 증거가 아니므로)
	const artifactRepo = fixture({
		'harness/state.json': STATE,
		'harness/eval-scenario.json': SPEC_FULL,
	});
	try {
		run(artifactRepo);
		const scenJson = path.join(artifactRepo, 'harness', 'evaluations', 'scen-step-0-r0', 'scenario.json');
		const preJson = path.join(artifactRepo, 'harness', 'evaluations', 'scen-step-0-r0', 'preflight.json');
		check('[B] 프리플라이트는 preflight.json 만 남긴다', !existsSync(scenJson) && existsSync(preJson));
	} finally {
		rmSync(artifactRepo, { recursive: true, force: true });
	}
}

// ───────────────────── [C] status.mjs — 한눈에 파악 + 다음 행동 ─────────────────────
console.log('[C] status.mjs — 산출물 집계 + 다음 1개 행동');
{
	// 상태 없음 → 시드 안내
	const bare = fixture({});
	try {
		const s = collect(bare);
		check('[C] 상태 없음 → --init 시드 안내', /--init/.test(s.next.action));
	} finally {
		rmSync(bare, { recursive: true, force: true });
	}

	// AC 누락 → verify 를 돌리기 **전에** 그 사실을 다음 행동으로 알려준다
	const gap = fixture({
		'harness/state.json': STATE,
		'harness/plan.json': PLAN,
		'harness/eval-scenario.json': SPEC_PARTIAL,
	});
	try {
		const s = collect(gap);
		check('[C] AC 커버리지 집계', s.ac.applicable === true && s.ac.total === 2 && s.ac.missing.join() === 'AC-2');
		check('[C] 다음 행동이 AC 누락을 지목', /ac 태그 추가/.test(s.next.action) && /AC-2/.test(s.next.action));
	} finally {
		rmSync(gap, { recursive: true, force: true });
	}

	// 게이트/평가 신선도 — 다른 사이클 결과는 통과 근거가 아니다
	const stale = fixture({
		'harness/state.json': { ...STATE, reworkCount: 1 },
		'harness/gate-status.json': { passed: true, gates: [], cycleId: 'step-0#0' },
		'harness/evaluations/eval-0001.json': { id: 'eval-0001', score: 100, majorComplaints: 0, cycleId: 'step-0#0' },
	});
	try {
		const s = collect(stale);
		check('[C] 사이클 id 반영(rework 1 → step-0#1)', s.cycleId === 'step-0#1');
		check('[C] 이전 사이클 게이트를 stale 로 표시', s.gateFresh === false);
		check('[C] 이전 사이클 평가를 stale 로 표시', s.evalFresh === false);
	} finally {
		rmSync(stale, { recursive: true, force: true });
	}

	// blocked → 조치 후 재개 안내
	const blocked = fixture({
		'harness/state.json': { ...STATE, status: 'blocked', blockedReason: 'verify 3회 실패' },
	});
	try {
		const s = collect(blocked);
		check('[C] blocked → --resume 안내 + 사유 노출', /--resume/.test(s.next.action) && /verify 3회 실패/.test(s.next.why));
	} finally {
		rmSync(blocked, { recursive: true, force: true });
	}

	// 에이전트 페이즈 → /run-cycle, 결정적 페이즈 → loop.mjs
	check(
		'[C] 에이전트 페이즈 → /run-cycle 안내',
		/run-cycle/.test(nextAction({ state: { ...STATE, phase: 'design', planSteps: STATE.planSteps }, scenario: {}, ac: {} }).action),
	);
	check(
		'[C] 결정적 페이즈 → loop.mjs 안내',
		/loop\.mjs$/.test(nextAction({ state: { ...STATE, phase: 'merge', planSteps: STATE.planSteps }, scenario: {}, ac: {} }).action),
	);
	// done → 더 할 일 없음
	check(
		'[C] done → 다음 행동 없음',
		/없음/.test(nextAction({ state: { ...STATE, status: 'done' }, scenario: {}, ac: {} }).action),
	);
}

// ───────── [D] 계획 정본 — 계획을 두 번 적지 않는다 (--init-plan) ─────────
console.log('[D] plan.json 을 시드 입력으로 (계획 정본 단일화)');
{
	// 검증 규칙
	const ok = validatePlan({ steps: [{ label: '01-a', acceptance: [{ id: 'AC-1', text: 't' }] }, { label: '02-b' }] });
	check('[D] 정상 계획 → ok, 라벨 파생', ok.ok === true && ok.labels.join() === '01-a,02-b');
	check('[D] AC 미작성 뒤 step 은 경고(차단 아님)', ok.warnings.some((w) => /02-b/.test(w)));

	check('[D] steps 없음 → 오류', validatePlan({}).ok === false);
	check('[D] steps 빈 배열 → 오류', validatePlan({ steps: [] }).ok === false);
	check(
		'[D] 첫 step 에 AC 없으면 오류 (무엇을 만들지 모른 채 시작 금지)',
		validatePlan({ steps: [{ label: '01-a' }] }).ok === false,
	);
	const dup = validatePlan({ steps: [{ label: '01-a', acceptance: ['AC-1: t'] }, { label: '01-a' }] });
	check('[D] 라벨 중복 → 오류', dup.ok === false && dup.errors.some((e) => /중복/.test(e)));
	const noLabel = validatePlan({ steps: [{ acceptance: ['AC-1: t'] }] });
	check('[D] 라벨 없음 → 오류', noLabel.ok === false);
	const badFmt = validatePlan({ steps: [{ label: 'login', acceptance: ['AC-1: t'] }] });
	check('[D] "<nn>-<slug>" 아니면 경고(브랜치명 직결)', badFmt.ok === true && badFmt.warnings.some((w) => /형식/.test(w)));

	// resolveInitPlan — 파일 경로 해석 + 실패 메시지
	const missing = fixture({});
	try {
		const r = resolveInitPlan(missing);
		check('[D] 계획 파일 없음 → error + steps null', r.steps === null && /계획 파일이 없습니다/.test(r.error));
	} finally {
		rmSync(missing, { recursive: true, force: true });
	}
	const broken = fixture({ 'harness/plan.json': '{ nope' });
	try {
		check('[D] 계획 파싱 실패 → error', resolveInitPlan(broken).error !== null);
	} finally {
		rmSync(broken, { recursive: true, force: true });
	}
	const good = fixture({ 'harness/plan.json': PLAN });
	try {
		const r = resolveInitPlan(good);
		check('[D] 정본에서 planSteps 파생', r.error === null && r.steps.join() === '01-task-board,02-filter');
	} finally {
		rmSync(good, { recursive: true, force: true });
	}

	// drift — 구식 --init 과 plan.json 을 따로 쓰면 라벨이 어긋날 수 있다
	const drifted = fixture({
		'harness/state.json': { ...STATE, planSteps: ['01-다른라벨', '02-filter'] },
		'harness/plan.json': PLAN,
	});
	try {
		const s = collect(drifted);
		check('[D] 계획 정본 ↔ 상태 라벨 불일치 감지', s.ac.drift !== null);
	} finally {
		rmSync(drifted, { recursive: true, force: true });
	}
	const aligned = fixture({ 'harness/state.json': STATE, 'harness/plan.json': PLAN });
	try {
		check('[D] 라벨 일치 시 drift 없음', collect(aligned).ac.drift === null);
	} finally {
		rmSync(aligned, { recursive: true, force: true });
	}

	// 안내 시점 — AC 공백은 "채울 자리" 에서만 다음 행동으로 승격된다
	const gapCtx = (phase) => nextAction({ state: { ...STATE, phase }, scenario: {}, ac: { applicable: true, ok: false, missing: ['AC-1'] } });
	check('[D] decompose 에서는 /run-cycle 이 다음 행동 (앞질러 시키지 않음)', /run-cycle/.test(gapCtx('decompose').action));
	check('[D] decompose 에서도 AC 공백은 이유에 표시', /AC-1/.test(gapCtx('decompose').why));
	check('[D] design 에서 "이 페이즈에서 작성" 안내', /이 페이즈에서 단언을 작성/.test(gapCtx('design').why));
	check('[D] verify 에서는 AC 채우기가 다음 행동', /ac 태그 추가/.test(gapCtx('verify').action));
}

console.log('');
if (failures.length === 0) {
	console.log(`PLAN/STATUS SELFTEST: PASS (${pass})`);
	process.exit(0);
} else {
	console.log(`PLAN/STATUS SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
