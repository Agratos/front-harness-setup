#!/usr/bin/env node
// reset-project.mjs — 하네스를 복사한 뒤 "새 프로젝트"로 초기화하는 부트스트랩 스크립트.
//
// 왜 필요한가:
//   이 저장소를 폴더째 복사해 새 프로젝트를 시작하면, 이전 프로젝트의 런타임 산출물·
//   시크릿·정체성이 그대로 따라옵니다. 특히 위험한 2가지:
//     1) .env 의 실제 토큰(Figma/Notion)이 동반 → 새 프로젝트가 같은 워크스페이스에 씀.
//     2) harness/evaluations/<id>.json(예: 100점)이 남아 → 첫 merge 게이트가 평가도 안 했는데
//        그 옛 점수를 읽어 "가짜 통과"함(done-gate.loadLatestEvaluation 이 최신 평가 파일을 읽음).
//   이 스크립트는 그 잔존물을 한 번에 정리해 "복사-즉시-사용" 상태로 만듭니다.
//
// 안전 원칙:
//   - 기본은 **dry-run(미리보기)**. 실제 변경은 `--apply`(또는 `--force`)를 줘야 수행합니다.
//   - 하네스 "엔진"(scripts/·.claude/·docs/·src/ 예시 슬라이스)은 건드리지 않습니다.
//     런타임 산출물(harness/ 로그)·시크릿(.env)·제품 정체성(이름)만 초기화합니다.
//   - git 이력(.git)·브랜치는 위험도가 높아 자동으로 건드리지 않고 안내만 합니다.
//   - example-*.md / .gitkeep 등 문서적 예시·자리표시 파일은 보존합니다.
//
// Notion 초기화:
//   라이브 Notion 을 직접 비우지 않고(이 저장소의 미러 원칙: repo 1차 + outbox→MCP flush),
//   harness/notion-outbox/dashboard-reset.json 페이로드를 적재합니다. 다음 flush 때
//   오케스트레이터가 이전 대시보드(계획·요약·결정 미러)를 비웁니다.
//   대상 여부는 config.useMcp 를 따르며 --notion / --no-notion 으로 강제·억제할 수 있습니다.
//
// 사용법:
//   node scripts/reset-project.mjs                       # 미리보기 (이름=현재 폴더명)
//   node scripts/reset-project.mjs --name=my-app         # 미리보기 (이름 지정)
//   node scripts/reset-project.mjs --name=my-app --apply # 실제 적용
//   node scripts/reset-project.mjs --apply --no-notion   # Notion 리셋은 건너뛰고 적용
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resetDashboard } from './lib/notion.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const defaultRepoRoot = path.dirname(scriptsDir);

// Notion 대시보드 리셋 페이로드 파일명(확장자 제외). outbox 초기화 시 보존 대상.
const NOTION_RESET_ID = 'dashboard-reset';

/** npm 패키지명 규칙에 맞게 정규화(소문자·하이픈). 빈 값이면 'app'. */
export function slugifyName(s) {
	const out = String(s ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '')
		.slice(0, 60);
	return out || 'app';
}

/** 새 PROGRESS.md 템플릿(재개 프로토콜 유지 + 현재 상태 초기화). */
export function progressTemplate() {
	return [
		'# 하네스 진행 상태 (PROGRESS)',
		'',
		'> **재개 프로토콜** — 모든 세션은 굵직한 단계를 시작/완료할 때마다 아래 "현재 상태"를 갱신합니다 (마지막 갱신 시각 필수).',
		'> 자동 재개 루프(10분 주기)는 이 파일을 읽고 다음 두 조건이 **모두** 참일 때만 작업을 이어받습니다:',
		'> 1. 상태가 `🔵 진행 중`인 항목이 있다',
		'> 2. 그 항목의 "마지막 갱신"이 **30분 이상** 경과했다 (활성 세션과의 충돌 방지)',
		'',
		'## 현재 상태',
		'',
		'### ⚪ 미시작 — 새 프로젝트',
		'- 아직 시작 전입니다. `node scripts/init-project.mjs` → `/start-project` → `/run-cycle` 순으로 진행하세요.',
		'- **마지막 갱신**: (reset-project 로 초기화됨)',
		'',
		'## 갱신 규칙',
		'1. 단계 시작/완료 시 해당 항목의 "다음 할 일"·"마지막 갱신"을 즉시 갱신한다.',
		'2. 사용량 한도로 중단이 예상되면: 지금까지 한 일 + **바로 다음 1개 행동**을 적고 멈춘다.',
		'3. 새 세션이 이어받을 때: 이 파일 → `git log` → `harness/` 산출물 순으로 확인한 뒤 작업한다.',
		'4. 이어받은 세션은 작업 직전에 "마지막 갱신"을 자기 시각으로 먼저 갱신한다 (이중 인수 방지).',
		'',
	].join('\n');
}

