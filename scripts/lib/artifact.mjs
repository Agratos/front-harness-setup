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

export default { artifactMarker, findPhaseRecord };
