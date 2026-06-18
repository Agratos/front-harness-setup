#!/usr/bin/env node
// init-project.mjs — 프로젝트 시작 전 게이트 (Step 1, AC1 + 연동 접근 확인)
// - .git 존재 확인, useGit=true 이고 저장소가 없으면 git init (이 스텝이 저장소 생성 책임)
// - (선택) git 원격 주소·Notion 대시보드 URL 을 받아 **실제 접근 가능한지 확인**한다.
//     · git: `git ls-remote <url>` 로 인증·존재 확인 → 되면 origin 연결
//     · notion: URL 에서 page id 추출 → NOTION_TOKEN 으로 페이지 조회(integration 확인) + 대시보드 초기화 페이로드 적재
//   인터뷰/개발 전에 연동 끊김을 잡아, "한참 작업 후 push/미러 실패" 사고를 막는다.
// - harness/config.json 에 {useGit, useMcp, mcpServers, skipGitFlow, gitRemote,
//   notionDashboardPageId, preflight.checks} 기록
// - 비대화형: --use-git/--use-mcp, --git-remote=<url>, --notion-url=<url> 인자 또는
//   HARNESS_USE_GIT / HARNESS_USE_MCP / HARNESS_GIT_REMOTE / HARNESS_NOTION_URL 환경변수
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resetDashboard } from './lib/notion.mjs';
import { flushOutbox } from './lib/notion-api.mjs';

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

/**
 * --flag, --flag=value, --no-flag 형태 파싱 (boolean).
 * names 에 별칭을 여러 개 줄 수 있다(예: ['use-git','git'] → --use-git / --git / --no-git 모두 인식).
 */
function parseFlag(argv, names, fallback) {
	const list = Array.isArray(names) ? names : [names];
	for (const arg of argv) {
		for (const name of list) {
			if (arg === `--${name}`) return true;
			if (arg === `--no-${name}`) return false;
			if (arg.startsWith(`--${name}=`)) return toBool(arg.slice(name.length + 3), fallback);
		}
	}
	return undefined;
}

/** --name=value 또는 --name value 형태 파싱 (문자열). 없으면 env, 그것도 없으면 null */
function parseStr(argv, name, envName) {
	for (const arg of argv) {
		if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
	}
	const idx = argv.indexOf(`--${name}`);
	if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
	return (envName && process.env[envName]) || null;
}

function resolveSetting(argv, flagNames, envName, fallback) {
	const fromFlag = parseFlag(argv, flagNames, fallback);
	if (fromFlag !== undefined) return fromFlag;
	return toBool(process.env[envName], fallback);
}

/**
 * Notion URL/입력에서 page id 를 추출해 정규(dashed) 형태로 반환한다 (순수 함수).
 * 허용: 대시 UUID, 32 hex 런(URL slug 끝의 id), 원시 id. 못 찾으면 null.
 * @param {string} input
 * @returns {string|null} 예: '1a2b3c4d-5e6f-7890-abcd-ef1234567890'
 */
export function extractNotionPageId(input) {
	if (!input) return null;
	const s = String(input).trim();
	const dashed = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
	if (dashed) return toDashedId(dashed[0].replace(/-/g, ''));
	const runs = s.match(/[0-9a-fA-F]{32}/g);
	if (runs && runs.length) return toDashedId(runs[runs.length - 1]);
	return null;
}

/** 32 hex → 8-4-4-4-12 dashed 소문자 */
export function toDashedId(hex32) {
	const h = String(hex32).toLowerCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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

/** process.env 우선, 없으면 .env 파일에서 NAME=value 를 읽는다(간이 파서). */
function readToken(name) {
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

/** git ls-remote 로 원격 접근·인증 확인 (네트워크 I/O). */
function checkGitRemote(url) {
	try {
		execFileSync('git', ['ls-remote', url], { cwd: repoRoot, stdio: 'pipe', timeout: 20000 });
		return { ok: true, message: 'ls-remote 성공 (접근 가능)' };
	} catch (err) {
		const msg = (err.stderr ? err.stderr.toString() : err.message || '').trim();
		return { ok: false, message: (msg || 'ls-remote 실패').slice(-300) };
	}
}

/** origin 을 url 로 설정(있으면 set-url, 없으면 add). */
function setGitOrigin(url) {
	try {
		execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: repoRoot, stdio: 'pipe' });
	} catch {
		try {
			execFileSync('git', ['remote', 'add', 'origin', url], { cwd: repoRoot, stdio: 'pipe' });
		} catch {
			/* origin 설정 실패는 치명적 아님 — 접근 확인 결과만 기록 */
		}
	}
}