/** 보존 대상(시퀀스 제외 파일과 동일 정책): example- 접두어, .gitkeep. */
function isPreserved(filename) {
	return filename.startsWith('example-') || filename === '.gitkeep';
}

/** 파일 텍스트를 읽되 실패 시 빈 문자열(존재 판정/멱등 비교용). */
function readTextSafe(p) {
	try {
		return readFileSync(p, 'utf8');
	} catch {
		return '';
	}
}

/**
 * 초기화 액션 목록을 계획한다. 읽기 I/O 로 현재 상태를 보고 "할 일"만 결정하며,
 * 쓰기는 하지 않는다(쓰기는 applyActions 가 수행). dry-run/apply 공용이며 멱등하다
 * (이미 정리된 저장소에 대해서는 빈 목록을 반환).
 * @param {string} repoRoot
 * @param {string} name 새 프로젝트명(정규화 전 입력)
 * @param {{notion?:boolean|null}} [opts] notion: true/false 면 Notion 리셋을 강제/억제, null/미지정이면 config.useMcp 따름
 * @returns {Array<{type:string, path:string, [k:string]:any}>}
 */
export function planReset(repoRoot, name, opts = {}) {
	const actions = [];
	const h = path.join(repoRoot, 'harness');

	// config.useMcp 를 (삭제 전에) 미리 읽어 Notion 리셋 여부 판단에 사용한다.
	let useMcp = false;
	const cfgPath = path.join(h, 'config.json');
	if (existsSync(cfgPath)) {
		try {
			useMcp = JSON.parse(readTextSafe(cfgPath)).useMcp === true;
		} catch {
			useMcp = false;
		}
	}

	// (1) 런타임 단일 파일 삭제: state.json / config.json / report.md
	for (const rel of ['state.json', 'config.json', 'report.md']) {
		const p = path.join(h, rel);
		if (existsSync(p)) actions.push({ type: 'delete', path: p, note: '런타임 산출물' });
	}

	// (2) cycle-log 비우기(파일은 유지, 내용만 초기화). 이미 비었으면 건너뜀(멱등).
	const cyc = path.join(h, 'cycles', 'cycle-log.ndjson');
	if (existsSync(cyc) && readTextSafe(cyc).trim() !== '') {
		actions.push({ type: 'truncate', path: cyc, note: '사이클 로그 초기화' });
	}

	// (3) decisions / evaluations / errors: example-·.gitkeep 보존, 나머지(파일·하위디렉터리) 제거
	for (const sub of ['decisions', 'evaluations', 'errors']) {
		const d = path.join(h, sub);
		if (!existsSync(d)) continue;
		let entries = [];
		try {
			entries = readdirSync(d);
		} catch {
			entries = [];
		}
		for (const f of entries) {
			if (isPreserved(f)) continue;
			actions.push({ type: 'rmrf', path: path.join(d, f), note: `${sub} 잔존물` });
		}
	}

	// (4) Notion 미러 초기화:
	//   (a) outbox 의 이전 미러 페이로드 제거(이전 프로젝트의 대시보드·결정 미러 잔존 방지).
	//       단 새로 적재할 dashboard-reset 페이로드와 example-/.gitkeep 은 보존한다.
	//   (b) 이 프로젝트가 Notion 을 썼다면(config.useMcp 또는 --notion) 새 'dashboard-reset'
	//       페이로드를 적재 → 다음 flush 때 오케스트레이터가 대시보드를 비우도록 신호.
	const outbox = path.join(h, 'notion-outbox');
	const resetPayloadName = `${NOTION_RESET_ID}.json`;
	if (existsSync(outbox)) {
		let entries = [];
		try {
			entries = readdirSync(outbox);
		} catch {
			entries = [];
		}
		for (const f of entries) {
			if (isPreserved(f) || f === resetPayloadName) continue;
			actions.push({ type: 'rmrf', path: path.join(outbox, f), note: 'notion outbox 잔존물' });
		}
	}
	const wantNotionReset = opts.notion ?? useMcp;
	if (wantNotionReset && !existsSync(path.join(outbox, resetPayloadName))) {
		actions.push({
			type: 'notion-reset',
			path: path.join(outbox, resetPayloadName),
			repoRoot,
			name: slugifyName(name),
			note: 'Notion 대시보드 초기화 페이로드 적재(다음 flush 시 적용)',
		});
	}

	// (5) PROGRESS.md 새 템플릿으로 초기화 (이미 템플릿과 동일하면 건너뜀 — 멱등)
	const progPath = path.join(h, 'PROGRESS.md');
	const tpl = progressTemplate();
	if (!existsSync(progPath) || readTextSafe(progPath) !== tpl) {
		actions.push({ type: 'write', path: progPath, content: tpl, note: 'PROGRESS 초기화' });
	}

	// (6) .env 토큰 제거: .env.example 이 있으면 그 내용으로 덮어쓰고, 없으면 .env 삭제
	const env = path.join(repoRoot, '.env');
	const example = path.join(repoRoot, '.env.example');
	if (existsSync(env)) {
		if (existsSync(example)) {
			// 이미 .env.example 과 동일하면(토큰 제거 완료) 건너뜀 — 멱등.
			if (readTextSafe(env) !== readTextSafe(example)) {
				actions.push({ type: 'overwrite-from', path: env, src: example, note: '토큰 제거(.env.example 내용으로)' });
			}
		} else {
			actions.push({ type: 'delete', path: env, note: '토큰 제거' });
		}
	}

	// (7) 제품 정체성 치환: package.json / index.html / src/app/App.tsx 의 "harness-setup" → 새 이름
	const newName = slugifyName(name);
	for (const rel of ['package.json', 'index.html', path.join('src', 'app', 'App.tsx')]) {
		const p = path.join(repoRoot, rel);
		if (!existsSync(p)) continue;
		let content = '';
		try {
			content = readFileSync(p, 'utf8');
		} catch {
			continue;
		}
		if (content.includes('harness-setup')) {
			actions.push({ type: 'replace', path: p, from: 'harness-setup', to: newName, note: `정체성 → ${newName}` });
		}
	}

	return actions;
}

