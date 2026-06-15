#!/usr/bin/env node
// copy-project.mjs — 이 하네스 저장소를 새 위치로 복사해 새 프로젝트를 만든다.
//
// 흐름: <dest>/<name> 으로 저장소를 복사(빌드 산출물·.git·시크릿 제외)한 뒤,
//   복사본 안에서 reset-project(=clear-project 의 실체)를 --apply 로 실행해 초기화한다.
//   즉 "복사 → 초기화" 를 한 번에. Notion 라이브 flush 는 MCP 가 필요하므로 오케스트레이터
//   (/copy-project 커맨드)가 마무리하며, 이 스크립트는 결정적 부분(복사+로컬 초기화)만 담당한다.
//
// 미리보기/승인이 없는 이유:
//   복사는 **새 위치에 생성**하는 작업이라 기존 것을 파괴하지 않는다. 따라서 dry-run 승인 없이
//   바로 진행한다. 진짜 안전장치는 다음 두 가지(거부 조건)로 충분하다:
//     - 대상이 이미 존재하고 비어있지 않으면 거부(덮어쓰기 사고 방지).
//     - 대상이 소스(이 저장소) 내부 경로면 거부(자기 안에 자기 복사 방지).
//   또한 .env(토큰)·node_modules·.git·dist·.yarn 캐시·*.tsbuildinfo·.omc 는 복사하지 않는다.
//
// 사용법:
//   node scripts/copy-project.mjs --dest=<부모경로> --name=<이름>            # 복사 + 초기화
//   node scripts/copy-project.mjs --dest=../ --name=my-app --no-clear        # 복사만(초기화 생략)
//   node scripts/copy-project.mjs --dest=../ --name=my-app --no-notion       # 초기화 시 Notion 리셋 생략
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { slugifyName } from './reset-project.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const defaultRepoRoot = path.dirname(scriptsDir);

// 복사 제외 대상(상대경로 기준). .env 는 토큰 유출 방지를 위해 제외(.env.example 만 복사됨).
function isExcluded(repoRoot, src) {
	const rel = path.relative(repoRoot, src);
	if (rel === '' || rel === '.') return false; // 루트 자신은 포함
	const parts = rel.split(path.sep);
	if (parts.includes('node_modules')) return true;
	if (parts[0] === '.git') return true;
	if (parts[0] === 'dist') return true;
	if (parts[0] === '.omc') return true;
	if (parts[0] === '.yarn' && (parts[1] === 'cache' || parts[1] === 'unplugged' || parts[1] === 'install-state.gz')) return true;
	if (rel === '.env') return true;
	if (src.endsWith('.tsbuildinfo')) return true;
	return false;
}

/** cpSync 용 filter(true=복사). makeCopyFilter(repoRoot)(src,dest) 형태. */
export function makeCopyFilter(repoRoot) {
	return (src) => !isExcluded(repoRoot, src);
}

function safeReaddir(p) {
	try {
		return readdirSync(p);
	} catch {
		return [];
	}
}

/** 복사 계획을 계산한다(순수). target 절대경로와 검증 결과를 반환. */
export function planCopy(repoRoot, dest, nameInput) {
	const name = slugifyName(nameInput);
	const target = path.resolve(dest ?? '.', name);
	const targetInsideRepo = target === repoRoot || target.startsWith(repoRoot + path.sep);
	const targetExistsNonEmpty = existsSync(target) && safeReaddir(target).length > 0;
	return { name, target, targetInsideRepo, targetExistsNonEmpty };
}

/** 저장소를 target 으로 복사한다(제외 필터 적용). */
export function doCopy(repoRoot, target) {
	mkdirSync(path.dirname(target), { recursive: true });
	cpSync(repoRoot, target, { recursive: true, filter: makeCopyFilter(repoRoot) });
}

