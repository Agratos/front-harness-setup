#!/usr/bin/env node
// git-flow.mjs — git-flow 오케스트레이션 (Step US-006)
// 서브커맨드:
//   seed-main             main 에 커밋이 없으면(unborn) 초기 시드 커밋 생성 (멱등)
//   start-step <nn> <slug> main 에서 step/<nn>-<slug> 브랜치 생성·체크아웃
//   merge-step <nn> <slug> done-gate 통과 시에만 step/<nn>-<slug> 를 main 에 병합
// 공통: harness/config.json 의 skipGitFlow(=!useGit) 가 true 면 모든 명령은 no-op.
//
// 직접 푸시 차단: step 작업은 반드시 start-step/merge-step 경로를 통해야 하며,
//   seed-main 외에는 main 에서 직접 커밋하는 것을 assertNotDirectMainWork() 로 거부합니다.
//   merge-step 이 seed 이후 main 에 쓰기를 하는 유일한 경로입니다.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const harnessDir = path.join(repoRoot, 'harness');
const configPath = path.join(harnessDir, 'config.json');

/** git 명령 실행 (출력 문자열 반환, trim) */
function git(args, opts = {}) {
	return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', ...opts }).trim();
}

/** 실패해도 throw 하지 않는 git 실행. {ok, out, code} 반환 */
function gitSafe(args, opts = {}) {
	try {
		const out = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', ...opts });
		return { ok: true, out: out.trim(), code: 0 };
	} catch (err) {
		return { ok: false, out: (err.stdout || '').toString().trim(), code: err.status ?? 1 };
	}
}

function log(msg) {
	console.log(`[git-flow] ${msg}`);
}

function fail(msg, code = 1) {
	console.error(`[git-flow] ${msg}`);
	process.exit(code);
}

/** harness/config.json 읽기 (없거나 깨지면 {}) */
function readConfig() {
	if (!existsSync(configPath)) return {};
	try {
		return JSON.parse(readFileSync(configPath, 'utf8'));
	} catch {
		return {};
	}
}

/**
 * 공통 가드: git-flow 우회 여부.
 * skipGitFlow=true (= useGit=false) 면 true 반환 → 호출부에서 no-op 처리.
 */
function shouldSkipGitFlow() {
	const config = readConfig();
	if (config.skipGitFlow === true) return true;
	if (config.useGit === false) return true;
	return false;
}

/** 현재 체크아웃된 브랜치 이름 (unborn 이면 symbolic-ref 로 추정) */
function currentBranch() {
	const head = gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']);
	if (head.ok && head.out && head.out !== 'HEAD') return head.out;
	// unborn 브랜치: HEAD 가 가리키는 ref 이름
	const sym = gitSafe(['symbolic-ref', '--short', 'HEAD']);
	return sym.ok ? sym.out : '';
}

/** main 에 커밋이 하나라도 있는가 (seeded 여부) */
function mainHasCommits() {
	const r = gitSafe(['rev-parse', '--verify', '--quiet', 'refs/heads/main']);
	return r.ok && !!r.out;
}

