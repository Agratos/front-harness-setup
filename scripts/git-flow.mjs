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
//   배선: seed-main/start-step 이 .git/hooks/pre-commit 에 동일 정책의 훅을 설치한다
//   (ensureMainGuardHook — 함수만 export 하고 아무도 안 부르던 죽은 가드를 실제 강제로 승격).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const MAIN_GUARD_MARKER = 'harness-main-guard';

/**
 * assertNotDirectMainWork 의 **훅 배선** — .git/hooks/pre-commit 에 main 직접 커밋 차단 훅을 설치한다.
 *
 * 왜 필요한가: 가드 함수는 export 만 되어 있고 어떤 런타임 경로도 호출하지 않아 **죽은 방어선**이었다
 * (md 3곳은 "코드 강제"로 광고 — 실측 감사에서 발견). git 커밋은 이 스크립트를 거치지 않으므로
 * 실제 차단 지점은 git 훅뿐이다.
 *
 * 동작 (훅 스크립트):
 * - seed 이후 main 에서의 직접 `git commit` 을 거부한다.
 * - merge 진행 중(MERGE_HEAD 존재 — merge-step 의 충돌 마무리 커밋)은 허용.
 *   (`git merge --no-ff` 의 자동 병합 커밋은 pre-commit 을 타지 않으므로 merge-step 정상 경로는 영향 없음)
 * - 의도적 우회: `HARNESS_ALLOW_MAIN=1`.
 * - 멱등: 우리 마커가 있으면 재설치하지 않는다. **다른 훅(husky 등)이 이미 있으면 덮지 않고 경고만** 남긴다.
 */
export function ensureMainGuardHook() {
	if (shouldSkipGitFlow()) return;
	const gitDir = gitSafe(['rev-parse', '--git-dir']);
	if (!gitDir.ok || !gitDir.out) return;
	const hookPath = path.resolve(repoRoot, gitDir.out, 'hooks', 'pre-commit');
	if (existsSync(hookPath)) {
		const existing = readFileSync(hookPath, 'utf8');
		if (existing.includes(MAIN_GUARD_MARKER)) return; // 이미 설치됨 (멱등)
		log(`경고: 기존 pre-commit 훅이 있어 main 가드 훅을 설치하지 않았습니다 (${hookPath})`);
		return;
	}
	const script = [
		'#!/bin/sh',
		`# ${MAIN_GUARD_MARKER} — 직접 main 커밋 차단 (git-flow.mjs 가 설치, assertNotDirectMainWork 의 훅 배선)`,
		'[ "$HARNESS_ALLOW_MAIN" = "1" ] && exit 0',
		'branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)',
		'if [ "$branch" = "main" ] && git rev-parse --verify --quiet refs/heads/main >/dev/null 2>&1; then',
		'  if [ -f "$(git rev-parse --git-path MERGE_HEAD)" ]; then exit 0; fi',
		'  echo "[git-flow] 직접 main 커밋 거부: start-step 으로 step 브랜치를 만들고 merge-step 으로 병합하세요. (의도적 우회: HARNESS_ALLOW_MAIN=1)" >&2',
		'  exit 1',
		'fi',
		'exit 0',
		'',
	].join('\n');
	writeFileSync(hookPath, script, 'utf8');
	try {
		chmodSync(hookPath, 0o755);
	} catch {
		/* Windows: chmod 불필요 */
	}
	log('main 가드 훅 설치: .git/hooks/pre-commit (직접 main 커밋 차단)');
}

/** seed-main: 조건부 초기 시드 커밋 */
function cmdSeedMain() {
	if (shouldSkipGitFlow()) {
		log('seed skipped (skipGitFlow=true / useGit=false) — no-op');
		return 0;
	}
	if (mainHasCommits()) {
		log('seed skipped (main already seeded)');
		ensureMainGuardHook();
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
	ensureMainGuardHook();
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
	ensureMainGuardHook();
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

/**
 * step 브랜치가 main 대비 **실제 작업물**을 갖고 있는지 확인한다.
 *
 * 왜 필요한가: `merge-step` 은 **커밋된 이력만** 병합한다. 구현 산출물을 커밋하지 않은 채
 * merge 로 넘어가면 `--no-ff` 빈 병합이 되어, 게이트는 통과했는데 코드는 main 에 없는
 * 상태가 된다(실측 사고). 문서에는 ⛔ 경고만 있었고 코드는 검사하지 않았다 — 이제 코드가 막는다.
 *
 * @param {string} branch step 브랜치명
 * @returns {{commits:number, hasDiff:boolean, ok:boolean}}
 */
export function branchHasWork(branch) {
	const count = gitSafe(['rev-list', '--count', `main..${branch}`]);
	const commits = count.ok ? Number(count.out) || 0 : 0;
	// git diff --quiet: 차이가 없으면 exit 0(ok=true), 있으면 exit 1(ok=false)
	const diff = gitSafe(['diff', '--quiet', `main...${branch}`]);
	const hasDiff = !diff.ok;
	return { commits, hasDiff, ok: commits > 0 && hasDiff };
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

	// 빈 병합 차단 — 게이트(비싼 검사)보다 먼저. 커밋 없이 merge 로 온 경우를 즉시 잡는다.
	if (!extraArgs.includes('--allow-empty')) {
		const work = branchHasWork(branch);
		if (!work.ok) {
			fail(
				`merge-step 거부: '${branch}' 에 병합할 작업물이 없습니다 ` +
					`(main 대비 커밋 ${work.commits}개, 변경 ${work.hasDiff ? '있음' : '없음'}). ` +
					`구현 산출물을 step 브랜치에 git add/commit 한 뒤 다시 시도하세요. ` +
					`(의도적 빈 병합은 --allow-empty)`,
				1,
			);
		}
		log(`작업물 확인: 커밋 ${work.commits}개 · main 대비 변경 있음`);
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
	const co = gitSafe(['checkout', 'main']);
	if (!co.ok) {
		fail(
			`merge-step 거부: main 체크아웃 실패 — 작업트리에 미커밋 변경이 있는지 확인하고 ` +
				`step 브랜치에 커밋/정리한 뒤 다시 시도하세요. (exit ${co.code})`,
			1,
		);
	}
	const merged = gitSafe(['merge', '--no-ff', branch, '-m', `merge: ${branch} → main`]);
	if (!merged.ok) {
		// 충돌 등 병합 실패 — 반쯤 병합된 상태(더티 main)를 절대 남기지 않는다.
		// 다음 루프가 충돌 마커 위에서 돌면 게이트·평가가 전부 오염되기 때문.
		const abort = gitSafe(['merge', '--abort']);
		gitSafe(['checkout', branch]);
		fail(
			`merge-step 실패: '${branch}' → main 병합 중 오류(충돌 가능, exit ${merged.code}). ` +
				`merge --abort ${abort.ok ? '수행' : '해당 없음'} 후 '${branch}' 로 복귀했습니다. ` +
				`step 브랜치에서 main 을 병합해 충돌을 해결·커밋한 뒤 merge-step 을 재시도하세요.`,
			1,
		);
	}
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
			'  node scripts/git-flow.mjs merge-step <nn> <slug> [--gate-ok] [--vote-override] [--allow-empty]',
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