/** 단일 액션을 실제 수행한다. */
export function applyAction(a) {
	switch (a.type) {
		case 'delete':
			rmSync(a.path, { force: true });
			break;
		case 'rmrf':
			rmSync(a.path, { recursive: true, force: true });
			break;
		case 'truncate':
			writeFileSync(a.path, '', 'utf8');
			break;
		case 'write':
			mkdirSync(path.dirname(a.path), { recursive: true });
			writeFileSync(a.path, a.content, 'utf8');
			break;
		case 'overwrite-from':
			copyFileSync(a.src, a.path);
			break;
		case 'replace': {
			const content = readFileSync(a.path, 'utf8');
			writeFileSync(a.path, content.split(a.from).join(a.to), 'utf8');
			break;
		}
		case 'notion-reset':
			// useMcp 판단은 planReset 이 이미 했으므로 force 로 게이트 우회하고 페이로드를 적재한다.
			resetDashboard({ repoRoot: a.repoRoot, projectName: a.name, id: NOTION_RESET_ID, force: true });
			break;
		default:
			throw new Error(`알 수 없는 액션 타입: ${a.type}`);
	}
}

/** 모든 액션 수행. {applied, errors} 반환. */
export function applyActions(actions) {
	const errors = [];
	let applied = 0;
	for (const a of actions) {
		try {
			applyAction(a);
			applied++;
		} catch (err) {
			errors.push({ path: a.path, message: err?.message ?? String(err) });
		}
	}
	return { applied, errors };
}