/** 임의 브랜치 존재 여부 */
function branchExists(name) {
	const r = gitSafe(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
	return r.ok && !!r.out;
}

/** main 의 커밋 개수 (없으면 0) */
function mainCommitCount() {
	if (!mainHasCommits()) return 0;
	const r = gitSafe(['rev-list', '--count', 'main']);
	return r.ok ? Number(r.out) : 0;
}

/** origin 원격이 설정돼 있는가 */
function hasRemote() {
	const r = gitSafe(['remote', 'get-url', 'origin']);
	return r.ok && !!r.out;
}

/**
 * origin 이 있으면 ref(브랜치)를 push 한다 (best-effort).
 * origin 이 없으면 skip 로그만 남기고, push 실패도 throw 하지 않는다(병합/자율 흐름을 막지 않음).
 */
function pushIfRemote(ref) {
	if (!hasRemote()) {
		log(`push 생략: origin 미설정 (${ref})`);
		return;
	}
	const r = gitSafe(['push', '-u', 'origin', ref]);
	if (r.ok) log(`push 완료: origin ${ref}`);
	else log(`push 실패(무시 — 병합은 계속): origin ${ref} (exit ${r.code})`);
}

/**
 * 직접 main 작업 차단 가드.
 * seed-main 을 제외한 step 작업이 main 브랜치에서 직접 커밋되는 것을 거부합니다.
 * - main 이 아직 시드 안됨(unborn): seed-main 만 허용되므로 통과 (false)
 * - main 이 시드됨 + 현재 브랜치가 main: 직접 작업 금지 → throw
 * - 그 외(step/* 브랜치 등): 통과
 *
 * @param {string} action 호출 맥락(로그용)
 * @throws main 에서 직접 작업하려 할 때
 */
export function assertNotDirectMainWork(action = 'commit') {
	if (shouldSkipGitFlow()) return; // git-flow 우회 시 가드 비활성
	if (!mainHasCommits()) return; // 아직 seed 전 → seed-main 의 영역
	if (currentBranch() === 'main') {
		throw new Error(
			`직접 main 작업 거부: '${action}' 는 main 에서 수행할 수 없습니다. ` +
				`start-step 으로 step 브랜치를 만들고 merge-step 으로 병합하세요.`,
		);
	}
}

/** seed-main: 조건부 초기 시드 커밋 */
function cmdSeedMain() {
	if (shouldSkipGitFlow()) {
		log('seed skipped (skipGitFlow=true / useGit=false) — no-op');
		return 0;
	}
	if (mainHasCommits()) {
		log('seed skipped (main already seeded)');
		// 빈 원격이면 main 을 먼저 push 해 GitHub default 브랜치가 main 이 되게 한다.
		// (step 브랜치가 main 보다 먼저 push 되면 그게 default 로 잡힘 — 실제 테스트에서 발생.)
		pushIfRemote('main');
		return 0;
	}
	// main 이 unborn 이거나 없음 → main 으로 보장 후 시드
	const branch = currentBranch();
	if (branch !== 'main') {
		// 현재 unborn HEAD 를 main 으로 지정
		const sym = gitSafe(['symbolic-ref', 'HEAD', 'refs/heads/main']);
		if (!sym.ok) log(`경고: HEAD 를 main 으로 지정하지 못했습니다 (현재: ${branch || 'unknown'})`);
	}
	git(['add', '-A']);
	// 스테이징된 변경이 전혀 없으면 빈 커밋이라도 시드를 남긴다(루트 커밋 보장)
	const staged = gitSafe(['diff', '--cached', '--quiet']);
	const allowEmpty = staged.ok ? ['--allow-empty'] : [];
	git(['commit', ...allowEmpty, '-m', 'chore: harness 계획 시드']);
	log(`seed-main 완료: main 초기 시드 커밋 생성 (총 ${mainCommitCount()}개 커밋)`);
	// 빈 원격이면 main 을 먼저 push 해 default 브랜치를 main 으로 (step 브랜치 우선 push 방지).
	pushIfRemote('main');
	return 0;
}

/** step/<nn>-<slug> 브랜치 이름 구성 */
function stepBranchName(nn, slug) {
	return `step/${nn}-${slug}`;
}

/** start-step <nn> <slug>: main 에서 step 브랜치 생성·체크아웃 */
function cmdStartStep(nn, slug) {
	if (shouldSkipGitFlow()) {
		log('start-step skipped (skipGitFlow=true / useGit=false) — no-op');
		return 0;
	}
	if (!nn || !slug) fail('start-step 사용법: start-step <nn> <slug>');
	if (!mainHasCommits()) {
		fail('start-step 거부: main 이 아직 시드되지 않았습니다. 먼저 seed-main 을 실행하세요.');
	}
	const branch = stepBranchName(nn, slug);
	if (branchExists(branch)) {
		// 이미 있으면 체크아웃만
		git(['checkout', branch]);
		log(`start-step: 기존 브랜치 '${branch}' 로 체크아웃`);
		return 0;
	}
	git(['checkout', '-b', branch, 'main']);
	log(`start-step: '${branch}' 생성·체크아웃 (from main)`);
	return 0;
}

/**
 * done-gate 평가.
 * - scripts/done-gate.mjs 존재 시: `node scripts/done-gate.mjs` 실행, exit 0 필요
 * - 없으면: --gate-ok 플래그 또는 HARNESS_GATE_OK=1 필요 (done-gate 는 US-007 에서 도입)
 * @returns {{passed: boolean, reason: string}}
 */
function evaluateDoneGate(extraArgs) {
	const gatePath = path.join(repoRoot, 'scripts', 'done-gate.mjs');
	if (existsSync(gatePath)) {
		// 투표 오버라이드 플래그를 done-gate 로 전달 (주관 임계만 우회, 결정적 게이트는 유지).
		const passThrough = extraArgs.includes('--vote-override') ? ['--vote-override'] : [];
		const r = gitSafeNode([gatePath, ...passThrough]);
		if (r.code === 0) return { passed: true, reason: `done-gate.mjs exit 0${passThrough.length ? ' (vote-override)' : ''}` };
		return { passed: false, reason: `done-gate.mjs exit ${r.code}` };
	}
	// 폴백: 명시적 승인 필요
	const gateOkFlag = extraArgs.includes('--gate-ok');
	const gateOkEnv = process.env.HARNESS_GATE_OK === '1';
	if (gateOkFlag || gateOkEnv) {
		return { passed: true, reason: gateOkFlag ? '--gate-ok flag' : 'HARNESS_GATE_OK=1' };
	}
	return {
		passed: false,
		reason: 'done-gate.mjs 없음 + --gate-ok / HARNESS_GATE_OK=1 미지정 (US-007 도입 전 명시 승인 필요)',
	};
}

/** node 스크립트 실행 (실패해도 throw 안함) */
function gitSafeNode(args) {
	try {
		execFileSync('node', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' });
		return { code: 0 };
	} catch (err) {
		return { code: err.status ?? 1 };
	}
}

/** merge-step <nn> <slug>: done-gate 통과 시에만 step 을 main 에 병합 */
function cmdMergeStep(nn, slug, extraArgs) {
	if (shouldSkipGitFlow()) {
		log('merge-step skipped (skipGitFlow=true / useGit=false) — no-op');
		return 0;
	}
	if (!nn || !slug) fail('merge-step 사용법: merge-step <nn> <slug> [--gate-ok]');
	const branch = stepBranchName(nn, slug);
	if (!mainHasCommits()) {
		fail('merge-step 거부: main 이 아직 시드되지 않았습니다.');
	}
	if (!branchExists(branch)) {
		fail(`merge-step 거부: 브랜치 '${branch}' 가 존재하지 않습니다.`);
	}

	// done-gate 평가 — 통과해야만 main 에 쓰기 허용
	const gate = evaluateDoneGate(extraArgs);
	if (!gate.passed) {
		fail(`merge-step 거부: done-gate 실패 — ${gate.reason}`, 1);
	}
	log(`done-gate 통과: ${gate.reason}`);

	// 테스트 통과분(step 브랜치)을 원격에 먼저 push 한다 — origin 있을 때만, 없으면 skip(자율 유지).
	pushIfRemote(branch);

	// merge-step 이 seed 이후 main 에 쓰기를 하는 유일한 경로.
	git(['checkout', 'main']);
	git(['merge', '--no-ff', branch, '-m', `merge: ${branch} → main`]);
	log(`merge-step 완료: '${branch}' → main 병합 (총 ${mainCommitCount()}개 커밋)`);

	// 병합된 main 을 원격에 push (origin 있을 때만).
	pushIfRemote('main');
	return 0;
}

function usage() {
	console.log(
		[
			'git-flow.mjs — git-flow 오케스트레이션',
			'',
			'사용법:',
			'  node scripts/git-flow.mjs seed-main',
			'  node scripts/git-flow.mjs start-step <nn> <slug>',
			'  node scripts/git-flow.mjs merge-step <nn> <slug> [--gate-ok] [--vote-override]',
			'',
			'skipGitFlow=true(=useGit=false) 면 모든 명령은 no-op 입니다.',
		].join('\n'),
	);
}

function main() {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	const rest = argv.slice(1);
	const positional = rest.filter((a) => !a.startsWith('--'));

	switch (cmd) {
		case 'seed-main':
			return process.exit(cmdSeedMain());
		case 'start-step':
			return process.exit(cmdStartStep(positional[0], positional[1]));
		case 'merge-step':
			return process.exit(cmdMergeStep(positional[0], positional[1], rest));
		case undefined:
		case '-h':
		case '--help':
			usage();
			return process.exit(0);
		default:
			console.error(`[git-flow] 알 수 없는 명령: ${cmd}`);
			usage();
			return process.exit(2);
	}
}

// 직접 실행될 때만 main() 구동 (import 시에는 가드만 export)
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
