#!/usr/bin/env node
// reset-project.selftest.mjs — reset-project 초기화 로직 자가검증.
//
// 실행: node scripts/reset-project.selftest.mjs
// os.tmpdir 에 가짜 저장소 구조(harness 산출물·.env·진입점 3종·example 보존 파일)를 만들고
// planReset → applyActions 를 적용한 뒤, 잔존물이 정리되고 보존 대상은 남는지 검증합니다.
// 성공 시 'RESET SELFTEST: PASS' + exit 0.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyActions, planReset, slugifyName } from './reset-project.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'reset-selftest-'));
try {
	console.log('=== reset-project selftest (임시 가짜 저장소) ===');

	// 가짜 저장소 구조 생성
	const w = (rel, content) => {
		const p = path.join(tmp, rel);
		mkdirSync(path.dirname(p), { recursive: true });
		writeFileSync(p, content, 'utf8');
	};
	w('harness/state.json', '{"status":"running"}\n');
	w('harness/config.json', '{"useGit":true,"useMcp":true}\n');
	// 이전 프로젝트의 Notion 미러 잔존 페이로드 (제거되어야 함)
	w('harness/notion-outbox/dashboard-main.json', '{"kind":"dashboard.upsert"}\n');
	w('harness/notion-outbox/decision-0001-turn-0.json', '{"kind":"decision.comment.mirror"}\n');
	w('harness/report.md', '# old report\n');
	w('harness/cycles/cycle-log.ndjson', '{"phase":"merge"}\n{"phase":"verify"}\n');
	w('harness/decisions/decision-0001.md', '# 실제 결정 1\n');
	w('harness/decisions/decision-0002.md', '# 실제 결정 2\n');
	w('harness/decisions/example-0001.md', '# 보존 예시\n'); // 보존되어야 함
	w('harness/evaluations/eval-0001.json', '{"score":100,"majorComplaints":0}\n');
	w('harness/evaluations/eval-0001.md', '# old eval\n');
	w('harness/evaluations/eval-0001/screenshot.png', 'PNGDATA'); // 하위 디렉터리 제거 검증
	w('harness/errors/verify-0001.md', '# old error\n');
	w('harness/PROGRESS.md', '# 옛 진행 상황\n많은 내용\n');
	w('.env', 'FIGMA_API_KEY=figd_SECRET\nNOTION_TOKEN=ntn_SECRET\n');
	w('.env.example', 'FIGMA_API_KEY=\nNOTION_TOKEN=\n');
	w('package.json', '{\n\t"name": "harness-setup",\n\t"version": "0.0.0"\n}\n');
	w('index.html', '<title>harness-setup</title>\n');
	w('src/app/App.tsx', 'export const App = () => <h1>harness-setup</h1>;\n');

	// 계획 + 적용
	const name = slugifyName('My New App!'); // → my-new-app
	check('slugifyName 정규화', name === 'my-new-app');
	const actions = planReset(tmp, name);
	const { applied, errors } = applyActions(actions);
	check('applyActions 오류 0', errors.length === 0);
	check('적용 건수 = 계획 건수', applied === actions.length && applied > 0);

	// 검증: 런타임 산출물 제거
	check('state.json 삭제됨', !existsSync(path.join(tmp, 'harness', 'state.json')));
	check('config.json 삭제됨', !existsSync(path.join(tmp, 'harness', 'config.json')));
	check('report.md 삭제됨', !existsSync(path.join(tmp, 'harness', 'report.md')));

	// cycle-log 는 파일은 남고 내용은 비어야 함
	const cyc = path.join(tmp, 'harness', 'cycles', 'cycle-log.ndjson');
	check('cycle-log 파일 유지', existsSync(cyc));
	check('cycle-log 내용 비워짐', readFileSync(cyc, 'utf8').trim() === '');

	// decisions: 실제 결정 제거, example 보존
	const decDir = path.join(tmp, 'harness', 'decisions');
	const decLeft = readdirSync(decDir).sort();
	check('decision-0001 제거됨', !decLeft.includes('decision-0001.md'));
	check('decision-0002 제거됨', !decLeft.includes('decision-0002.md'));
	check('example-0001 보존됨', decLeft.includes('example-0001.md'));

	// evaluations: eval 파일·하위 디렉터리 제거 (false-pass 방지 핵심)
	const evalDir = path.join(tmp, 'harness', 'evaluations');
	const evalLeft = existsSync(evalDir) ? readdirSync(evalDir) : [];
	check('eval-0001.json 제거됨(가짜 통과 방지)', !evalLeft.includes('eval-0001.json'));
	check('eval-0001/ 하위 디렉터리 제거됨', !existsSync(path.join(evalDir, 'eval-0001')));

	// errors 제거
	check('errors/verify-0001.md 제거됨', !existsSync(path.join(tmp, 'harness', 'errors', 'verify-0001.md')));

	// PROGRESS 초기화
	const prog = readFileSync(path.join(tmp, 'harness', 'PROGRESS.md'), 'utf8');
	check('PROGRESS 초기화됨(미시작 마커)', prog.includes('⚪ 미시작 — 새 프로젝트') && !prog.includes('옛 진행 상황'));

	// .env 토큰 제거(.env.example 내용으로)
	const env = readFileSync(path.join(tmp, '.env'), 'utf8');
	check('.env 토큰 제거됨', !env.includes('figd_SECRET') && !env.includes('ntn_SECRET'));

	// 정체성 치환
	check('package.json name 치환', readFileSync(path.join(tmp, 'package.json'), 'utf8').includes('"name": "my-new-app"'));
	check('index.html title 치환', readFileSync(path.join(tmp, 'index.html'), 'utf8').includes('<title>my-new-app</title>'));
	check('App.tsx h1 치환', readFileSync(path.join(tmp, 'src', 'app', 'App.tsx'), 'utf8').includes('<h1>my-new-app</h1>'));

	// Notion 초기화: 이전 미러 페이로드 제거 + dashboard-reset 적재 (useMcp=true)
	const obDir = path.join(tmp, 'harness', 'notion-outbox');
	const obLeft = existsSync(obDir) ? readdirSync(obDir).sort() : [];
	check('이전 dashboard-main 페이로드 제거됨', !obLeft.includes('dashboard-main.json'));
	check('이전 결정 미러 페이로드 제거됨', !obLeft.includes('decision-0001-turn-0.json'));
	check('dashboard-reset 페이로드 적재됨', obLeft.includes('dashboard-reset.json'));
	if (obLeft.includes('dashboard-reset.json')) {
		const rp = JSON.parse(readFileSync(path.join(obDir, 'dashboard-reset.json'), 'utf8'));
		check('dashboard-reset kind=dashboard.reset', rp.kind === 'dashboard.reset');
		check('dashboard-reset 가 새 프로젝트명 반영', rp.resetCallout && rp.resetCallout.projectName === 'my-new-app');
	}

	// 멱등성: 두 번째 실행은 계획이 완전히 비어야 함(이미 정리됨 — cycle-log·PROGRESS 도 변경 없음)
	const actions2 = planReset(tmp, name);
	check('2차 실행은 계획 0건(완전 멱등)', actions2.length === 0);
} catch (err) {
	failures.push(`예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

console.log('');
if (failures.length === 0) {
	console.log('RESET SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`RESET SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
