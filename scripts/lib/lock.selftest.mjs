#!/usr/bin/env node
// lock.selftest.mjs — 드라이버 단일 실행 잠금(lock.mjs) 자가검증
//
// 임시 디렉터리에서 acquire/release/썩은 잠금 인수를 결정적으로 검증한다.
// 성공: 'LOCK SELFTEST: PASS' + exit 0 / 실패: 실패 목록 + exit 1.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { acquireLock, releaseLock, lockFilePath, LOCK_STALE_MS } = await import(
	pathToFileURL(path.join(__dirname, 'lock.mjs')).href
);

const failures = [];
function check(label, condition) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

const tmpRoot = path.join(os.tmpdir(), `lock-selftest-${process.pid}`);
mkdirSync(tmpRoot, { recursive: true });

try {
	// [1] 획득 → 잠금 파일 생성 + pid 기록
	const a1 = acquireLock(tmpRoot, { holder: 'selftest' });
	check('[1] 최초 획득 성공', a1.ok === true);
	const lockPath = lockFilePath(tmpRoot);
	check('[1] 잠금 파일 생성됨', existsSync(lockPath));
	const info1 = JSON.parse(readFileSync(lockPath, 'utf8'));
	check('[1] 잠금에 내 pid 기록', info1.pid === process.pid);
	check('[1] 잠금에 holder 기록', info1.holder === 'selftest');

	// [2] 보유 중(살아있는 pid + 신선) → 재획득 거부
	const a2 = acquireLock(tmpRoot, { holder: 'second' });
	check('[2] 살아있는 잠금은 재획득 거부', a2.ok === false);
	check('[2] 거부 응답에 보유 pid 포함', a2.pid === process.pid);

	// [3] 해제 → 파일 삭제 → 재획득 성공
	check('[3] 내 잠금 해제 성공', releaseLock(tmpRoot) === true);
	check('[3] 해제 후 잠금 파일 없음', !existsSync(lockPath));
	const a3 = acquireLock(tmpRoot, { holder: 'again' });
	check('[3] 해제 후 재획득 성공', a3.ok === true);
	releaseLock(tmpRoot);

	// [4] 죽은 pid 의 잠금 → 인수(takeover)
	writeFileSync(
		lockPath,
		JSON.stringify({ pid: 999999999, holder: 'dead', acquiredAt: new Date().toISOString() }) + '\n',
		'utf8',
	);
	const a4 = acquireLock(tmpRoot, { holder: 'takeover' });
	check('[4] 죽은 pid 잠금 인수 성공', a4.ok === true);
	check('[4] 인수 후 내 pid 로 교체', JSON.parse(readFileSync(lockPath, 'utf8')).pid === process.pid);
	releaseLock(tmpRoot);

	// [5] 살아있는 pid 라도 stale(오래됨) → 인수
	const oldTs = new Date(Date.now() - LOCK_STALE_MS - 60_000).toISOString();
	writeFileSync(
		lockPath,
		JSON.stringify({ pid: process.pid, holder: 'stale', acquiredAt: oldTs }) + '\n',
		'utf8',
	);
	const a5 = acquireLock(tmpRoot, { holder: 'stale-takeover' });
	check('[5] stale 잠금 인수 성공', a5.ok === true);
	releaseLock(tmpRoot);

	// [6] 깨진 잠금 파일(JSON 아님) → 인수
	writeFileSync(lockPath, 'not-json\n', 'utf8');
	const a6 = acquireLock(tmpRoot, { holder: 'broken-takeover' });
	check('[6] 깨진 잠금 인수 성공', a6.ok === true);

	// [7] 남의 잠금은 release 로 못 지운다
	writeFileSync(
		lockPath,
		JSON.stringify({ pid: 999999999, holder: 'other', acquiredAt: new Date().toISOString() }) + '\n',
		'utf8',
	);
	check('[7] 남의 잠금 해제 거부', releaseLock(tmpRoot) === false);
	check('[7] 남의 잠금 파일 보존', existsSync(lockPath));
} finally {
	rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('');
if (failures.length === 0) {
	console.log('LOCK SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`LOCK SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