/** 액션을 사람이 읽는 한 줄로. */
function describeAction(a, repoRoot) {
	const rel = path.relative(repoRoot, a.path) || a.path;
	const label = {
		delete: '삭제',
		rmrf: '삭제(재귀)',
		truncate: '비우기',
		write: '재작성',
		'overwrite-from': '덮어쓰기',
		replace: `치환 "${a.from}"→"${a.to}"`,
		'notion-reset': 'Notion 리셋 적재',
	}[a.type] ?? a.type;
	return `${label.padEnd(18)} ${rel}${a.note ? `  — ${a.note}` : ''}`;
}

/** CLI 인자 파싱: --name=<v> / --name <v>, --apply|--force, --notion|--no-notion */
function parseArgs(argv) {
	let name = null;
	let apply = false;
	let notion = null; // null=config.useMcp 따름, true/false=강제/억제
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply' || a === '--force') apply = true;
		else if (a === '--notion') notion = true;
		else if (a === '--no-notion') notion = false;
		else if (a.startsWith('--name=')) name = a.slice('--name='.length);
		else if (a === '--name') name = argv[++i] ?? null;
	}
	return { name, apply, notion };
}

function main() {
	const argv = process.argv.slice(2);
	const repoRoot = defaultRepoRoot;
	const { name: nameArg, apply, notion } = parseArgs(argv);
	const name = slugifyName(nameArg ?? path.basename(repoRoot));

	const actions = planReset(repoRoot, name, { notion });

	console.log('=== reset-project ===');
	console.log(`대상 저장소: ${repoRoot}`);
	console.log(`새 프로젝트명: ${name}`);
	console.log(`모드: ${apply ? 'APPLY(실제 적용)' : 'DRY-RUN(미리보기)'}`);
	console.log('');
	if (actions.length === 0) {
		console.log('초기화할 항목이 없습니다 (이미 깨끗함).');
	} else {
		console.log(`다음 ${actions.length}개 항목을 ${apply ? '적용합니다' : '적용할 예정입니다'}:`);
		for (const a of actions) console.log(`  - ${describeAction(a, repoRoot)}`);
	}
	console.log('');

	if (!apply) {
		console.log('미리보기입니다. 실제로 적용하려면 끝에 --apply 를 붙이세요:');
		console.log(`  node scripts/reset-project.mjs --name=${name} --apply`);
		process.exit(0);
	}

	const { applied, errors } = applyActions(actions);
	console.log(`적용 완료: ${applied}/${actions.length}건`);
	if (errors.length) {
		console.log(`실패 ${errors.length}건:`);
		for (const e of errors) console.log(`  - ${e.path}: ${e.message}`);
	}

	const notionQueued = actions.some((a) => a.type === 'notion-reset');
	console.log('');
	console.log('다음 단계:');
	console.log('  1) .env 를 열어 새 토큰을 채우세요(또는 MCP 미사용이면 비워둠).');
	if (notionQueued) {
		console.log('  2) Notion 미러: harness/notion-outbox/dashboard-reset.json 이 적재됐습니다.');
		console.log('     세션에서 이 outbox 를 flush(또는 대시보드를 수동 초기화)하면 이전 내용이 비워집니다.');
		console.log('  3) node scripts/init-project.mjs  → /start-project → /run-cycle');
	} else {
		console.log('  2) node scripts/init-project.mjs  → /start-project → /run-cycle');
	}
	console.log('  (선택) 새 git 이력으로 시작하려면: rm -rf .git && git init -b main');
	console.log('         이전 step/* 브랜치 정리: git branch | grep step/ 로 확인 후 삭제');

	process.exit(errors.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
