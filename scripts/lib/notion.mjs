// notion.mjs — Notion 어댑터 (config.useMcp 게이트) (US-009)
//
// 설계: 이 어댑터는 **라이브 Notion API 를 직접 호출하지 않습니다**.
// 런타임에 Notion MCP 가 연결돼 있지 않을 수 있으므로(또는 useMcp=false),
// 페이로드를 **빌드해서 outbox(harness/notion-outbox/<id>.json)** 에 적재만 합니다.
// 실제 전송은 오케스트레이터/MCP 레이어가 이 outbox 를 flush 하며 수행합니다.
// 이 구조 덕분에 useMcp 여부와 무관하게 모든 기능이 **repo 만으로 결정적으로** 동작합니다.
//
// 게이트:
//   - useMcp=false → 모든 함수가 no-op 으로 {skipped:true} 를 반환 (outbox 미기록).
//   - useMcp=true  → 페이로드를 빌드해 outbox 에 기록하고 {skipped:false, outboxPath, payload} 반환.
//
// 함수:
//   - upsertDashboard(planSteps, scores, opts) : 계획 기반 대시보드 페이로드
//       (상단 콜아웃 + 요약 카드 + 계획단계 DB + 상세/도움말 분리) — docs/notion-dashboard.md 참조.
//   - mirrorDecisionComment(decisionId, turn, opts) : 토론 댓글 스레드 미러 페이로드.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** harness/config.json 을 읽어 useMcp 를 반환 (없으면 false). */
export function readUseMcp(repoRoot) {
	const configPath = path.join(repoRoot, 'harness', 'config.json');
	if (!existsSync(configPath)) return false;
	try {
		const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
		return cfg.useMcp === true;
	} catch {
		return false;
	}
}

/** outbox 디렉터리 경로. */
function outboxDir(repoRoot) {
	return path.join(repoRoot, 'harness', 'notion-outbox');
}

/**
 * 페이로드 1건을 outbox 에 기록한다(원자적 temp→rename).
 * @param {string} repoRoot
 * @param {string} id 파일명(확장자 제외)
 * @param {object} payload
 * @returns {string} 기록한 파일의 절대경로
 */
