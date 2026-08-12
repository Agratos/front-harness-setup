#!/usr/bin/env node
// run-phase-session.mjs — **격리 페이즈 세션 러너** (세션 분리 3단계, docs/spec/session-isolation-2026-08-11.md §3)
//
// 왜 필요한가:
//   1·2단계로 채점(eval-review)과 debate 판정 근거는 격리됐지만, 에이전트 페이즈
//   (decompose/design/implement/debate/vote)의 **수행 주체는 여전히 오케스트레이터(메인 세션)** 였다
//   — 계획을 세운 손과 구현을 지휘한 손과 판정을 기록한 손이 같았다(사양 §1 실측).
//   이 러너는 페이즈 하나를 **fresh 헤드리스 세션**(`claude -p` — 대화 이력 무공유)으로 실행하고,
//   세션 지문(HARNESS_SESSION_ID)을 심어 그 세션이 남긴 기록(record-decision)에 지문이 찍히게 한다.
//   phase-gate 는 sessionIsolation 옵트인 시 "판정 세션 ≠ 설계/구현 세션" 을 그 지문으로 교차 검증한다.
//
// 러너는 게이트를 **하나도 대체하지 않는다** — 세션이 산출물을 안 남기면 다음 loop.mjs 호출이
// 종전대로 차단한다(페이즈 산출물 계약). 러너의 책임은 "누가 했는가" 를 분리·기록하는 것뿐이다.
//
// 사용: node scripts/run-phase-session.mjs [--phase=<페이즈>] [--timeout=ms]
//   --phase 생략 시 state.json 의 현재 페이즈. 에이전트 페이즈가 아니면 거부(결정적 페이즈는 loop 몫).
//
// exit code: 자식 세션의 exit 를 그대로 반환 / 2 = 인자·상태 오류.
//
// 우회 노출(F24 원칙): HARNESS_PHASE_CMD 는 셀프테스트의 환경 조건이자 우회 경로다 —
//   세션 로그(harness/sessions/log.ndjson)의 `cmd` 에 그대로 기록된다. 자율 루프에서 사용 금지.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cycleIdOf, readState, stateFilePath } from './lib/state.mjs';

const log = (...a) => console.log('[phase-session]', ...a);

/** 이 러너가 실행할 수 있는 에이전트 페이즈와 각 세션의 도구 허용 목록. */
export const PHASE_TOOLS = {
	// 분해·판정 세션은 저장소를 읽고 기록 CLI(Bash)만 쓰면 된다 — 코드를 편집할 이유가 없다.
	decompose: 'Read,Glob,Grep,Bash',
	debate: 'Read,Glob,Grep,Bash',
	vote: 'Read,Glob,Grep,Bash',
	// 설계 세션은 plan.json(AC)·eval-scenario.json(단언)을 확정해야 하므로 쓰기가 필요하다.
	design: 'Read,Write,Edit,Glob,Grep,Bash',
	implement: 'Read,Write,Edit,Glob,Grep,Bash',
};

/** 파일명에 쓸 수 있는 사이클 id (`step-0#1` → `step-0-r1` — scenarioIdOf 와 같은 규칙). */
export function fileCycleId(cycleId) {
	return String(cycleId).replace('#', '-r');
}

/** 세션 지문 — 페이즈·사이클·프로세스가 들어가 사람이 읽어도 추적된다. */
export function makeSessionId(phase, cycleId) {
	return `sess-${phase}-${fileCycleId(cycleId)}-${process.pid}-${Date.now().toString(36)}`;
}

