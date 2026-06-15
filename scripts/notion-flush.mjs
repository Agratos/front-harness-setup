#!/usr/bin/env node
// notion-flush.mjs — harness/notion-outbox/ 에 적재된 페이로드를 실제 Notion 에 반영(flush).
//
// loop.mjs(매 페이즈)·init-project.mjs(초기화) 가 적재 후 best-effort 로 이 스크립트를 호출하며,
// 단독으로도 실행할 수 있습니다(`node scripts/notion-flush.mjs` / `yarn notion:flush`).
// useMcp=false / NOTION_TOKEN 없음 / 네트워크 실패 시 조용히 skip 합니다(exit 0).
import { pathToFileURL } from 'node:url';

import { flushOutbox } from './lib/notion-api.mjs';

async function main() {
	const repoRoot = process.cwd();
	const r = await flushOutbox(repoRoot);
	if (r.skipped) {
		console.log(`[notion-flush] skip (${r.reason})`);
	} else {
		console.log(`[notion-flush] sent=${r.sent} failed=${r.failed}`);
	}
	// flush 실패는 개발 루프를 막지 않도록 항상 exit 0.
	process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
