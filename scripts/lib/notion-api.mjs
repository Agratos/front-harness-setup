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

// ───────────────────────── 스토리보드 이미지 업로드/첨부 (File Upload API) ─────────────────────────
// MCP 커넥터는 파일 업로드를 못 한다(§8). 그래서 eval-scenario 캡처 PNG 를 Notion 에 띄우려면
// File Upload API 로 직접 올려야 한다. 흐름(PoC 로 실증):
//   1) POST /v1/file_uploads {mode:single_part, filename, content_type} → {id, upload_url}
//   2) POST {upload_url}  multipart/form-data 'file'=PNG 바이트            → {status:'uploaded'}
//   3) image 블록 {type:'file_upload', file_upload:{id}} 으로 페이지/행에 첨부 → S3 URL 자동 렌더
// Node 18+ 글로벌 fetch/FormData/Blob 만 사용(외부 의존성 0).

/** storyboard 단계 1건 → 캡션 문자열(순수). */
export function storyboardCaption(item, index) {
	const n = String(index ?? 0).padStart(2, '0');
	const ok = item?.ok === false ? 'FAIL' : 'ok';
	return `${n} · ${item?.kind ?? '?'} — ${item?.detail ?? ''} [${ok}]`;
}

/** scenario.json 의 한 시나리오 → 업로드 항목 [{file, caption}] (순수). shotsDir 기준 절대경로. */
export function storyboardItems(scenario, shotsDir) {
	const items = [];
	if (scenario?.initialShot) items.push({ file: path.join(shotsDir, path.basename(scenario.initialShot)), caption: '00 · 초기 상태' });
	for (const [i, s] of (scenario?.storyboard ?? []).entries()) {
		if (!s?.shot) continue;
		items.push({ file: path.join(shotsDir, path.basename(s.shot)), caption: storyboardCaption(s, i + 1) });
	}
	return items;
}

/** 업로드된 [{id, caption}] → Notion image 블록 배열(순수). */
export function imageBlocks(uploaded) {
	return uploaded.map((u) => ({
		object: 'block',
		type: 'image',
		image: { type: 'file_upload', file_upload: { id: u.id }, caption: richText(u.caption ?? '') },
	}));
}

/** 첨부 멱등 마커(callout 텍스트) — 재실행 시 중복 첨부 방지에 사용(순수). */
export function storyboardMarker(id, title) {
	return `🧪 스토리보드:${id}${title ? ` — ${title}` : ''}`;
}

/** PNG 1장을 File Upload API 로 올리고 file_upload id 반환(2단계). 실패 시 throw. */
export async function uploadFile(filePath, token) {
	const filename = path.basename(filePath);
	const created = await notionFetch('POST', `${API}/file_uploads`, token, { mode: 'single_part', filename, content_type: 'image/png' });
	if (!created.ok || !created.json?.id) throw new Error(`file_uploads create 실패(${filename}): ${created.status} ${JSON.stringify(created.json)?.slice(0, 200)}`);
	const id = created.json.id;
	const uploadUrl = created.json.upload_url || `${API}/file_uploads/${id}/send`;
	const buf = readFileSync(filePath);
	const fd = new FormData();
	fd.set('file', new Blob([buf], { type: 'image/png' }), filename);
	// send 는 multipart — Content-Type 을 직접 넣지 않는다(fetch 가 boundary 와 함께 자동 설정).
	const res = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION }, body: fd });
	const json = await res.json().catch(() => null);
	if (!res.ok || json?.status !== 'uploaded') throw new Error(`file send 실패(${filename}): ${res.status} status=${json?.status}`);
	return id;
}

/** 페이지/행(pageId)에 자식 블록을 추가한다(100개 초과 시 90개씩 배치). */
async function appendChildren(pageId, token, blocks) {
	for (let i = 0; i < blocks.length; i += 90) {
		const chunk = blocks.slice(i, i + 90);
		const r = await notionFetch('PATCH', `${API}/blocks/${pageId}/children`, token, { children: chunk });
		if (!r.ok) return { ok: false, status: r.status, json: r.json };
	}
	return { ok: true };
}

/**
 * 스토리보드 캡처를 한 페이지(보통 🧪 테스트 관리 행)의 본문에 이미지로 첨부한다.
 * - 멱등: 같은 마커 callout 이 이미 있으면 skip(재실행 안전).
 * - best-effort: pageId/token/items 부족하거나 네트워크 실패 시 {ok:false, reason}.
 * @param {string} pageId 첨부 대상(행/페이지) id
 * @param {Array<{file:string, caption:string}>} items
 * @param {string} token
 * @param {{id?:string, title?:string}} [opts]
 */
export async function attachStoryboard(pageId, items, token, opts = {}) {
	if (!pageId) return { ok: false, reason: 'pageId 없음' };
	if (!token) return { ok: false, reason: 'token 없음' };
	const marker = storyboardMarker(opts.id ?? '', opts.title);
	// 멱등: 이미 첨부된 행이면 다시 올리지 않는다.
	const existing = await notionFetch('GET', `${API}/blocks/${pageId}/children?page_size=100`, token);
	if (existing.ok) {
		const dup = (existing.json?.results ?? []).some(
			(b) => b.type === 'callout' && (b.callout?.rich_text ?? []).some((r) => (r.plain_text ?? r.text?.content ?? '').startsWith(`🧪 스토리보드:${opts.id ?? ''}`)),
		);
		if (dup) return { ok: true, skipped: true, reason: 'already-attached', attached: 0 };
	}
	const uploaded = [];
	for (const it of items) {
		if (!existsSync(it.file)) continue;
		const id = await uploadFile(it.file, token);
		uploaded.push({ id, caption: it.caption });
	}
	if (uploaded.length === 0) return { ok: false, reason: '업로드할 PNG 없음' };
	const blocks = [
		{ object: 'block', type: 'callout', callout: { rich_text: richText(marker), icon: { emoji: '🧪' }, color: 'blue_background' } },
		...imageBlocks(uploaded),
	];
	const r = await appendChildren(pageId, token, blocks);
	return r.ok ? { ok: true, attached: uploaded.length } : { ok: false, reason: `children append 실패: ${r.status}`, status: r.status };
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

export default {
	flushOutbox,
	applyPayload,
	summarizeDashboard,
	richText,
	resolveToken,
	uploadFile,
	attachStoryboard,
	storyboardItems,
	storyboardCaption,
	storyboardMarker,
	imageBlocks,
};