/** 페이즈별 세션 프롬프트 — 계약(무엇을 남겨야 하는가)과 마감 명령을 명시한다. */
export function buildPrompt(repoRoot, { phase, cycleId, stepLabel, sessionId }) {
	const recordHint = `node scripts/record-decision.mjs --phase=${phase} --topic="<안건>" --conclusion="<결론>" --why="<근거>"`;
	const phaseDuty = {
		decompose: [
			'- 이번 step 의 작업 분해를 협의하고 결론을 기록하세요.',
			`- 마감(필수): ${recordHint}`,
		],
		design: [
			'- 설계·구조를 결정하고, **수용기준(AC)과 그것을 검증하는 상호작용 스펙을 확정**하세요:',
			'  `harness/plan.json` 의 이번 step `acceptance[]` + `harness/eval-scenario.json` 의 단언(`"ac": "AC-n"` 태그).',
			'- AC 는 관찰 가능한 문장으로. 모든 AC 가 최소 1개 단언으로 덮여야 합니다(preflight 가 검사).',
			`- 마감(필수): ${recordHint}`,
		],
		implement: [
			'- 이번 step 의 AC 를 만족하는 코드를 구현하세요 (FSD 규약 — docs/fsd/ 준수).',
			'- 진입 시점 대비 실제 코드 변경이 있어야 전진합니다(phase-gate). 코드가 필요 없다면 면제를 기록하세요:',
			`  ${recordHint.replace('--topic="<안건>"', '--topic="<이 step>"').replace('--conclusion="<결론>"', '--conclusion="코드 변경 불필요"')}`,
		],
		debate: [
			'- **판정 입력은 격리 산출물만**: 이번 사이클 평가 JSON(`harness/evaluations/eval-*.json` — 격리 리뷰 스탬프 유효분)과',
			'  `harness/evaluations/<id>/review.json`. 구현 의도·과정 서술은 근거가 아닙니다.',
			'- 히스테리시스 규칙(ENTER 90 / HOLD 88, major 0)으로 pass/rework 를 판정하고 근거를 기록하세요.',
			`- 마감(필수): ${recordHint}`,
		],
		vote: [
			'- 재작업 한도(5회) 초과 상황입니다. 다수결(동률 시 CEO 캐스팅보트)로 진행 여부를 의결하세요.',
			`- 표 분포·캐스팅보트 여부까지 기록하세요(필수): ${recordHint}`,
		],
	}[phase];
	return [
		`# 격리 페이즈 세션 — ${phase} (${cycleId})`,
		'',
		'당신은 이 하네스의 **격리 페이즈 세션**입니다. 오케스트레이터의 대화 이력을 모르는 상태에서,',
		'아래 페이즈 하나만 수행하고 종료합니다. 규약 정본은 `.claude/commands/run-cycle.md` 입니다.',
		'',
		`- step: ${stepLabel ?? '?'} / cycleId: ${cycleId} / 세션 지문: ${sessionId}`,
		'- 세션 지문은 env `HARNESS_SESSION_ID` 로 이미 설정되어 있습니다 — record-decision 이 자동으로 기록에 찍습니다.',
		'- 산출물을 남기지 않으면 드라이버(loop.mjs)가 전진을 차단합니다. 침묵의 통과는 없습니다.',
		'',
		'## 이 세션의 임무',
		'',
		...phaseDuty,
		'',
		'## 금지',
		'',
		'- 이 페이즈 밖의 작업(다른 페이즈 선행·후행 작업 수행) 금지.',
		'- `harness/state.json`·평가 JSON 의 직접 편집 금지(드라이버·격리 리뷰 래퍼의 몫).',
	].join('\n');
}

/** harness/config.json 에서 페이즈 세션 모델을 읽는다 (없으면 null — CLI 기본값). */
function readConfigModel(repoRoot) {
	try {
		const cfg = JSON.parse(readFileSync(path.join(repoRoot, 'harness', 'config.json'), 'utf8'));
		return cfg?.phaseSession?.model ?? null;
	} catch {
		return null;
	}
}

/**
 * 격리 세션 실행 — eval-review 의 runReviewer 와 같은 계약(stdin=프롬프트, 오버라이드 노출).
 * @returns {{ok:boolean, code:number|null, cmdLabel:string, stdoutTail:string}}
 */
