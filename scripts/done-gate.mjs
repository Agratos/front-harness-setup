#!/usr/bin/env node
// done-gate.mjs — done-gate (완료 게이트) 강제 (US-007)
//
// 두 축으로 step 의 "완료" 를 판정합니다.
//
//   1) 결정적 게이트(deterministic gate): yarn typecheck / yarn lint /
//      node scripts/check-arch.js / yarn test --run 가 모두 통과해야 함.
//      `--deterministic-only` 면 이 부분만 실행하고 종료합니다.
//
//   2) 평가 임계치(evaluation threshold) — 히스테리시스(hysteresis) + 래치(latch):
//      최신 harness/evaluations/<id>.json 의 종합(score) 과 major 불만 수를 읽어
//      아래 규칙으로 통과/탈락을 판정합니다.
//
// ── 히스테리시스 + 래치 규칙 (플래핑 방지) ─────────────────────────────────
//   • ENTER(진입):  종합 score >= ENTER_THRESHOLD(90) AND major 불만 == 0 이면 통과(pass).
//                   이때 state.scores[stepId].latched = true 로 래치를 건다.
//   • HOLD(유지):   한 번 래치된(latched=true) step 은 score 가 HOLD_THRESHOLD(88)
//                   이상이면 계속 통과로 유지한다. 즉 88~90 사이의 미세 변동은
//                   통과/탈락을 번갈아 뒤집지(flapping) 않는다.
//   • DROP(탈락):   래치된 step 이라도 score < HOLD_THRESHOLD(88) 이면 탈락하고
//                   래치를 해제(latched=false)한다. 또한 major 불만이 생기면 탈락한다.
//   • 미래치 상태에서 88~90 사이(진입 미달)면 통과하지 못한다(아직 enter 안 됨).
//
//   ENTER(90) > HOLD(88) 인 hold band(88~90) 가 히스테리시스 폭이며,
//   이 폭 덕분에 89.x 근처에서 점수가 흔들려도 결과가 깜빡이지 않는다.
//
// 종료 코드: 결정적 게이트 통과 AND 평가 임계치(또는 래치) 충족 시에만 exit 0.
// `--json` 으로 머신리더블 결과를 출력합니다.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readState, stateFilePath, writeState } from './lib/state.mjs';
import { logError } from './lib/log.mjs';

export const ENTER_THRESHOLD = 90; // 진입(enter) 임계치 — 이 이상이어야 새로 통과
export const HOLD_THRESHOLD = 88; // 유지(hold) 임계치 — 래치 후 이 미만이면 탈락
// hold band = [HOLD_THRESHOLD, ENTER_THRESHOLD) = [88, 90) → 히스테리시스 폭

/**
 * 히스테리시스 + 래치 판정 (순수 함수, I/O 없음 — 테스트 용이).
 * @param {{score:number, majorComplaints:number}} evaluation 최신 평가
 * @param {boolean} wasLatched 이 step 이 이전에 래치(통과 고정)됐는지
 * @returns {{pass:boolean, latched:boolean, reason:string}}
 */
export function evaluateHysteresis(evaluation, wasLatched) {
	const score = Number(evaluation?.score ?? NaN);
	const major = Number(evaluation?.majorComplaints ?? 0);

	if (!Number.isFinite(score)) {
		return { pass: false, latched: false, reason: 'score 값이 유효하지 않음 (NaN)' };
	}
	// major 불만이 있으면 진입/유지 모두 불가 → 즉시 탈락 + 래치 해제
	if (major > 0) {
		return { pass: false, latched: false, reason: `major 불만 ${major}건 → 탈락 (래치 해제)` };
	}

	if (wasLatched) {
		// 이미 통과 래치됨 → hold band 적용: HOLD 이상이면 유지
		if (score >= HOLD_THRESHOLD) {
			return {
				pass: true,
				latched: true,
				reason: `래치 유지: score ${score} >= HOLD(${HOLD_THRESHOLD}) — 88~90 미세변동 무시(no-flap)`,
			};
		}
		return {
			pass: false,
			latched: false,
			reason: `래치 해제: score ${score} < HOLD(${HOLD_THRESHOLD}) → 탈락`,
		};
	}

	// 미래치 상태 → 진입은 ENTER 이상 필요
	if (score >= ENTER_THRESHOLD) {
		return {
			pass: true,
			latched: true,
			reason: `진입: score ${score} >= ENTER(${ENTER_THRESHOLD}), major 0 → 통과+래치`,
		};
	}
	return {
		pass: false,
		latched: false,
		reason: `미진입: score ${score} < ENTER(${ENTER_THRESHOLD}) (hold band 안이어도 최초 진입은 ENTER 필요)`,
	};
}

