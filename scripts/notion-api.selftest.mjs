#!/usr/bin/env node
// notion-api.selftest.mjs — Notion flush 의 순수 로직 자가검증.
//
// 실제 네트워크 호출(fetch)은 테스트하지 않고, 네트워크가 필요 없는 분기만 검증합니다:
//   - summarizeDashboard / richText 빌더
//   - applyPayload 의 조기 반환(pageId 없음 / 알 수 없는 kind) — fetch 미발생
//   - flushOutbox 의 skip 게이트(useMcp!=true) 와 빈 outbox 처리(파일 0건 → 네트워크 미발생)
// 성공 시 'NOTION-API SELFTEST: PASS' + exit 0.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPayload, flushOutbox, richText, summarizeDashboard } from './lib/notion-api.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

console.log('=== notion-api selftest (순수 로직 — 네트워크 미사용) ===');

// (1) richText
const rt = richText('hello');
check('richText 구조', Array.isArray(rt) && rt[0].text.content === 'hello');
check('richText 2000자 절단', richText('x'.repeat(5000))[0].text.content.length <= 1900);

// (2) summarizeDashboard
const summary = summarizeDashboard({
	summaryCards: { doneSteps: 1, totalSteps: 3, blockedSteps: 0 },
	planStepsDb: { rows: [{ step: 2, label: '02-dashboard', status: 'running' }] },
	topCallout: { overallScore: 92 },
});
check('summarizeDashboard 진행 포함', summary.includes('진행 1/3'));
check('summarizeDashboard 현재 step 포함', summary.includes('02-dashboard'));
check('summarizeDashboard 종합점수 포함', summary.includes('92점'));

// (3) applyPayload 조기 반환 (fetch 미발생)
const r1 = await applyPayload({ kind: 'dashboard.upsert' }, 'tok', null);
check('applyPayload: pageId 없으면 ok=false', r1.ok === false && /pageId/.test(r1.reason));
const r2 = await applyPayload({ kind: 'unknown.kind' }, 'tok', 'page-123');
check('applyPayload: 알 수 없는 kind → ok=false', r2.ok === false && /kind/.test(r2.reason));

// (4) flushOutbox skip 게이트
const tmp1 = mkdtempSync(path.join(os.tmpdir(), 'notionapi-skip-'));
try {
	mkdirSync(path.join(tmp1, 'harness'), { recursive: true });
	writeFileSync(path.join(tmp1, 'harness', 'config.json'), JSON.stringify({ useMcp: false }) + '\n', 'utf8');
	const fr = await flushOutbox(tmp1);
	check('flushOutbox: useMcp=false → skipped', fr.skipped === true);
} finally {
	rmSync(tmp1, { recursive: true, force: true });
}

// (5) flushOutbox 빈 outbox (useMcp=true, 파일 0건 → 네트워크 미발생)
const tmp2 = mkdtempSync(path.join(os.tmpdir(), 'notionapi-empty-'));
try {
	mkdirSync(path.join(tmp2, 'harness'), { recursive: true });
	// 토큰은 .env 로만 제공(process.env 영향 회피는 불가하나, outbox 가 비어 네트워크 호출 없음)
	writeFileSync(path.join(tmp2, 'harness', 'config.json'), JSON.stringify({ useMcp: true, notionDashboardPageId: null }) + '\n', 'utf8');
	writeFileSync(path.join(tmp2, '.env'), 'NOTION_TOKEN=test-token\n', 'utf8');
	const fr = await flushOutbox(tmp2);
	check('flushOutbox: outbox 비어있으면 sent=0 failed=0 (네트워크 미발생)', fr.skipped === false && fr.sent === 0 && fr.failed === 0);
} finally {
	rmSync(tmp2, { recursive: true, force: true });
}

console.log('');
if (failures.length === 0) {
	console.log('NOTION-API SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`NOTION-API SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
