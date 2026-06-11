#!/usr/bin/env node
// eval.selftest.mjs — US-009 자가검증 (Playwright 불필요, 결정적)
//
// 실행: node scripts/eval.selftest.mjs
// 검증 3종:
//   [A] TEARDOWN: 사소한 node http 서버를 테스트 포트에 띄우고 teardown 루틴 실행 →
//       포트가 free 가 되고 orphan child(서버 프로세스)가 남지 않음을 단언.
//   [B] RUBRIC: 주입 관찰값 → 기대 점수 산출(결정적). major 불만 규칙도 확인.
//   [C] NOTION: useMcp=false 인 임시 repo 에서 upsertDashboard/mirrorDecisionComment 가
//       {skipped:true} no-op 임을 단언. useMcp=true 면 outbox 기록을 단언.
// 성공 시 'EVAL SELFTEST: PASS' + exit 0. 임시 자원은 모두 정리.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyInjectedScore, scoreObservations } from './lib/rubric.mjs';
import { isPortInUse, teardownDevServer } from './lib/teardown.mjs';
import { mirrorDecisionComment, upsertDashboard } from './lib/notion.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

const TEST_PORT = 5199;

/** 사소한 http 서버를 별도 node 프로세스(child)로 띄운다 → teardown 대상. */
function startTrivialServer(port) {
	const code = `const http=require('node:http');const s=http.createServer((q,r)=>{r.end('ok')});s.listen(${port},'127.0.0.1');`;
	const isWin = process.platform === 'win32';
	const child = spawn(process.execPath, ['-e', code], {
		detached: !isWin,
		stdio: 'ignore',
		windowsHide: true,
	});
	child.unref?.();
	return child;
}

function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** 포트가 점유될 때까지 폴링(서버 기동 대기). */
async function waitInUse(port, timeoutMs = 5000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await isPortInUse(port, 400)) return true;
		await delay(150);
	}
	return false;
}

