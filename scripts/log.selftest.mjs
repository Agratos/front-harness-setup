#!/usr/bin/env node
// log.selftest.mjs — logError / logCycle 자가검증 (US-008)
//
// 임시 디렉터리에서 logError / logCycle 를 호출해 산출물이 스키마를 만족하는지 검증한다.
// 검증 통과 시 'LOG SELFTEST: PASS' 를 출력하고 exit 0.
// 검증 실패 시 오류 메시지를 출력하고 exit 1.
// 실행 후 임시 디렉터리를 삭제한다(clean-up).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logMjs = pathToFileURL(path.join(__dirname, 'lib', 'log.mjs')).href;
const { logError, logCycle } = await import(logMjs);

// ── 임시 repoRoot 생성 ──────────────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), `log-selftest-${process.pid}`);
mkdirSync(tmpRoot, { recursive: true });

let passed = true;
const failures = [];

function assert(condition, msg) {
	if (!condition) {
		passed = false;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	} else {
		console.log(`  ok: ${msg}`);
	}
}

try {
	// ── 1) logError 검증 ──────────────────────────────────────────────────────
	console.log('[selftest] logError 검증...');

	const errorFilePath = logError(tmpRoot, {
		phase: 'verify',
		where: 'scripts/done-gate.mjs:typecheck (exit 1)',
		message: 'error TS2322: Type string is not assignable to type number',
		cause: '타입 선언 누락으로 인한 TypeScript 컴파일 오류',
		fixSummary: '`src/foo.ts:10` 에서 반환 타입을 `number` 로 명시 — 1줄 수정',
	});

	assert(typeof errorFilePath === 'string', 'logError returns a string path');
	assert(existsSync(errorFilePath), `오류 파일 생성됨: ${errorFilePath}`);

	const content = readFileSync(errorFilePath, 'utf8');

	// 스키마 필드 검증: 위치 / 오류메시지 / 원인 / 수정diff요약
	assert(content.includes('위치'), '오류 파일에 "위치" 필드 포함');
	assert(content.includes('오류메시지'), '오류 파일에 "오류메시지" 필드 포함');
	assert(content.includes('원인'), '오류 파일에 "원인" 필드 포함');
	assert(content.includes('수정diff요약'), '오류 파일에 "수정diff요약" 필드 포함');
	assert(
		content.includes('scripts/done-gate.mjs:typecheck (exit 1)'),
		'where 값이 파일에 기록됨',
	);
	assert(
		content.includes('error TS2322'),
		'message 값이 파일에 기록됨',
	);
	assert(
		content.includes('타입 선언 누락'),
		'cause 값이 파일에 기록됨',
	);
	assert(
		content.includes('src/foo.ts:10'),
		'fixSummary 값이 파일에 기록됨',
	);

	// 두 번째 호출 → seq 가 1 증가해 다른 파일명이어야 함
	const errorFilePath2 = logError(tmpRoot, {
		phase: 'implement',
		where: 'src/bar.ts:42',
		message: 'Cannot find module',
		cause: '임포트 경로 오타',
		fixSummary: '경로 수정',
	});
	assert(errorFilePath !== errorFilePath2, '두 번째 logError 는 다른 파일명 생성');
	assert(existsSync(errorFilePath2), '두 번째 오류 파일 생성됨');

	// ── 2) logCycle 검증 ──────────────────────────────────────────────────────
	console.log('[selftest] logCycle 검증...');

	const cycleLogPath = logCycle(tmpRoot, {
		step: 0,
		phase: 'verify',
		note: '셀프테스트용 사이클 진행 기록',
		phaseSeq: 1,
		checkpointToken: '1-verify-0',
		stepLabel: 'US-008',
		outcome: 'test',
	});

	assert(typeof cycleLogPath === 'string', 'logCycle returns a string path');
	assert(existsSync(cycleLogPath), `사이클 로그 파일 생성됨: ${cycleLogPath}`);

	const cycleContent = readFileSync(cycleLogPath, 'utf8');
	const lines = cycleContent.trim().split('\n').filter(Boolean);
	assert(lines.length >= 1, '사이클 로그에 1줄 이상 기록됨');

	const lastLine = lines[lines.length - 1];
	let parsed;
	try {
		parsed = JSON.parse(lastLine);
	} catch {
		assert(false, '사이클 로그 마지막 줄이 유효한 JSON');
	}

	if (parsed) {
		assert(parsed.phase === 'verify', 'phase 필드 정확');
		assert(parsed.checkpointToken === '1-verify-0', 'checkpointToken 필드 정확');
		assert(parsed.phaseSeq === 1, 'phaseSeq 필드 정확');
		assert(parsed.detail === '셀프테스트용 사이클 진행 기록', 'detail(note) 필드 정확');
	}

	// 두 번째 append → 줄 수 증가 확인
	logCycle(tmpRoot, { phase: 'implement', note: '두 번째 항목', outcome: 'log' });
	const lines2 = readFileSync(cycleLogPath, 'utf8').trim().split('\n').filter(Boolean);
	assert(lines2.length === lines.length + 1, '두 번째 logCycle append 후 줄 수 1 증가');

} finally {
	// ── clean-up ──────────────────────────────────────────────────────────────
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// 정리 실패는 테스트 결과에 영향 없음
	}
}

if (passed) {
	console.log('LOG SELFTEST: PASS');
	process.exit(0);
} else {
	console.error(`LOG SELFTEST: FAIL (${failures.length} assertion(s) failed)`);
	process.exit(1);
}
