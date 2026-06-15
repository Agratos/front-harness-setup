// log.mjs — 투명성 로깅 헬퍼 (US-008 / US-010)
//
// logError: harness/errors/<id>.md 에 오류 1건을 기록한다.
//   id 는 결정적(deterministic) — phase 접두어 + 기존 파일 수 기반 시퀀스. Math.random/Date 미사용.
//
// logCycle: harness/cycles/cycle-log.ndjson 에 사이클 진행 1줄을 append 한다.
//   loop.mjs 의 appendCycleLog / cycleEntry 와 동일 형식을 사용해 포맷 충돌 방지.
//
// logDecision (US-010): harness/decisions/<id>.md 에 협의 결정 1건을 기록한다.
//   스키마(AC6): 안건 / 제기자 / 주장:이유[] / 관점·반박 / 타협 / 결론+근거(why) / 영향 / 연결단계.
//   id 는 결정적 — 'decision-' 접두어 + 기존 파일 수 기반 시퀀스. Math.random/Date 미사용.
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mirrorDecisionComment } from './notion.mjs';

/**
 * 오류 로그를 harness/errors/<id>.md 에 기록한다.
 *
 * id 생성 규칙 (결정적, 단조):
 *   - harness/errors/ 의 현재 .md 파일 수(example- 제외)를 세어 seq 결정.
 *   - id = `${phase}-${zeroPad(seq, 4)}` (예: `verify-0001`)
 *   - 파일명 = `${id}.md`
 *
 * @param {string} repoRoot 저장소 루트 절대경로
 * @param {{
 *   phase: string,       // 현재 페이즈(예: 'verify', 'implement')
 *   where: string,       // 위치 — 테스트/명령 위치 (파일:라인 또는 명령어)
 *   message: string,     // 오류 메시지 원문 (stderr/stdout tail)
 *   cause?: string,      // 근본 원인 분석 (없으면 'TBD')
 *   fixSummary?: string, // 수정 diff 요약 (없으면 'TBD')
 * }} entry
 * @returns {string} 생성된 파일의 절대경로
 */
export function logError(repoRoot, { phase, where, message, cause, fixSummary }) {
	const dir = path.join(repoRoot, 'harness', 'errors');
	mkdirSync(dir, { recursive: true });

	// 기존 .md 파일 수 세기 (example- 접두어 파일 제외 — 데모 항목은 시퀀스에 미포함)
	let existingCount = 0;
	try {
		existingCount = readdirSync(dir).filter(
			(f) => f.endsWith('.md') && !f.startsWith('example-') && f !== '.gitkeep',
		).length;
	} catch {
		existingCount = 0;
	}

	const seq = existingCount + 1;
	const id = `${phase}-${String(seq).padStart(4, '0')}`;
	const filePath = path.join(dir, `${id}.md`);

	const phaseVal = phase ?? 'unknown';
	const whereVal = where ?? '';
	const messageVal = message ?? '';
	const causeVal = cause ?? 'TBD';
	const fixSummaryVal = fixSummary ?? 'TBD';

	// 문서화된 스키마 필드: 위치 / 오류메시지 / 원인 / 수정diff요약
	const content = [
		`# 오류 로그 — ${id}`,
		``,
		`| 키 | 값 |`,
		`| --- | --- |`,
		`| phaseSeq | (see state.json) |`,
		`| phase | ${phaseVal} |`,
		`| 위치 | ${whereVal} |`,
		`| 오류메시지 | ${messageVal.replace(/\n/g, ' ↵ ')} |`,
		`| 원인 | ${causeVal} |`,
		`| 수정diff요약 | ${fixSummaryVal} |`,
		``,
		`## 상세`,
		``,
		`### 위치`,
		whereVal,
		``,
		`### 오류 메시지`,
		`\`\`\``,
		messageVal,
		`\`\`\``,
		``,
		`### 원인`,
		causeVal,
		``,
		`### 수정 diff 요약`,
		fixSummaryVal,
		``,
	].join('\n');

	writeFileSync(filePath, content, 'utf8');
	return filePath;
}

/**
 * 사이클 진행 1줄을 harness/cycles/cycle-log.ndjson 에 append 한다.
 *
 * loop.mjs 의 appendCycleLog / cycleEntry 와 동일 키 구조를 사용한다:
 *   { checkpointToken, phaseSeq, stepIdx, stepLabel, phase, outcome, detail }
 *
 * log.mjs 에서 직접 호출할 때는 checkpointToken / stepIdx / stepLabel 이
 * 없을 수 있으므로, 없는 값은 null 로 채운다.
 *
 * @param {string} repoRoot 저장소 루트 절대경로
 * @param {{
 *   step?: string|number,  // 단계 식별자 (stepIdx 로 사용)
 *   phase: string,         // 페이즈 이름
 *   note?: string,         // 진행 요약 (detail 필드)
 *   phaseSeq?: number,
 *   checkpointToken?: string,
 *   stepLabel?: string,
 *   outcome?: string,
 * }} entry
 * @returns {string} cycle-log.ndjson 의 절대경로
 */
export function logCycle(repoRoot, { step, phase, note, phaseSeq, checkpointToken, stepLabel, outcome } = {}) {
	const dir = path.join(repoRoot, 'harness', 'cycles');
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'cycle-log.ndjson');

	// loop.mjs cycleEntry 형식과 동일한 키 사용
	const entry = {
		checkpointToken: checkpointToken ?? null,
		phaseSeq: phaseSeq ?? null,
		stepIdx: step !== undefined ? step : null,
		stepLabel: stepLabel ?? null,
		phase: phase ?? 'unknown',
		outcome: outcome ?? 'log',
		detail: note ?? null,
	};

	appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
	return file;
}