/** 복사본 안에서 reset-project 를 --apply 로 실행(로컬 정리 = "빈 껍데기"). */
function runResetInCopy(target, name) {
	const resetScript = path.join(target, 'scripts', 'reset-project.mjs');
	if (!existsSync(resetScript)) return { ok: false, note: 'reset-project.mjs 없음(복사 실패?)' };
	// copy 는 현재 프로젝트에 종속된 산출물·토큰·정체성을 비운 "빈 껍데기" 로만 가져간다.
	// Notion 은 건드리지 않는다(--no-notion). 새 프로젝트의 Notion 대시보드 초기화·접속 확인은
	// /start-project(연동 확인 단계)에서 사용자가 준 URL 로 수행한다.
	const args = [resetScript, `--name=${name}`, '--apply', '--no-notion'];
	try {
		execFileSync('node', args, { cwd: target, stdio: 'inherit' });
		return { ok: true, note: 'reset --apply --no-notion 완료 (빈 껍데기)' };
	} catch (err) {
		return { ok: false, note: `reset 실패 exit ${err.status ?? 1}` };
	}
}

/** CLI 인자: --dest=<v>/--dest <v>, --name=<v>/--name <v>, --no-clear */
function parseArgs(argv) {
	let dest = null;
	let name = null;
	let clear = true;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--no-clear') clear = false;
		else if (a.startsWith('--dest=')) dest = a.slice('--dest='.length);
		else if (a === '--dest') dest = argv[++i] ?? null;
		else if (a.startsWith('--name=')) name = a.slice('--name='.length);
		else if (a === '--name') name = argv[++i] ?? null;
	}
	return { dest, name, clear };
}

function main() {
	const argv = process.argv.slice(2);
	const repoRoot = defaultRepoRoot;
	const { dest, name: nameArg, clear } = parseArgs(argv);

	if (!dest) {
		console.error('[copy-project] --dest=<부모경로> 가 필요합니다. 예: --dest=../ --name=my-app');
		process.exit(2);
	}
	if (!nameArg) {
		console.error('[copy-project] --name=<프로젝트명> 이 필요합니다.');
		process.exit(2);
	}

	const { name, target, targetInsideRepo, targetExistsNonEmpty } = planCopy(repoRoot, dest, nameArg);

	console.log('=== copy-project ===');
	console.log(`소스(이 저장소): ${repoRoot}`);
	console.log(`대상(새 프로젝트): ${target}`);
	console.log(`프로젝트명: ${name}`);
	console.log(`복사 후 초기화(clear): ${clear ? '예' : '아니오(--no-clear)'}`);
	console.log('제외: node_modules / .git / dist / .yarn(cache·unplugged·install-state) / .env / *.tsbuildinfo / .omc');
	console.log('');

	// 안전장치(거부 조건) — 미리보기 대신 이걸로 사고를 막는다.
	if (targetInsideRepo) {
		console.error('[copy-project] 거부: 대상이 소스 저장소 내부 경로입니다. 저장소 밖 경로를 지정하세요.');
		process.exit(1);
	}
	if (targetExistsNonEmpty) {
		console.error(`[copy-project] 거부: 대상이 이미 존재하고 비어있지 않습니다 — ${target}`);
		process.exit(1);
	}

	// 복사 수행 (미리보기/승인 없이 바로 진행 — 새 위치 생성이라 비파괴적)
	doCopy(repoRoot, target);
	console.log(`복사 완료 → ${target}`);

	// 복사본 초기화(clear) — 빈 껍데기화. Notion 은 건드리지 않음(--no-notion).
	if (clear) {
		console.log('');
		console.log('복사본 빈 껍데기화(reset-project --apply --no-notion) 실행:');
		const r = runResetInCopy(target, name);
		console.log(`초기화: ${r.ok ? 'OK' : 'FAIL'} — ${r.note}`);
		if (!r.ok) process.exit(1);
	}

	console.log('');
	console.log('다음 단계:');
	console.log(`  1) cd "${target}"`);
	console.log('  2) yarn install');
	console.log('  3) .env 에 새 토큰 입력(또는 MCP 미사용이면 비워둠)');
	console.log('  4) /start-project — git/Notion 주소를 넣어 접속 확인 + Notion 대시보드 초기화 후 인터뷰');
	console.log('  5) /run-cycle');
	process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
