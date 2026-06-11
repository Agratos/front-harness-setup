#!/usr/bin/env node
// preflight.mjs — 프로젝트 시작 전 git/MCP 게이트 (Step 1, AC1)
// - .git 존재 확인, useGit=true 이고 저장소가 없으면 git init (이 스텝이 저장소 생성 책임)
// - harness/config.json 에 {useGit, useMcp, mcpServers, skipGitFlow} 기록
// - 비대화형: --use-git[=bool] / --use-mcp[=bool] 인자 또는 HARNESS_USE_GIT / HARNESS_USE_MCP 환경변수
//   기본값 useGit=true, useMcp=false
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const harnessDir = path.join(repoRoot, 'harness');
const configPath = path.join(harnessDir, 'config.json');

/** "true"/"false"/"1"/"0"/"yes"/"no" → boolean, 그 외 default */
function toBool(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const v = String(value).trim().toLowerCase();
	if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
	if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
	return fallback;
}

/** --flag, --flag=value, --no-flag 형태 파싱 */
function parseFlag(argv, name, fallback) {
	for (const arg of argv) {
		if (arg === `--${name}`) return true;
		if (arg === `--no-${name}`) return false;
		if (arg.startsWith(`--${name}=`)) return toBool(arg.slice(name.length + 3), fallback);
	}
	return undefined;
}

function resolveSetting(argv, flagName, envName, fallback) {
	const fromFlag = parseFlag(argv, flagName, fallback);
	if (fromFlag !== undefined) return fromFlag;
	return toBool(process.env[envName], fallback);
}

function gitInitialized() {
	return existsSync(path.join(repoRoot, '.git'));
}

function readConfig() {
	if (!existsSync(configPath)) return {};
	try {
		return JSON.parse(readFileSync(configPath, 'utf8'));
	} catch {
		return {};
	}
}

function writeConfig(config) {
	mkdirSync(harnessDir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function main() {
	const argv = process.argv.slice(2);
	const useGit = resolveSetting(argv, 'use-git', 'HARNESS_USE_GIT', true);
	const useMcp = resolveSetting(argv, 'use-mcp', 'HARNESS_USE_MCP', false);

	console.log('=== harness preflight ===');
	const hadGit = gitInitialized();
	console.log(`git repository: ${hadGit ? 'present (.git found)' : 'absent (no .git)'}`);
	console.log(`useGit=${useGit}  useMcp=${useMcp}`);

	let gitInitDone = false;
	if (useGit && !hadGit) {
		try {
			// 기본 브랜치 main 으로 초기화
			try {
				execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'pipe' });
			} catch {
				// 구버전 git: -b 미지원 → init 후 브랜치명 변경
				execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'pipe' });
				execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: repoRoot, stdio: 'pipe' });
			}
			gitInitDone = true;
			console.log('git init: done (branch=main)');
		} catch (err) {
			console.error('git init: FAILED —', err.message);
		}
	} else if (!useGit) {
		console.log('git init: skipped (useGit=false)');
	} else {
		console.log('git init: skipped (already initialized)');
	}

	const prev = readConfig();
	const config = {
		...prev,
		useGit,
		useMcp,
		mcpServers: useMcp ? prev.mcpServers ?? [] : [],
		skipGitFlow: !useGit,
		preflight: {
			ranAt: new Date().toISOString(),
			gitInitDone,
			gitPresentBefore: hadGit,
		},
	};
	writeConfig(config);
	console.log(`config written: ${path.relative(repoRoot, configPath)}`);
	console.log(`skipGitFlow=${config.skipGitFlow}`);
	console.log('=== preflight complete ===');
}

main();
