// artifact.mjs — 페이즈 산출물 **스탬프 형식** 단일 정의 (leaf 모듈: node 내장만 의존).
//
// 왜 따로 두는가: 스탬프는 쓰는 쪽(`log.mjs` 의 logDecision)과 읽는 쪽(`phase-gate.mjs` 의 계약 검사)
// 양쪽에서 쓰인다. 형식을 두 파일에 각각 적으면 반드시 어긋난다(이 저장소가 계획을 두 번 적어
// AC 가 조용히 무시됐던 것과 같은 실패다). 그래서 형식과 스캐너를 한 곳에 두고,
// 읽기/쓰기 양쪽이 여기만 참조한다. leaf 로 유지해 logDecision 이 E2E 러너를 끌고 오지 않게 한다.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 산출물 스탬프 마커. md 렌더링에는 보이지 않는 HTML 주석이라 사람이 읽는 문서를 어지럽히지 않고,
 * 파싱은 `includes` 한 번으로 끝난다(표 행 파싱보다 어긋날 여지가 없다).
 * @param {string} cycleId `step-<idx>#<rework>`
 * @param {string} phase 이 기록이 마감하는 페이즈
 */
export function artifactMarker(cycleId, phase) {
	return `<!-- harness:artifact cycleId=${cycleId} phase=${phase} -->`;
}

/**
 * 세션 지문 마커 — 이 기록을 **어느 세션이** 남겼는지(세션 분리 3단계).
 * artifactMarker 와 별도 마커인 이유: artifactMarker 는 findPhaseRecord 의 매칭 키라서
 * 필드를 추가하면 기존 기록이 전부 "없음" 으로 오판된다(하위호환 파괴). 지문은 옆에 따로 찍는다.
 * @param {string} sessionId run-phase-session 이 발급한 세션 id (env HARNESS_SESSION_ID)
 */
export function sessionMarker(sessionId) {
	return `<!-- harness:session id=${sessionId} -->`;
}

/**
 * 이번 (사이클, 페이즈) 기록의 세션 지문을 읽는다 — phase-gate 의 "구현 세션 ≠ 판정 세션" 교차 검증용.
 * @returns {{found:boolean, file:string|null, sessionId:string|null}} 지문 없는 기록은 sessionId=null
 */
export function phaseRecordSession(repoRoot, cycleId, phase) {
	const { found, file } = findPhaseRecord(repoRoot, cycleId, phase);
	if (!found) return { found: false, file: null, sessionId: null };
	try {
		const text = readFileSync(path.join(repoRoot, file), 'utf8');
		const m = /<!-- harness:session id=([^\s>]+) -->/.exec(text);
		return { found: true, file, sessionId: m ? m[1] : null };
	} catch {
		return { found: true, file, sessionId: null };
	}
}

/**
 * 이번 (사이클, 페이즈) 스탬프가 찍힌 결정 기록을 `harness/decisions/` 에서 찾는다.
 * @returns {{found:boolean, file:string|null}} file 은 repo 상대경로
 */
export function findPhaseRecord(repoRoot, cycleId, phase) {
	const dir = path.join(repoRoot, 'harness', 'decisions');
	const marker = artifactMarker(cycleId, phase);
	let files = [];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith('.md'));
	} catch {
		return { found: false, file: null }; // 디렉터리 자체가 없음 = 기록 없음
	}
	for (const f of files) {
		try {
			if (readFileSync(path.join(dir, f), 'utf8').includes(marker)) {
				return { found: true, file: path.posix.join('harness', 'decisions', f) };
			}
		} catch {
			// 읽기 실패한 파일은 증거로 세지 않는다
		}
	}
	return { found: false, file: null };
}

export default { artifactMarker, sessionMarker, findPhaseRecord, phaseRecordSession };