async function main() {
	console.log('=== eval selftest (US-009) ===');

	// ───────────────────────── [A] TEARDOWN ─────────────────────────
	console.log('[A] TEARDOWN — 사소한 http 서버 → kill → 포트 free 검증');
	const child = startTrivialServer(TEST_PORT);
	const pid = child.pid;
	const cameUp = await waitInUse(TEST_PORT);
	check('[A] 테스트 서버가 포트를 점유함(기동 확인)', cameUp);

	const td = await teardownDevServer({ pid, port: TEST_PORT, child });
	check('[A] killProcessTree 가 killed=true 보고', td.killed.killed === true);
	check('[A] teardown 후 portFree=true', td.portFree === true);

	// 추가 단언: 직접 포트 재확인 + child 종료 확인
	const stillInUse = await isPortInUse(TEST_PORT, 500);
	check('[A] 포트 재확인 — 점유 해제됨(orphan 없음)', stillInUse === false);
	// child 가 죽었는지: kill(pid,0) 이 throw(=프로세스 없음) 해야 함.
	let childGone = false;
	try {
		process.kill(pid, 0);
		childGone = false; // 아직 살아있음
	} catch {
		childGone = true; // ESRCH → 죽음
	}
	check('[A] orphan child 미잔존(process.kill(pid,0) → ESRCH)', childGone);

	// ───────────────────────── [B] RUBRIC ─────────────────────────
	console.log('[B] RUBRIC — 주입 관찰값 → 기대 점수');

	// 완벽 관찰 → 모든 항목 통과 → 종합 100, major 0
	const perfectObs = {
		bodyNonEmpty: true,
		titleMatches: true,
		headingPresent: true,
		consoleErrors: 0,
		serverReady: true,
		layoutStable: true,
		hasViewportMeta: true,
		appMounted: true,
		runtimeErrors: 0,
		navigable: true,
		gatesGreen: true,
		screenshotOk: true,
		observable: true,
	};
	const perfect = scoreObservations(perfectObs);
	check('[B] 완벽 관찰 → 종합 100', perfect.score === 100);
	check('[B] 완벽 관찰 → major 불만 0', perfect.majorComplaints === 0);
	check('[B] 완벽 관찰 → 불만 0건', perfect.complaints.length === 0);

	// heading 누락(major) → 종합 하락 + major 1 (ui.heading 배점 30, dimWeight 0.25 → 100-30*0.25=92.5→93 근방)
	const noHeading = scoreObservations({ ...perfectObs, headingPresent: false });
	// UI 차원: 100-30=70. 종합=0.25*70 + 0.20*100 + 0.35*100 + 0.20*100 = 17.5+20+35+20=92.5 → round 93
	check('[B] heading 누락 → 종합 93', noHeading.score === 93);
	check('[B] heading 누락 → major 1', noHeading.majorComplaints === 1);
	check('[B] heading 누락 → 불만에 ui.heading 포함', noHeading.complaints.some((c) => c.item === 'ui.heading' && c.severity === 'major'));

	// minor 만 실패(title) → 종합은 깎이되 major 0
	const noTitle = scoreObservations({ ...perfectObs, titleMatches: false });
	// UI: 100-20=80 → 종합=0.25*80+75=95
	check('[B] title(minor) 누락 → 종합 95', noTitle.score === 95);
	check('[B] title(minor) 누락 → major 0', noTitle.majorComplaints === 0);

	// 주입 오버라이드: 관찰과 무관하게 score/major 덮어쓰기
	const injected = applyInjectedScore(scoreObservations(perfectObs), { score: 40, majorComplaints: 2 });
	check('[B] 주입 score=40 적용', injected.score === 40);
	check('[B] 주입 major=2 적용', injected.majorComplaints === 2);
	check('[B] 주입 시 injected=true 표시', injected.injected === true);

	// ───────────────────────── [C] NOTION ─────────────────────────
	console.log('[C] NOTION — useMcp 게이트');
	const tmpRepo = mkdtempSync(path.join(os.tmpdir(), 'eval-notion-'));
	try {
		// useMcp=false 시드
		const harnessDir = path.join(tmpRepo, 'harness');
		mkdirSync(harnessDir, { recursive: true });
		writeFileSync(path.join(harnessDir, 'config.json'), JSON.stringify({ useMcp: false }, null, 2), 'utf8');

		const dashOff = upsertDashboard(['step A', 'step B'], { score: 90 }, { repoRoot: tmpRepo });
		check('[C] useMcp=false → upsertDashboard {skipped:true}', dashOff.skipped === true);
		const commentOff = mirrorDecisionComment('d-1', 1, { repoRoot: tmpRepo });
		check('[C] useMcp=false → mirrorDecisionComment {skipped:true}', commentOff.skipped === true);
		check('[C] useMcp=false → outbox 미생성', !existsSync(path.join(harnessDir, 'notion-outbox')));

		// useMcp=true 로 전환 → outbox 기록
		writeFileSync(path.join(harnessDir, 'config.json'), JSON.stringify({ useMcp: true }, null, 2), 'utf8');
		const dashOn = upsertDashboard(['step A', 'step B'], { score: 90 }, { repoRoot: tmpRepo, id: 'dash-test' });
		check('[C] useMcp=true → upsertDashboard skipped=false', dashOn.skipped === false);
		check('[C] useMcp=true → outbox 파일 생성', dashOn.outboxPath && existsSync(dashOn.outboxPath));
		check('[C] useMcp=true → payload.kind=dashboard.upsert', dashOn.payload?.kind === 'dashboard.upsert');
		check('[C] useMcp=true → planStepsDb 컬럼에 status/score/branch 포함',
			['status', 'score', 'branch'].every((c) => dashOn.payload?.planStepsDb?.columns?.includes(c)));

		const commentOn = mirrorDecisionComment('d-1', { turn: 2, text: 'hi' }, { repoRoot: tmpRepo, commentsApiSupported: false });
		check('[C] useMcp=true → mirrorDecisionComment skipped=false', commentOn.skipped === false);
		check('[C] comments API 미지원 → fallbackMode=toggle-thread', commentOn.payload?.fallbackMode === 'toggle-thread');
	} finally {
		try {
			rmSync(tmpRepo, { recursive: true, force: true });
		} catch {
			/* 정리 실패 무시 */
		}
	}

	console.log('');
	if (failures.length === 0) {
		console.log('EVAL SELFTEST: PASS');
		process.exit(0);
	} else {
		console.log(`EVAL SELFTEST: FAIL (${failures.length}개 실패)`);
		for (const f of failures) console.log(`  - ${f}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.log(`EVAL SELFTEST: FAIL (예외)`);
	console.log(err?.stack ?? String(err));
	process.exit(1);
});