/** CLI 인자 파싱: --json --deterministic-only --score=N --major-complaints=N --skip-deterministic */
function parseArgs(argv) {
	const opts = {
		json: false,
		deterministicOnly: false,
		skipDeterministic: false,
		voteOverride: false,
		score: undefined,
		majorComplaints: undefined,
		stepId: undefined,
	};
	for (const arg of argv) {
		if (arg === '--json') opts.json = true;
		else if (arg === '--deterministic-only') opts.deterministicOnly = true;
		else if (arg === '--skip-deterministic') opts.skipDeterministic = true;
		else if (arg === '--vote-override') opts.voteOverride = true;
		else if (arg.startsWith('--score=')) opts.score = Number(arg.slice('--score='.length));
		else if (arg.startsWith('--major-complaints='))
			opts.majorComplaints = Number(arg.slice('--major-complaints='.length));
		else if (arg.startsWith('--step-id=')) opts.stepId = arg.slice('--step-id='.length);
	}
	return opts;
}

/**
 * 단일 결정적 명령 실행 → {name, ok, code, output} (출력은 상속하여 그대로 표시).
 * 실패 시 stderr+stdout 마지막 2000자를 output 에 담아 반환한다 (오류 로그용).
 * @param {string} name 게이트 이름(로그용)
 * @param {string} cmd 실행 파일
 * @param {string[]} args 인자
 * @param {string} cwd 작업 디렉터리
 * @param {boolean} [useShell] true 면 셸 경유 실행 (Windows .cmd 래퍼 대응)
 */
function runGate(name, cmd, args, cwd, useShell = false) {
	try {
		execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: useShell });
		return { name, ok: true, code: 0, output: '' };
	} catch (err) {
		// stderr/stdout 이 Buffer 로 올 수 있음 (stdio:'inherit' 에서는 비어 있을 수 있음)
		const stderr = err.stderr ? err.stderr.toString('utf8') : '';
		const stdout = err.stdout ? err.stdout.toString('utf8') : '';
		const combined = (stdout + '\n' + stderr).trim();
		// 마지막 2000자만 보존 (긴 출력 truncation)
		const output = combined.length > 2000 ? combined.slice(-2000) : combined;
		return { name, ok: false, code: err.status ?? 1, output };
	}
}

/**
 * 결정적 게이트 4종 실행: typecheck / lint / check-arch / test --run.
 * 실패한 게이트마다 logError 를 호출해 harness/errors/<id>.md 를 기록한다.
 * 성공 시에는 오류 로그를 생성하지 않는다.
 * @param {string} repoRoot
 * @returns {{passed:boolean, gates:Array<{name:string,ok:boolean,code:number}>}}
 */
export function runDeterministicGate(repoRoot) {
	// Node 18.20+/20+/22 의 보안 변경으로 Windows 에서 .cmd/.bat 를 execFileSync 로 직접
	// 스폰하면 EINVAL 이 납니다. 따라서 Windows 에서는 shell:true 로 셸 경유 실행하고,
	// 그 외 OS 에서는 'yarn' 을 직접 실행합니다. yarn 4(berry) 는 `yarn <script>` 형태.
	const isWin = process.platform === 'win32';
	const yarnCmd = 'yarn'; // yarn 4(berry) 는 `yarn <script>` 형태 — OS 무관 동일
	const gates = [
		runGate('typecheck', yarnCmd, ['typecheck'], repoRoot, isWin),
		runGate('lint', yarnCmd, ['lint'], repoRoot, isWin),
		runGate('check-arch', 'node', [path.join(repoRoot, 'scripts', 'check-arch.js')], repoRoot, false),
		runGate('test', yarnCmd, ['test:run'], repoRoot, isWin),
	];
	const passed = gates.every((g) => g.ok);

	// 실패한 게이트마다 오류 로그 기록 (성공 게이트는 로그 미생성)
	for (const g of gates) {
		if (!g.ok) {
			try {
				logError(repoRoot, {
					phase: 'verify',
					where: `done-gate: ${g.name} (exit ${g.code})`,
					message: g.output || `gate '${g.name}' failed with exit code ${g.code}`,
					cause: `결정적 게이트 '${g.name}' 실패 (exit ${g.code})`,
					fixSummary: 'TBD — 게이트 통과 후 이 항목을 갱신하세요',
				});
			} catch {
				// 오류 로그 기록 실패 시 게이트 판정에 영향 없음
			}
		}
	}

	return { passed, gates };
}