/** Notion 페이지 조회로 integration 연결·접근 확인 (네트워크 I/O). */
async function checkNotionPage(pageId, token) {
	if (!pageId) return { ok: false, message: 'page id 추출 실패 (URL 확인)' };
	if (!token) return { ok: false, message: 'NOTION_TOKEN 없음 (.env 확인)' };
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 20000);
		const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
			headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
			signal: ctrl.signal,
		});
		clearTimeout(timer);
		if (res.ok) return { ok: true, message: `페이지 접근 OK (status ${res.status})` };
		const body = await res.text().catch(() => '');
		const hint = res.status === 404 ? ' (페이지에 integration 을 연결했는지 확인)' : '';
		return { ok: false, message: `status ${res.status}${hint} ${body.slice(0, 160)}`.trim() };
	} catch (err) {
		return { ok: false, message: err.name === 'AbortError' ? '타임아웃' : err.message || 'fetch 실패' };
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const useGit = resolveSetting(argv, ['use-git', 'git'], 'HARNESS_USE_GIT', true);
	const useMcp = resolveSetting(argv, ['use-mcp', 'mcp'], 'HARNESS_USE_MCP', false);
	const gitRemote = parseStr(argv, 'git-remote', 'HARNESS_GIT_REMOTE');
	const notionUrl = parseStr(argv, 'notion-url', 'HARNESS_NOTION_URL');

	console.log('=== harness init-project ===');
	const hadGit = gitInitialized();
	console.log(`git repository: ${hadGit ? 'present (.git found)' : 'absent (no .git)'}`);
	console.log(`useGit=${useGit}  useMcp=${useMcp}`);

	let gitInitDone = false;
	if (useGit && !hadGit) {
		try {
			try {
				execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'pipe' });
			} catch {
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

	// ── git 원격 접근 확인 (주소가 주어졌고 useGit 일 때만) ──────────────
	let gitRemoteCheck = null;
	if (useGit && gitRemote) {
		gitRemoteCheck = checkGitRemote(gitRemote);
		console.log(`git remote: ${gitRemote}`);
		console.log(`  접근 확인: ${gitRemoteCheck.ok ? 'OK ✅' : 'FAIL ❌'} — ${gitRemoteCheck.message}`);
		if (gitRemoteCheck.ok && gitInitialized()) {
			setGitOrigin(gitRemote);
			console.log('  origin 연결 완료');
		} else if (!gitRemoteCheck.ok) {
			console.log('  ⚠️ 원격에 접근하지 못했습니다. URL·권한·인증(토큰/SSH 키)을 확인하세요. (진행은 차단하지 않음)');
		}
	} else if (gitRemote && !useGit) {
		console.log('git remote: 무시됨 (useGit=false)');
	}

	// ── Notion 페이지 접근 확인 (URL 이 주어졌고 useMcp 일 때만) ─────────
	let notionCheck = null;
	let notionPageId = null;
	if (useMcp && notionUrl) {
		notionPageId = extractNotionPageId(notionUrl);
		const token = readToken('NOTION_TOKEN');
		notionCheck = await checkNotionPage(notionPageId, token);
		console.log(`notion url: ${notionUrl}`);
		console.log(`  page id: ${notionPageId ?? '(추출 실패)'}`);
		console.log(`  접근 확인: ${notionCheck.ok ? 'OK ✅' : 'FAIL ❌'} — ${notionCheck.message}`);
		if (notionCheck.ok) {
			// 접근 확인 성공 → 초기화 페이로드를 적재한다. ⚠️ flush(notion-api) 의 dashboard.reset 은
			// 비파괴 no-op 이라 실제로 비우지 않는다. 실제 허브 초기화는 /start-project §1b 에서
			// 오케스트레이터가 커넥터/REST 로 직접 수행한다(docs/notion-hub-layout.md §7).
			const rd = resetDashboard({ repoRoot, pageId: notionPageId, projectName: path.basename(repoRoot), force: true });
			if (!rd.skipped) console.log(`  대시보드 초기화 페이로드 적재: ${path.relative(repoRoot, rd.outboxPath)} (※ flush 는 no-op — 실제 비우기는 /start-project §1b 오케스트레이터가 수행)`);
		} else {
			console.log('  ⚠️ Notion 페이지에 접근하지 못했습니다. 페이지에 integration 을 연결했는지, NOTION_TOKEN 이 맞는지 확인하세요. (진행은 차단하지 않음)');
		}
	} else if (notionUrl && !useMcp) {
		console.log('notion url: 무시됨 (useMcp=false)');
	}

	const prev = readConfig();
	const prevChecks = prev.preflight?.checks ?? {};
	const config = {
		...prev,
		useGit,
		useMcp,
		mcpServers: useMcp ? prev.mcpServers ?? [] : [],
		skipGitFlow: !useGit,
		gitRemote: gitRemote ?? prev.gitRemote ?? null,
		notionDashboardPageId: notionPageId ?? prev.notionDashboardPageId ?? null,
		preflight: {
			ranAt: new Date().toISOString(),
			gitInitDone,
			gitPresentBefore: hadGit,
			checks: {
				gitRemote: gitRemote ? { url: gitRemote, reachable: !!gitRemoteCheck?.ok } : prevChecks.gitRemote ?? null,
				notion: notionUrl ? { url: notionUrl, pageId: notionPageId, reachable: !!notionCheck?.ok } : prevChecks.notion ?? null,
			},
		},
	};
	writeConfig(config);
	console.log(`config written: ${path.relative(repoRoot, configPath)}`);
	console.log(`skipGitFlow=${config.skipGitFlow}`);

	// 적재된 outbox(대시보드 초기화 등)를 실제 Notion 에 반영(best-effort). 실패해도 진행 차단 안 함.
	if (useMcp) {
		try {
			const fr = await flushOutbox(repoRoot);
			if (!fr.skipped) console.log(`notion flush: sent=${fr.sent} failed=${fr.failed} (※ reset/upsert no-op — 실제 허브 반영은 /start-project §1b 오케스트레이터가 수행)`);
			else console.log(`notion flush: skip (${fr.reason})`);
		} catch {
			/* flush 실패는 best-effort — 무시 */
		}
	}

	// 연동 확인 실패가 있으면 비-제로 힌트를 남기되, 자율 흐름을 막지 않도록 exit 0 유지.
	const warnings = [];
	if (gitRemoteCheck && !gitRemoteCheck.ok) warnings.push('git 원격 접근 실패');
	if (notionCheck && !notionCheck.ok) warnings.push('Notion 페이지 접근 실패');
	if (warnings.length) console.log(`⚠️ 경고: ${warnings.join(', ')} — 해결 후 다시 실행 권장`);
	console.log('=== init-project complete ===');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