function writeOutbox(repoRoot, id, payload) {
	const dir = outboxDir(repoRoot);
	mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${id}.json`);
	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
	// rename = 동일 볼륨 원자적 교체 → 부분 기록 미노출 (state.mjs 와 동일 정책).
	renameSync(tmp, filePath);
	return filePath;
}

/**
 * 계획 기반 대시보드 페이로드를 빌드한다.
 * 구조(상단 콜아웃 + 요약 카드 + 계획단계 DB + 상세/도움말 분리)는
 * docs/notion-dashboard.md 의 스펙을 그대로 따른다.
 * @param {Array<string|object>} planSteps 계획 단계(라벨 또는 {label,status,...})
 * @param {object} scores done-gate/eval 의 점수 맵 또는 종합 점수 정보
 * @param {{repoRoot?:string, projectName?:string, goal?:string, helpUrl?:string, id?:string}} [opts]
 * @returns {{skipped:boolean, outboxPath?:string, payload?:object}}
 */
export function upsertDashboard(planSteps = [], scores = {}, opts = {}) {
	const repoRoot = opts.repoRoot ?? process.cwd();
	if (!readUseMcp(repoRoot)) {
		return { skipped: true };
	}

	const steps = (Array.isArray(planSteps) ? planSteps : []).map((s, idx) => {
		const base = typeof s === 'string' ? { label: s } : { ...s };
		return {
			step: idx + 1,
			label: base.label ?? `step-${idx}`,
			status: base.status ?? 'pending', // pending|running|done|blocked
			score: base.score ?? scores?.[`step-${idx}`]?.score ?? null,
			decisions: base.decisions ?? 0,
			errors: base.errors ?? 0,
			branch: base.branch ?? null,
			artifacts: base.artifacts ?? [],
		};
	});

	// 종합 평점: scores.score(또는 .total) 우선, 없으면 단계 점수 평균(있는 것만).
	const overall =
		scores?.score ??
		scores?.total ??
		(() => {
			const vals = steps.map((s) => s.score).filter((v) => typeof v === 'number');
			return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
		})();

	const payload = {
		kind: 'dashboard.upsert',
		// 멱등 키: 같은 대시보드를 매번 새로 만들지 않고 갱신(upsert)하도록 안정적 키 사용.
		idempotencyKey: opts.id ?? 'dashboard-main',
		topCallout: {
			projectName: opts.projectName ?? 'harness-setup',
			goal: opts.goal ?? 'PRD 기반 자율 개발 루프',
			overallScore: overall,
			helpUrl: opts.helpUrl ?? '(help page link — outbox flush 시 채움)',
		},
		summaryCards: {
			totalSteps: steps.length,
			doneSteps: steps.filter((s) => s.status === 'done').length,
			blockedSteps: steps.filter((s) => s.status === 'blocked').length,
			totalDecisions: steps.reduce((a, s) => a + (s.decisions ?? 0), 0),
			totalErrors: steps.reduce((a, s) => a + (s.errors ?? 0), 0),
		},
		// 계획단계 DB: 행=단계, 컬럼=상태/평점/결정수/오류/브랜치/산출물.
		planStepsDb: {
			columns: ['step', 'label', 'status', 'score', 'decisions', 'errors', 'branch', 'artifacts'],
			rows: steps,
		},
		// 상세/도움말은 별도 페이지로 분리(링크만 보관) — 본문 과밀 방지.
		detailPageRef: 'dashboard/detail',
		helpPageRef: 'dashboard/help',
	};

	const id = opts.id ?? 'dashboard-main';
	const outboxPath = writeOutbox(repoRoot, id, payload);
	return { skipped: false, outboxPath, payload };
}

/**
 * 토론 댓글(결정 스레드)을 미러링하는 페이로드를 빌드한다.
 * Notion comments API 미지원 시 토글 스레드 폴백으로 전환하도록 fallbackMode 를 명시.
 * @param {string} decisionId 결정 식별자
 * @param {number|object} turn 턴 번호 또는 {turn, author, text} 형태
 * @param {{repoRoot?:string, commentsApiSupported?:boolean, id?:string}} [opts]
 * @returns {{skipped:boolean, outboxPath?:string, payload?:object}}
 */
export function mirrorDecisionComment(decisionId, turn, opts = {}) {
	const repoRoot = opts.repoRoot ?? process.cwd();
	if (!readUseMcp(repoRoot)) {
		return { skipped: true };
	}

	const turnObj = typeof turn === 'object' && turn !== null ? turn : { turn };
	// comments API 미지원이면 토글 스레드로 폴백 (docs/notion-dashboard.md §댓글 미러).
	const fallbackMode = opts.commentsApiSupported === false ? 'toggle-thread' : 'comments-api';

	const payload = {
		kind: 'decision.comment.mirror',
		idempotencyKey: opts.id ?? `decision-${decisionId}-turn-${turnObj.turn ?? 0}`,
		decisionId,
		turn: turnObj.turn ?? 0,
		author: turnObj.author ?? 'orchestrator',
		text: turnObj.text ?? '',
		fallbackMode, // 'comments-api' | 'toggle-thread'
	};

	const id = opts.id ?? `decision-${decisionId}-turn-${turnObj.turn ?? 0}`;
	const outboxPath = writeOutbox(repoRoot, id, payload);
	return { skipped: false, outboxPath, payload };
}

/**
 * 새 프로젝트 초기화용 대시보드 리셋 페이로드를 outbox 에 적재한다.
 * 라이브 Notion 을 직접 비우지 않고(이 어댑터의 설계 원칙), flush 레이어가
 * 'dashboard-main' 페이지의 내용(계획 DB 행·요약 카드·결정 미러)을 비우고
 * 새 프로젝트 상태로 되돌리도록 지시하는 페이로드를 남긴다.
 *
 * 게이트: useMcp=false 면 no-op({skipped:true}). 단 opts.force=true 면 게이트를 우회한다
 *   (reset-project 가 config 삭제 전에 useMcp 를 이미 판단했을 때 사용).
 *
 * @param {{repoRoot?:string, projectName?:string, pageId?:string, id?:string, force?:boolean}} [opts]
 * @returns {{skipped:boolean, outboxPath?:string, payload?:object}}
 */
export function resetDashboard(opts = {}) {
	const repoRoot = opts.repoRoot ?? process.cwd();
	if (!opts.force && !readUseMcp(repoRoot)) {
		return { skipped: true };
	}
	const payload = {
		kind: 'dashboard.reset',
		// 멱등 키: 같은 대시보드 페이지를 대상으로 함(upsert 와 동일 페이지).
		idempotencyKey: 'dashboard-main',
		// 비울 실제 Notion 페이지 id (flush 레이어가 이 페이지를 비운다). null 이면 미지정.
		pageId: opts.pageId ?? null,
		action: 'archive-and-clear',
		// flush 레이어가 비울 대상: 계획 DB 행 / 요약 카드 / 결정 댓글 미러.
		clear: ['planStepsDb.rows', 'summaryCards', 'decisionComments'],
		// 콜아웃은 새 프로젝트 상태로 초기화(점수 null, 새 이름).
		resetCallout: { projectName: opts.projectName ?? null, overallScore: null, goal: null },
		note: '새 프로젝트 초기화(reset-project): 이전 대시보드 내용을 비우고 새 프로젝트 상태로 되돌린다. flush 시 적용.',
	};
	const id = opts.id ?? 'dashboard-reset';
	const outboxPath = writeOutbox(repoRoot, id, payload);
	return { skipped: false, outboxPath, payload };
}

export default { readUseMcp, upsertDashboard, mirrorDecisionComment, resetDashboard };
