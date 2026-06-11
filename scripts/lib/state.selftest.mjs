// state.selftest.mjs — state.mjs 자가검증 (US-005)
//
// 실행: node scripts/lib/state.selftest.mjs
// 성공 시 'STATE SELFTEST: PASS' 출력 후 exit 0, 실패 시 실패 목록 출력 후 exit 1.
// 절대로 harness/state.json 을 건드리지 않고 os.tmpdir() 기반 임시 경로만 사용한다.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { advancePhase, defaultState, markCommitted, needsRerun, readState, writeState } from './state.mjs';

const failures = [];

/** 조건이 거짓이면 실패 목록에 메시지를 추가한다. */
function assert(cond, msg) {
	if (!cond) failures.push(msg);
}

/** 깊은 동등 비교(JSON 직렬화 기준). */
function deepEqual(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

// os.tmpdir() 기반 격리된 임시 디렉터리 — harness/state.json 미사용 보장
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'harness-state-selftest-'));
const statePath = path.join(tmpDir, 'nested', 'state.json'); // 부모 디렉터리 자동생성도 검증

try {
	// 1) 원자적 write → read 라운드트립 동등성
	const s0 = defaultState(['plan', 'build', 'verify']);
	writeState(statePath, s0);
	const readBack = readState(statePath);
	assert(deepEqual(readBack, s0), 'write→read 라운드트립 불일치');
	assert(readBack !== null, 'readState 가 null 반환(파일 없음으로 오판)');

	// 2) 없는 경로는 null 반환
	assert(readState(path.join(tmpDir, 'does-not-exist.json')) === null, '없는 파일 readState 가 null 이 아님');

	// 3) advancePhase 두 번 → phaseSeq 단조 증가 + token 변경 + committed=false
	const before = readState(statePath);
	const seq0 = before.phaseSeq;
	const token0 = before.checkpointToken;

	const p1 = advancePhase(before, 'design');
	assert(p1.phaseSeq === seq0 + 1, `phaseSeq 가 1 증가하지 않음 (${seq0} → ${p1.phaseSeq})`);
	assert(p1.checkpointToken !== token0, 'advancePhase 후 checkpointToken 이 변하지 않음 (1회차)');
	assert(p1.committed === false, 'advancePhase 후 committed 가 false 로 리셋되지 않음 (1회차)');
	assert(before.phaseSeq === seq0, 'advancePhase 가 원본을 변형함(immutable 위반)');

	const p2 = advancePhase(p1, 'implement');
	assert(p2.phaseSeq === p1.phaseSeq + 1, `phaseSeq 가 단조 증가하지 않음 (${p1.phaseSeq} → ${p2.phaseSeq})`);
	assert(p2.phaseSeq === seq0 + 2, `phaseSeq 누적 증가 오류 (기대 ${seq0 + 2}, 실제 ${p2.phaseSeq})`);
	assert(p2.checkpointToken !== p1.checkpointToken, 'advancePhase 후 checkpointToken 이 변하지 않음 (2회차)');
	assert(p2.committed === false, 'advancePhase 후 committed 가 false 로 리셋되지 않음 (2회차)');

	// 4) markCommitted → committed=true + sha 기록
	const committed = markCommitted(p2, 'abc1234');
	assert(committed.committed === true, 'markCommitted 후 committed 가 true 가 아님');
	assert(committed.lastCommittedSha === 'abc1234', 'markCommitted 후 lastCommittedSha 미기록');
	assert(p2.committed === false, 'markCommitted 가 원본을 변형함(immutable 위반)');

	// 5) 비-git 경로: sha=null 허용
	const committedNoGit = markCommitted(p2);
	assert(committedNoGit.committed === true, '비-git markCommitted 후 committed 가 true 가 아님');
	assert(committedNoGit.lastCommittedSha === null, '비-git markCommitted 에서 sha 가 null 로 허용되지 않음');

	// 6) needsRerun 규칙: status=done & committed=false → true, 커밋되면 false
	const doneUncommitted = { ...p2, status: 'done', committed: false };
	assert(needsRerun(doneUncommitted) === true, 'done & 미커밋인데 needsRerun 이 true 가 아님');
	const doneCommitted = markCommitted(doneUncommitted, 'deadbee');
	assert(needsRerun(doneCommitted) === false, 'done & 커밋됨인데 needsRerun 이 false 가 아님');

	// 7) 원자적 write 후 .tmp 잔여 파일 없음
	writeState(statePath, committed);
	assert(!existsSync(`${statePath}.tmp`), `잔여 .tmp 파일이 남음: ${statePath}.tmp`);
} catch (err) {
	failures.push(`예외 발생: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	// 임시 파일 정리
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// 정리 실패는 테스트 결과에 영향 주지 않음
	}
}

if (failures.length === 0) {
	console.log('STATE SELFTEST: PASS');
	process.exit(0);
} else {
	console.error('STATE SELFTEST: FAIL');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