export function runPhaseSession(promptText, { repoRoot, phase, sessionId, timeoutMs }) {
	const custom = process.env.HARNESS_PHASE_CMD;
	const model = process.env.HARNESS_PHASE_MODEL ?? readConfigModel(repoRoot);
	let cmd;
	let cmdLabel;
	if (custom) {
		cmd = custom;
		cmdLabel = `custom(${custom})`;
	} else {
		cmd = `claude -p --allowedTools "${PHASE_TOOLS[phase]}"${model ? ` --model ${model}` : ''}`;
		cmdLabel = cmd;
	}
	const r = spawnSync(cmd, {
		shell: true,
		cwd: repoRoot,
		input: promptText,
		encoding: 'utf8',
		env: { ...process.env, HARNESS_SESSION_ID: sessionId, HARNESS_SESSION_PHASE: phase },
		timeout: timeoutMs ?? Number(process.env.HARNESS_PHASE_TIMEOUT_MS ?? 1_200_000),
		maxBuffer: 16 * 1024 * 1024,
	});
	const stdout = String(r.stdout ?? '');
	return {
		ok: r.status === 0 && !r.error,
		code: r.status,
		cmdLabel,
		stdoutTail: stdout.trim().slice(-800),
	};
}

/** 세션 실행 이력 1줄을 harness/sessions/log.ndjson 에 append (감사 추적). */
export function appendSessionLog(repoRoot, entry) {
	const dir = path.join(repoRoot, 'harness', 'sessions');
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'log.ndjson');
	appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
	return file;
}

function parseArgs(argv) {
	const o = { phase: null, timeoutMs: undefined };
	for (const a of argv) {
		if (a.startsWith('--phase=')) o.phase = a.slice('--phase='.length);
		else if (a.startsWith('--timeout=')) o.timeoutMs = Number(a.slice('--timeout='.length));
	}
	return o;
}

export function main(argv = process.argv.slice(2)) {
	const repoRoot = process.cwd();
	const opts = parseArgs(argv);

	const state = readState(stateFilePath(repoRoot));
	if (!state || !Array.isArray(state.planSteps) || state.planSteps.length === 0) {
		console.error('[phase-session] harness/state.json 이 없거나 planSteps 가 비어 있습니다 — 먼저 시드하세요 (exit 2)');
		return 2;
	}
	const phase = opts.phase ?? state.phase;
	if (!PHASE_TOOLS[phase]) {
		console.error(
			`[phase-session] '${phase}' 는 이 러너의 대상이 아닙니다 — 에이전트 페이즈(${Object.keys(PHASE_TOOLS).join('/')})만 실행합니다. ` +
				`결정적 페이즈(verify/merge)는 loop.mjs 가 직접 실행합니다. (exit 2)`,
		);
		return 2;
	}

	const cycleId = cycleIdOf(state);
	const stepLabel = (state.planSteps ?? [])[state.currentStepIdx ?? 0] ?? null;
	const sessionId = makeSessionId(phase, cycleId);

	// 프롬프트 생성·보존(감사 추적) → 격리 세션 실행
	const promptText = buildPrompt(repoRoot, { phase, cycleId, stepLabel, sessionId });
	const dir = path.join(repoRoot, 'harness', 'sessions');
	mkdirSync(dir, { recursive: true });
	const promptPath = path.join(dir, `${fileCycleId(cycleId)}-${phase}-prompt.md`);
	writeFileSync(promptPath, promptText, 'utf8');

	log(`격리 페이즈 세션 시작 — ${phase} (${cycleId}) / 지문 ${sessionId}`);
	log(`프롬프트: ${path.relative(repoRoot, promptPath)}`);
	const run = runPhaseSession(promptText, { repoRoot, phase, sessionId, timeoutMs: opts.timeoutMs });

	appendSessionLog(repoRoot, {
		at: new Date().toISOString(),
		cycleId,
		phase,
		stepLabel,
		sessionId,
		cmd: run.cmdLabel,
		code: run.code,
	});

	if (!run.ok) {
		log(`세션 실패(exit ${run.code}) — ${run.cmdLabel}`);
		if (run.stdoutTail) log(`stdout(끝부분): ${run.stdoutTail}`);
		return run.code === 0 ? 1 : (run.code ?? 1);
	}
	log(`세션 종료(exit 0) — 산출물 검증은 다음 loop.mjs 호출의 페이즈 계약이 수행한다`);
	if (run.stdoutTail) log(`stdout(끝부분): ${run.stdoutTail}`);
	return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	process.exit(main());
}