/**
 * harness/evaluations/ 에서 최신 <id>.json 평가를 로드.
 * 파일명 사전순 최댓값을 "최신" 으로 본다(타임스탬프/증가 id 권장).
 * @param {string} repoRoot
 * @returns {{score:number, majorComplaints:number, id:string}|null}
 */
export function loadLatestEvaluation(repoRoot) {
	const dir = path.join(repoRoot, 'harness', 'evaluations');
	if (!existsSync(dir)) return null;
	let entries;
	try {
		// 평가 파일은 `eval-*.json` 만. (eval-scenario 등 다른 *.json 이 루트에 있어도 평가로 오인 금지 — NaN→탈락 방지)
		entries = readdirSync(dir).filter((f) => /^eval-.*\.json$/.test(f));
	} catch {
		return null;
	}
	if (entries.length === 0) return null;
	entries.sort(); // 사전순 — id 가 zero-padded/ISO 면 시간순과 일치
	const latest = entries[entries.length - 1];
	try {
		const raw = JSON.parse(readFileSync(path.join(dir, latest), 'utf8'));
		return {
			score: Number(raw.score ?? raw.total ?? NaN),
			majorComplaints: Number(raw.majorComplaints ?? raw.major ?? 0),
			id: path.basename(latest, '.json'),
			stepId: raw.stepId ?? null,
			phaseSeq: raw.phaseSeq ?? null,
		};
	} catch {
		return null;
	}
}

/** 평가 소스 결정: 주입(--score/env) 우선, 없으면 최신 평가 파일 */
function resolveEvaluation(opts, repoRoot) {
	const injectedScore = opts.score ?? (process.env.HARNESS_EVAL_SCORE ? Number(process.env.HARNESS_EVAL_SCORE) : undefined);
	const injectedMajor =
		opts.majorComplaints ?? (process.env.HARNESS_EVAL_MAJOR ? Number(process.env.HARNESS_EVAL_MAJOR) : undefined);
	if (injectedScore !== undefined) {
		return { score: injectedScore, majorComplaints: injectedMajor ?? 0, id: 'injected', source: 'injected' };
	}
	const latest = loadLatestEvaluation(repoRoot);
	if (latest) return { ...latest, source: 'file' };
	return null;
}

/** 현재 step 식별자: 명시 --step-id 우선, 아니면 state.currentStepIdx 로 유도 */
function resolveStepId(opts, state) {
	if (opts.stepId) return opts.stepId;
	if (!state) return 'step-0';
	return `step-${state.currentStepIdx ?? 0}`;
}

/**
 * 전체 게이트 실행 (CLI 진입점에서 사용).
 * @param {object} opts parseArgs 결과
 * @param {string} repoRoot
 * @returns {{exitCode:number, result:object}}
 */
