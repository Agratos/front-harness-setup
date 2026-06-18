// notion-api.mjs — outbox 페이로드를 **실제 Notion REST API** 로 반영(flush).
//
// notion.mjs 는 페이로드를 harness/notion-outbox/ 에 "적재"만 합니다(결정론적, 오프라인 안전).
// 이 모듈은 그 적재분을 실제 Notion 에 전송해 **라이브 반영**합니다:
//   - dashboard.reset  : (비파괴) 구조 보존 no-op — 데이터 정리는 커넥터/오케스트레이터가 수행
//   - dashboard.upsert : (비파괴) no-op — 새 허브는 DB 행 + top-3 불릿으로 표현(커넥터가 갱신)
//   - decision.comment.mirror : 페이지에 결정 결론을 댓글로 추가
//
// 토큰/페이지/네트워크가 없으면 조용히 skip 합니다(개발 루프를 막지 않음 — best-effort).
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** process.env 우선, 없으면 repoRoot/.env 에서 NAME=value 읽기. */
export function resolveToken(repoRoot, name = 'NOTION_TOKEN') {
	if (process.env[name]) return process.env[name];
	const envPath = path.join(repoRoot, '.env');
	if (!existsSync(envPath)) return null;
	try {
		const line = readFileSync(envPath, 'utf8')
			.split(/\r?\n/)
			.find((l) => l.trim().startsWith(`${name}=`));
		return line ? line.slice(line.indexOf('=') + 1).trim() : null;
	} catch {
		return null;
	}
}

/** harness/config.json 읽기({} on fail). */
function readConfig(repoRoot) {
	const p = path.join(repoRoot, 'harness', 'config.json');
	if (!existsSync(p)) return {};
	try {
		return JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return {};
	}
}

/** Notion rich_text 배열(2000자 제한 안전 절단). */
export function richText(content) {
	return [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];
}

/** 진행상황 페이로드 → 한 줄 요약 텍스트(순수 — 테스트 용이). */
export function summarizeDashboard(payload) {
	const cards = payload?.summaryCards ?? {};
	const rows = payload?.planStepsDb?.rows ?? [];
	const running = rows.find((r) => r.status === 'running');
	const overall = payload?.topCallout?.overallScore;
	const parts = [
		`▶ 진행 ${cards.doneSteps ?? 0}/${cards.totalSteps ?? rows.length}`,
		running ? `현재: ${running.label} (#${running.step})` : null,
		overall != null ? `종합 ${overall}점` : null,
		cards.blockedSteps ? `차단 ${cards.blockedSteps}` : null,
	].filter(Boolean);
	return parts.join(' · ');
}

function headers(token) {
	return { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

/** Notion REST 호출(타임아웃). {ok,status,json} 반환. */
async function notionFetch(method, url, token, body, timeoutMs = 15000) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
		let json = null;
		try {
			json = await res.json();
		} catch {
			json = null;
		}
		return { ok: res.ok, status: res.status, json };
	} catch (err) {
		return { ok: false, status: 0, json: null, error: err?.message ?? String(err) };
	} finally {
		clearTimeout(timer);
	}
}

async function addComment(pageId, token, text) {
	return notionFetch('POST', `${API}/comments`, token, { parent: { page_id: pageId }, rich_text: richText(text) });
}

/**
 * 페이로드 1건을 실제 Notion 에 반영한다.
 * @returns {Promise<{ok:boolean, [k:string]:any}>}
 */
export async function applyPayload(payload, token, defaultPageId) {
	const pageId = payload?.pageId || payload?.target?.page || defaultPageId;
	if (!pageId) return { ok: false, reason: 'pageId 없음' };

	if (payload.kind === 'dashboard.reset') {
		// 비파괴: 허브의 기본 구조(섹션·인라인 DB·뷰·Team Roster)는 절대 건드리지 않는다.
		// 과거의 clearPageChildren(전체 블록 삭제)는 구조까지 날려 제거됨. 데이터 초기화(DB 행·
		// 콜아웃·top-3 불릿)는 /run-cycle 오케스트레이터가 커넥터로 수행한다(docs/notion-hub-layout.md §7).
		return { ok: true, skipped: true, note: '비파괴 reset — 구조 보존(데이터 정리는 커넥터가 수행)' };
	}
	if (payload.kind === 'dashboard.upsert') {
		// 비파괴: 새 허브는 타임라인 문단 append 가 아니라 DB 행 + top-3 불릿으로 진행을 표현한다.
		// 그 갱신은 오케스트레이터가 커넥터로 수행하므로 여기서는 no-op.
		return { ok: true, skipped: true, note: '비파괴 upsert — 새 허브는 커넥터로 갱신' };
	}
	if (payload.kind === 'decision.comment.mirror') {
		return addComment(pageId, token, `[결정 ${payload.decisionId ?? ''}] ${payload.text ?? ''}`.trim());
	}
	return { ok: false, reason: `알 수 없는 kind: ${payload.kind}` };
}

/**
 * harness/notion-outbox/ 의 모든 페이로드를 Notion 에 flush 한다.
 * 성공한 페이로드 파일은 제거하고, 실패분은 남겨 다음에 재시도한다(best-effort).
 * useMcp=false / 토큰 없음 / 네트워크 실패 시 조용히 skip.
 * @returns {Promise<{skipped:boolean, sent?:number, failed?:number, reason?:string}>}
 */
export async function flushOutbox(repoRoot) {
	const cfg = readConfig(repoRoot);
	if (cfg.useMcp !== true) return { skipped: true, reason: 'useMcp!=true' };
	const token = resolveToken(repoRoot);
	if (!token) return { skipped: true, reason: 'NOTION_TOKEN 없음' };
	const defaultPageId = cfg.notionDashboardPageId ?? null;

	const dir = path.join(repoRoot, 'harness', 'notion-outbox');
	if (!existsSync(dir)) return { skipped: false, sent: 0, failed: 0 };
	let files = [];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith('.json'));
	} catch {
		return { skipped: false, sent: 0, failed: 0 };
	}
	// dashboard-reset 을 먼저(초기화) → 그다음 upsert/decision 순서로 처리
	files.sort((a, b) => (a.startsWith('dashboard-reset') ? -1 : b.startsWith('dashboard-reset') ? 1 : 0));

	let sent = 0;
	let failed = 0;
	for (const f of files) {
		const fp = path.join(dir, f);
		let payload;
		try {
			payload = JSON.parse(readFileSync(fp, 'utf8'));
		} catch {
			continue;
		}
		const r = await applyPayload(payload, token, defaultPageId);
		if (r.ok) {
			try {
				rmSync(fp, { force: true });
			} catch {
				/* 제거 실패는 다음 flush 에서 중복 가능 — 무시 */
			}
			sent++;
		} else {
			failed++;
		}
	}
	return { skipped: false, sent, failed };
}

export default { flushOutbox, applyPayload, summarizeDashboard, richText, resolveToken };