/**
 * 협의(토론) 결정 1건을 harness/decisions/<id>.md 에 기록한다 (US-010, AC6).
 *
 * 문서화된 결정 스키마(AC6):
 *   안건 / 제기자 / 주장:이유[] / 관점·반박 / 타협 / 결론+근거(why) / 영향 / 연결단계
 *
 * id 생성 규칙 (결정적, 단조):
 *   - harness/decisions/ 의 현재 .md 파일 수(example- / -roster / -arch 보조파일 제외)를 세어 seq 결정.
 *   - id = `decision-${zeroPad(seq, 4)}` (예: `decision-0001`)
 *   - 파일명 = `${id}.md`
 *   - Math.random / Date 미사용 → 동일 디렉터리 상태면 항상 같은 id.
 *
 * @param {string} repoRoot 저장소 루트 절대경로
 * @param {{
 *   topic: string,                                   // 안건
 *   raisedBy: string,                                // 제기자(에이전트)
 *   claims?: Array<{agent:string, claim:string, reason:string}>, // 주장:이유[]
 *   rebuttals?: string | string[],                   // 관점·반박
 *   compromise?: string,                             // 타협
 *   conclusion?: string,                             // 결론
 *   why?: string,                                    // 결론 근거(why)
 *   impact?: string,                                 // 영향 범위
 *   linkedStep?: string,                             // 연결 단계(step 라벨/id)
 * }} entry
 * @returns {string} 생성된 파일의 절대경로
 */
export function logDecision(repoRoot, { topic, raisedBy, claims, rebuttals, compromise, conclusion, why, impact, linkedStep } = {}) {
	const dir = path.join(repoRoot, 'harness', 'decisions');
	mkdirSync(dir, { recursive: true });

	// 기존 decision-*.md 파일 수 세기.
	// example-/-roster/-arch 등 보조·데모 파일은 시퀀스에서 제외(logError 와 동일 정책).
	let existingCount = 0;
	try {
		existingCount = readdirSync(dir).filter(
			(f) =>
				f.endsWith('.md') &&
				!f.startsWith('example-') &&
				!f.endsWith('-roster.md') &&
				!f.endsWith('-arch.md') &&
				f !== '.gitkeep',
		).length;
	} catch {
		existingCount = 0;
	}

	const seq = existingCount + 1;
	const id = `decision-${String(seq).padStart(4, '0')}`;
	const filePath = path.join(dir, `${id}.md`);

	const topicVal = topic ?? '(미지정)';
	const raisedByVal = raisedBy ?? '(미지정)';
	const claimsArr = Array.isArray(claims) ? claims : [];
	const rebuttalsArr = Array.isArray(rebuttals) ? rebuttals : rebuttals ? [rebuttals] : [];
	const compromiseVal = compromise ?? '(타협 불필요 — 합의)';
	const conclusionVal = conclusion ?? 'TBD';
	const whyVal = why ?? 'TBD';
	const impactVal = impact ?? 'TBD';
	const linkedStepVal = linkedStep ?? '(미연결)';

	// 주장:이유[] 표 행
	const claimRows = claimsArr.length
		? claimsArr
				.map((c) => `| ${c.agent ?? '?'} | ${oneLine(c.claim)} | ${oneLine(c.reason)} |`)
				.join('\n')
		: '| — | (주장 없음) | — |';

	// 관점·반박 목록
	const rebuttalLines = rebuttalsArr.length
		? rebuttalsArr.map((r) => `- ${oneLine(String(r))}`).join('\n')
		: '- (충돌 없음 — 반박 라운드 미발생)';

	const content = [
		`# 협의 결정 로그 — ${id}`,
		``,
		`| 키 | 값 |`,
		`| --- | --- |`,
		`| 안건 | ${oneLine(topicVal)} |`,
		`| 제기자 | ${oneLine(raisedByVal)} |`,
		`| 타협 | ${oneLine(compromiseVal)} |`,
		`| 결론 | ${oneLine(conclusionVal)} |`,
		`| 영향 | ${oneLine(impactVal)} |`,
		`| 연결단계 | ${oneLine(linkedStepVal)} |`,
		``,
		`## 안건`,
		``,
		topicVal,
		``,
		`## 제기자`,
		``,
		raisedByVal,
		``,
		`## 주장 : 이유`,
		``,
		`| 에이전트 | 주장(claim) | 이유(reason) |`,
		`| --- | --- | --- |`,
		claimRows,
		``,
		`## 관점 · 반박`,
		``,
		rebuttalLines,
		``,
		`## 타협`,
		``,
		compromiseVal,
		``,
		`## 결론 + 근거(why)`,
		``,
		`- **결론**: ${conclusionVal}`,
		`- **근거(why)**: ${whyVal}`,
		``,
		`## 영향`,
		``,
		impactVal,
		``,
		`## 연결 단계`,
		``,
		linkedStepVal,
		``,
	].join('\n');

	writeFileSync(filePath, content, 'utf8');

	// Notion 자동 미러: 결정 결론을 댓글 스레드로 미러(useMcp 게이트 → no-op 가능). 실패는 기록에 영향 없음.
	try {
		mirrorDecisionComment(id, { turn: 0, author: raisedByVal, text: conclusionVal }, { repoRoot, id: `${id}-turn-0` });
	} catch {
		/* notion 미러 실패 무시 */
	}

	return filePath;
}

/** 표 셀 안전화: 개행 → 화살표, 파이프 이스케이프 (markdown 표 깨짐 방지). */
function oneLine(s) {
	return String(s ?? '')
		.replace(/\r?\n/g, ' ↵ ')
		.replace(/\|/g, '\\|');
}
