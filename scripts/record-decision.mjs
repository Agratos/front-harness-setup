#!/usr/bin/env node
// record-decision.mjs — 에이전트 페이즈의 **산출물(협의 기록)을 스탬프와 함께** 남기는 CLI.
//
// 왜 스크립트로 만들었나:
//   `loop.mjs` 는 전진 직전에 "이번 사이클의 이 페이즈 기록이 있는가" 를 확인한다(페이즈 산출물 계약).
//   그 스탬프(`<!-- harness:artifact cycleId=... phase=... -->`)를 오케스트레이터가 손으로 적으면
//   사이클 id 를 잘못 계산하거나 형식이 어긋나 **일하고도 막히는** 일이 생긴다.
//   이 CLI 는 `harness/state.json` 에서 사이클·step 라벨을 읽어 스탬프를 자동으로 찍는다.
//   (= 기계적인 일은 코드가, 판단은 에이전트가 — 이 하네스의 일관 원칙)
//
//   이 파일의 존재 자체가 계약의 **환경 조건**이다. 없으면 `phase-gate` 가 계약을 비활성으로 본다
//   (기록할 도구가 없는 환경에서 기록을 요구하면 만들 방법이 없기 때문).
//
// 사용:
//   node scripts/record-decision.mjs --phase=debate \
//     --topic="평가 결과 통과 여부" --conclusion="통과" --why="major 0 + 종합 94" \
//     [--claims="customer:통과:불만 없음;ux:통과:흐름 명확"] [--raised-by=pm] \
//     [--rebuttals="a|b"] [--compromise="..."] [--impact="..."] [--cycle=step-0#0]
//
// 출력: 생성된 파일 경로 + 찍힌 스탬프. exit 0 = 기록 완료, 2 = 인자 오류.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { artifactMarker } from './lib/artifact.mjs';
import { logDecision } from './lib/log.mjs';
import { PHASE_CONTRACT } from './lib/phase-gate.mjs';
import { cycleIdOf, readState, stateFilePath } from './lib/state.mjs';

/** 기록으로 마감할 수 있는 페이즈 = 계약이 `decision` 증거를 요구하는 페이즈 + implement(면제 기록). */
export const RECORDABLE_PHASES = Object.keys(PHASE_CONTRACT).filter(
	(p) => p !== 'evaluate' && p !== 'verify' && p !== 'merge',
);

/** `--k=v` / `--k v` 를 함께 지원하는 최소 파서. */
export function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const eq = a.indexOf('=');
		if (eq !== -1) {
			out[a.slice(2, eq)] = a.slice(eq + 1);
		} else {
			const next = argv[i + 1];
			out[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : 'true';
		}
	}
	return out;
}

/**
 * `--claims="agent:claim:reason;agent2:claim2:reason2"` → logDecision 의 claims 배열.
 * 콜론이 이유 안에 들어갈 수 있으므로 **앞의 두 개만** 구분자로 쓴다.
 */
export function parseClaims(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	return raw
		.split(';')
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.map((chunk) => {
			const first = chunk.indexOf(':');
			if (first === -1) return { agent: '?', claim: chunk, reason: '' };
			const second = chunk.indexOf(':', first + 1);
			if (second === -1) return { agent: chunk.slice(0, first).trim(), claim: chunk.slice(first + 1).trim(), reason: '' };
			return {
				agent: chunk.slice(0, first).trim(),
				claim: chunk.slice(first + 1, second).trim(),
				reason: chunk.slice(second + 1).trim(),
			};
		});
}

function usage(msg) {
	if (msg) console.error(`[record-decision] ${msg}`);
	console.error('');
	console.error('사용: node scripts/record-decision.mjs --phase=<페이즈> --topic="<안건>" --conclusion="<결론>" --why="<근거>"');
	console.error(`  --phase       ${RECORDABLE_PHASES.join(' | ')}`);
	console.error('  --topic       안건 (무엇을 정했나)');
	console.error('  --conclusion  결론 (무엇으로 정했나)');
	console.error('  --why         근거 (왜 그렇게 정했나)');
	console.error('  선택: --claims="agent:주장:이유;..." --raised-by --rebuttals="a|b" --compromise --impact --cycle');
	console.error('');
	console.error('예: node scripts/record-decision.mjs --phase=design --topic="AC 확정" \\');
	console.error('      --conclusion="AC-1~3 + 각 AC 를 덮는 단언 3건" --why="추가·초기화·통계 반영이 이 step 의 의도"');
}

function main() {
	const repoRoot = process.cwd();
	const args = parseArgs(process.argv.slice(2));

	const phase = args.phase;
	if (!phase || !RECORDABLE_PHASES.includes(phase)) {
		usage(`--phase 가 없거나 알 수 없는 페이즈입니다: ${phase ?? '(없음)'}`);
		process.exit(2);
	}
	// 판단의 내용이 비어 있으면 기록이 형식만 남는다 — 계약을 형식적으로 통과시키는 빈 기록을 막는다.
	for (const req of ['topic', 'conclusion', 'why']) {
		if (typeof args[req] !== 'string' || !args[req].trim() || args[req] === 'true') {
			usage(`--${req} 가 비어 있습니다 (안건·결론·근거는 필수 — 빈 기록은 증거가 아닙니다)`);
			process.exit(2);
		}
	}

	const statePath = stateFilePath(repoRoot);
	const state = readState(statePath);
	if (!state && !args.cycle) {
		usage(`harness/state.json 이 없어 사이클을 알 수 없습니다 — --cycle=step-0#0 으로 직접 지정하세요`);
		process.exit(2);
	}
	const cycleId = args.cycle && args.cycle !== 'true' ? args.cycle : cycleIdOf(state);
	const stepLabel = args['linked-step'] ?? (state?.planSteps ?? [])[state?.currentStepIdx ?? 0] ?? null;

	const filePath = logDecision(repoRoot, {
		topic: args.topic,
		raisedBy: args['raised-by'] ?? 'pm',
		claims: parseClaims(args.claims),
		rebuttals: typeof args.rebuttals === 'string' && args.rebuttals !== 'true' ? args.rebuttals.split('|') : [],
		compromise: args.compromise && args.compromise !== 'true' ? args.compromise : undefined,
		conclusion: args.conclusion,
		why: args.why,
		impact: args.impact && args.impact !== 'true' ? args.impact : `phase=${phase}`,
		linkedStep: stepLabel ? `${stepLabel} (${phase})` : `(${phase})`,
		cycleId,
		phase,
	});

	const rel = path.relative(repoRoot, filePath) || filePath;
	console.log(`[record-decision] 기록 완료: ${rel}`);
	console.log(`[record-decision] 스탬프: ${artifactMarker(cycleId, phase)}`);
	if (!existsSync(statePath)) {
		console.log('[record-decision] ⚠ state.json 이 없어 --cycle 값을 그대로 사용했습니다 — 드라이버 사이클과 일치하는지 확인하세요');
	}
	process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
