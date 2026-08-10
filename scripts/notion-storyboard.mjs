#!/usr/bin/env node
// notion-storyboard.mjs — eval-scenario 스토리보드 캡처를 🧪 테스트 관리 행 본문에 이미지로 첨부.
//
// 왜: 캡처 PNG 는 로컬에만 저장되고(eval-scenario.mjs), MCP 커넥터는 파일 업로드를 못 한다
// (docs/notion-hub-layout.md §8). 그래서 이 스크립트가 File Upload API 로 PNG 를 올려
// 대상 행(보통 qa 가 MCP 로 막 만든 🧪 테스트 관리 행) 본문에 image 블록으로 붙인다.
//
// 분업: 행 **생성**은 오케스트레이터/qa 가 MCP(notion-create-pages)로 한다(기존 doctrine).
//       이 스크립트는 MCP 가 못 하는 **업로드 + 첨부**만 담당하며, 그 행의 page id 를 받는다.
//
// 사용:
//   node scripts/notion-storyboard.mjs --id=<scenId> --row=<행 page id>
//   [--scenario=<scenario.json>] [--shots=<png 디렉터리>] [--title=<라벨>] [--repo=<root>] [--env=<.env>]
//
// 기본값: scenario = <repo>/harness/evaluations/<id>/scenario.json, shots = 그 디렉터리.
// 게이트: useMcp!=true / 토큰 없음 / 스펙 없음 → 조용히 skip(exit 0, 루프 미차단).
//         첨부를 시도했는데 실패하면 exit 1(qa 가 인지).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { attachStoryboard, resolveToken, storyboardItems } from './lib/notion-api.mjs';

function parseArgs(argv) {
	const o = { id: 'scenario', row: null, scenario: null, shots: null, title: null, repo: process.cwd(), env: null };
	for (const a of argv) {
		const m = a.match(/^--([^=]+)=(.*)$/);
		if (!m) continue;
		const [, k, v] = m;
		if (k in o) o[k] = v;
	}
	return o;
}

function readUseMcp(repoRoot) {
	const p = path.join(repoRoot, 'harness', 'config.json');
	if (!existsSync(p)) return false;
	try {
		return JSON.parse(readFileSync(p, 'utf8')).useMcp === true;
	} catch {
		return false;
	}
}

export async function run(opts) {
	const repoRoot = opts.repo ?? process.cwd();
	if (!readUseMcp(repoRoot)) return { skipped: true, reason: 'useMcp!=true' };
	if (!opts.row) return { skipped: true, reason: '--row(대상 행 page id) 없음' };

	const token = opts.env
		? (existsSync(opts.env) && (readFileSync(opts.env, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('NOTION_TOKEN=')) || '').split('=').slice(1).join('=').trim()) || null
		: resolveToken(repoRoot);
	if (!token) return { skipped: true, reason: 'NOTION_TOKEN 없음' };

	const scenPath = opts.scenario ?? path.join(repoRoot, 'harness', 'evaluations', opts.id, 'scenario.json');
	if (!existsSync(scenPath)) return { skipped: true, reason: `scenario.json 없음(${scenPath})` };
	let spec;
	try {
		spec = JSON.parse(readFileSync(scenPath, 'utf8'));
	} catch (e) {
		return { skipped: true, reason: `scenario.json 파싱 실패: ${e?.message ?? e}` };
	}
	const shotsDir = opts.shots ?? path.dirname(scenPath);
	const scenarios = spec.scenarios ?? [];
	if (scenarios.length === 0) return { skipped: true, reason: '시나리오 0개' };

	// 시나리오가 여러 개면 각각 마커를 달리해 순서대로 첨부.
	const out = [];
	for (let i = 0; i < scenarios.length; i++) {
		const sc = scenarios[i];
		const items = storyboardItems(sc, shotsDir);
		const subId = scenarios.length > 1 ? `${opts.id}#${i + 1}` : opts.id;
		const r = await attachStoryboard(opts.row, items, token, { id: subId, title: opts.title ?? sc.name });
		out.push({ scenario: sc.name, ...r });
	}
	const failed = out.filter((r) => r.ok === false);
	return { skipped: false, row: opts.row, results: out, failed: failed.length };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const r = await run(opts);
	if (r.skipped) {
		console.log(`[notion-storyboard] skip (${r.reason})`);
		process.exit(0);
	}
	for (const x of r.results) {
		const tag = x.skipped ? `skip(${x.reason})` : x.ok ? `attached ${x.attached}컷` : `FAIL(${x.reason})`;
		console.log(`[notion-storyboard] "${x.scenario}" → ${tag}`);
	}
	process.exit(r.failed > 0 ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
