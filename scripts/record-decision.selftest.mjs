#!/usr/bin/env node
// record-decision.selftest.mjs — 페이즈 산출물 기록 CLI 자가검증.
//
// 실행: node scripts/record-decision.selftest.mjs
//
// 왜 필요한가: 이 CLI 는 페이즈 산출물 계약의 **유일한 충족 수단**이다(스탬프를 손으로 적지 않는다).
// loop.selftest 시나리오 H 가 정상 경로를 배선으로 검증하지만, CLI 자체의 인자 계약
// (필수 필드 거부·알 수 없는 페이즈 거부·claims 콜론 파싱)은 아무도 보지 않았다 —
// 여기가 회귀하면 "일했는데 기록이 증거로 인정되지 않는" 종류의 실패가 된다.
//
// 네트워크 미사용. 임시 cwd 에서만 동작하며 실제 repo 를 오염시키지 않는다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactMarker, findPhaseRecord } from './lib/artifact.mjs';
import { parseArgs, parseClaims, RECORDABLE_PHASES } from './record-decision.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptsDir, 'record-decision.mjs');

const failures = [];
function check(label, cond, extra) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
		failures.push(label);
	}
}

/** CLI 를 임시 cwd 에서 실행 → {code, out} */
function run(cwd, args) {
	try {
		const out = execFileSync('node', [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
		return { code: 0, out };
	} catch (err) {
		return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
	}
}

// ── [A] 순수 파서 ────────────────────────────────────────────────────────────
console.log('[A] parseArgs / parseClaims');
{
	const a = parseArgs(['--phase=debate', '--topic', '안건 값', '--flag-only', '--why=근거']);
	check('[A] --k=v 와 --k v 를 함께 지원', a.phase === 'debate' && a.topic === '안건 값' && a.why === '근거');
	check('[A] 값 없는 플래그는 "true"', a['flag-only'] === 'true');

	const claims = parseClaims('ui:주장A:이유는 콜론:포함;qa:주장B:이유B; ;architect:주장만');
	check('[A] 세미콜론 분리 + 빈 조각 제거', claims.length === 3);
	check('[A] 이유 안의 콜론 보존(앞 2개만 구분자)', claims[0].reason === '이유는 콜론:포함');
	check('[A] 이유 없는 주장 허용', claims[2].agent === 'architect' && claims[2].claim === '주장만' && claims[2].reason === '');
	check('[A] 빈 입력 → 빈 배열', parseClaims('').length === 0 && parseClaims(undefined).length === 0);
	check('[A] 기록 가능 페이즈 = 에이전트 5종(verify/merge/evaluate 제외)', JSON.stringify([...RECORDABLE_PHASES].sort()) === JSON.stringify(['debate', 'decompose', 'design', 'implement', 'vote']));
}

// ── [B] 인자 계약 — 빈 기록은 증거가 아니다 ─────────────────────────────────
console.log('');
console.log('[B] 인자 계약 (필수 필드·페이즈 검증)');
const tmpB = mkdtempSync(path.join(os.tmpdir(), 'rd-selftest-'));
try {
	mkdirSync(path.join(tmpB, 'harness'), { recursive: true });
	writeFileSync(
		path.join(tmpB, 'harness', 'state.json'),
		JSON.stringify({ planSteps: ['01-a'], currentStepIdx: 0, phase: 'debate', phaseSeq: 3, status: 'running', reworkCount: 0 }) + '\n',
		'utf8',
	);

	check('[B] --phase 누락 → exit 2 + 사용법', (() => { const r = run(tmpB, ['--topic=t', '--conclusion=c', '--why=w']); return r.code === 2 && /사용:/.test(r.out); })());
	check('[B] 계약 밖 페이즈(verify) → exit 2', run(tmpB, ['--phase=verify', '--topic=t', '--conclusion=c', '--why=w']).code === 2);
	for (const req of ['topic', 'conclusion', 'why']) {
		const args = ['--phase=debate', '--topic=t', '--conclusion=c', '--why=w'].filter((a) => !a.startsWith(`--${req}=`));
		check(`[B] --${req} 누락 → exit 2 (빈 기록 차단)`, run(tmpB, args).code === 2);
	}
	check('[B] 값 없는 --topic (플래그만) → exit 2', run(tmpB, ['--phase=debate', '--topic', '--conclusion=c', '--why=w']).code === 2);
	check('[B] 거부 시 파일을 만들지 않는다', !existsSync(path.join(tmpB, 'harness', 'decisions')) || readdirSync(path.join(tmpB, 'harness', 'decisions')).length === 0);

	// state 도 --cycle 도 없으면 사이클을 알 수 없다 → 거부
	const noState = mkdtempSync(path.join(os.tmpdir(), 'rd-nostate-'));
	try {
		check('[B] state 없음 + --cycle 없음 → exit 2', run(noState, ['--phase=debate', '--topic=t', '--conclusion=c', '--why=w']).code === 2);
		check('[B] state 없음 + --cycle 지정 → 기록 허용', run(noState, ['--phase=debate', '--topic=t', '--conclusion=c', '--why=w', '--cycle=step-4#2']).code === 0);
		check('[B] 지정한 사이클로 스탬프가 찍힘', findPhaseRecord(noState, 'step-4#2', 'debate').found === true);
	} finally {
		rmSync(noState, { recursive: true, force: true });
	}
} catch (err) {
	failures.push(`B 예외: ${err?.stack ?? String(err)}`);
} finally {
	rmSync(tmpB, { recursive: true, force: true });
}

// ── [C] 정상 경로 — 스탬프·사이클 자동 계산이 계약 검사와 맞물린다 ────────────
console.log('');
console.log('[C] 정상 기록 (스탬프 자동 + 재작업 사이클)');
const tmpC = mkdtempSync(path.join(os.tmpdir(), 'rd-happy-'));
try {
	mkdirSync(path.join(tmpC, 'harness'), { recursive: true });
	// 재작업 2회차 상태 — 스탬프가 reworkCount 를 반영해야 이전 회차 기록이 오인되지 않는다.
	writeFileSync(
		path.join(tmpC, 'harness', 'state.json'),
		JSON.stringify({ planSteps: ['01-a', '02-b'], currentStepIdx: 1, phase: 'design', phaseSeq: 9, status: 'running', reworkCount: 2 }) + '\n',
		'utf8',
	);
	const r = run(tmpC, [
		'--phase=design',
		'--topic=AC 확정',
		'--conclusion=AC-1~2 + 단언 2건',
		'--why=이 step 의 의도',
		'--claims=architect:엔티티로:재사용;qa:문구 고정:단언 의존',
	]);
	check('[C] 정상 기록 exit 0', r.code === 0, r.out.slice(0, 200));
	check('[C] 출력에 스탬프 명시', r.out.includes(artifactMarker('step-1#2', 'design')));
	check('[C] state 에서 사이클(step-1#2)을 자동 계산해 찾을 수 있다', findPhaseRecord(tmpC, 'step-1#2', 'design').found === true);
	check('[C] 다른 회차(step-1#0)로는 찾지 못한다(신선도)', findPhaseRecord(tmpC, 'step-1#0', 'design').found === false);

	const file = path.join(tmpC, findPhaseRecord(tmpC, 'step-1#2', 'design').file);
	const body = readFileSync(file, 'utf8');
	check('[C] 본문에 사이클·페이즈 표 행 기록', /\| 사이클 \| step-1#2 \|/.test(body) && /\| 페이즈 \| design \|/.test(body));
	check('[C] claims 가 표 행으로 기록됨', /\| architect \| 엔티티로 \| 재사용 \|/.test(body));
	check('[C] linkedStep 에 step 라벨+페이즈', /02-b \(design\)/.test(body));
} catch (err) {
	failures.push(`C 예외: ${err?.stack ?? String(err)}`);
} finally {
	rmSync(tmpC, { recursive: true, force: true });
}

console.log('');
if (failures.length === 0) {
	console.log('RECORD-DECISION SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`RECORD-DECISION SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