export function runDoneGate(opts, repoRoot) {
	const result = {
		deterministic: null,
		evaluation: null,
		hysteresis: null,
		stepId: null,
		passed: false,
	};

	// 1) 결정적 게이트
	if (!opts.skipDeterministic) {
		const det = runDeterministicGate(repoRoot);
		result.deterministic = det;
		if (!det.passed) {
			result.passed = false;
			// 결정적 게이트 실패면 평가까지 갈 필요 없이 탈락 (--deterministic-only 여부 무관)
			return { exitCode: 1, result };
		}
	} else {
		result.deterministic = { passed: true, gates: [], skipped: true };
	}

	if (opts.deterministicOnly) {
		result.passed = result.deterministic.passed;
		return { exitCode: result.deterministic.passed ? 0 : 1, result };
	}

	// 투표 오버라이드: 재작업 5회(MAX_REWORK) 초과 후 에이전트 투표가 진행을 의결한 경우.
	// 결정적 게이트는 위에서 이미 통과를 확인했고(미통과면 조기 return), 주관 평가 임계만 대체한다.
	// → 깨진 코드(타입/린트/테스트/아키텍처 위반)는 절대 병합되지 않으면서도,
	//   주관 점수 정체(90 미만)로는 루프가 영구히 멈추지 않게 한다(완전 자율 — 사양서 확정 2).
	if (opts.voteOverride) {
		result.evaluation = resolveEvaluation(opts, repoRoot); // 참고용(있으면 기록)
		result.hysteresis = {
			pass: true,
			latched: false,
			reason: '투표 오버라이드: 재작업 한도(5회) 초과 후 에이전트 투표로 주관 임계 대체 (결정적 게이트는 충족)',
		};
		result.passed = result.deterministic.passed;
		return { exitCode: result.passed ? 0 : 1, result };
	}

	// 2) 평가 임계치 (히스테리시스 + 래치)
	const statePath = stateFilePath(repoRoot);
	const state = readState(statePath);
	const stepId = resolveStepId(opts, state);
	result.stepId = stepId;

	const evaluation = resolveEvaluation(opts, repoRoot);
	if (!evaluation) {
		result.evaluation = null;
		result.hysteresis = { pass: false, latched: false, reason: '평가 데이터 없음 (주입/파일 모두 부재)' };
		result.passed = false;
		return { exitCode: 1, result };
	}
	result.evaluation = evaluation;

	// freshness 게이트: 파일 기반 평가는 **현재 step 의 이번 사이클 평가**여야 한다.
	// 이전에 남은 평가(예: eval-0001 score=100)가 모든 step 을 도장 찍어 "가짜 통과"시키던
	// 버그를 막는다 — eval JSON 의 stepId 가 현재 step 과 다르면(또는 없으면) 거부.
	// (주입 평가 `--score`/env 는 CI·테스트 경로이므로 freshness 면제: source==='injected')
	if (evaluation.source === 'file' && evaluation.stepId !== stepId) {
		result.hysteresis = {
			pass: false,
			latched: false,
			reason: `stale 평가 거부: eval.stepId=${evaluation.stepId ?? '없음'} ≠ 현재 ${stepId} → 이번 사이클의 신선한 평가 필요(가짜 통과 차단)`,
		};
		result.passed = false;
		return { exitCode: 1, result };
	}

	const wasLatched = !!(state?.scores?.[stepId]?.latched);
	const hyst = evaluateHysteresis(evaluation, wasLatched);
	result.hysteresis = hyst;

	// 래치 상태를 state.scores[stepId] 에 영속화 (state 가 있을 때만)
	if (state) {
		const nextScores = {
			...(state.scores ?? {}),
			[stepId]: {
				...(state.scores?.[stepId] ?? {}),
				score: evaluation.score,
				majorComplaints: evaluation.majorComplaints,
				latched: hyst.latched,
			},
		};
		writeState(statePath, { ...state, scores: nextScores });
	}

	result.passed = result.deterministic.passed && hyst.pass;
	return { exitCode: result.passed ? 0 : 1, result };
}

function printHuman(result) {
	console.log('=== done-gate ===');
	if (result.deterministic) {
		if (result.deterministic.skipped) {
			console.log('결정적 게이트: SKIPPED (--skip-deterministic)');
		} else {
			for (const g of result.deterministic.gates) {
				console.log(`  [${g.ok ? 'PASS' : 'FAIL'}] ${g.name} (exit ${g.code})`);
			}
			console.log(`결정적 게이트: ${result.deterministic.passed ? 'PASS' : 'FAIL'}`);
		}
	}
	if (result.evaluation) {
		console.log(
			`평가: step=${result.stepId} score=${result.evaluation.score} major=${result.evaluation.majorComplaints} (source=${result.evaluation.source ?? '?'})`,
		);
	}
	if (result.hysteresis) {
		console.log(`히스테리시스: ${result.hysteresis.pass ? 'PASS' : 'FAIL'} (latched=${result.hysteresis.latched}) — ${result.hysteresis.reason}`);
	}
	console.log(`done-gate 종합: ${result.passed ? 'PASS' : 'FAIL'}`);
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const repoRoot = process.cwd();
	const { exitCode, result } = runDoneGate(opts, repoRoot);
	if (opts.json) {
		process.stdout.write(JSON.stringify(result, null, 2) + '\n');
	} else {
		printHuman(result);
	}
	process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
