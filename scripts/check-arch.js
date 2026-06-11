#!/usr/bin/env node
// check-arch.js — dependency-free FSD layer boundary checker.
//
// Scans src/**/*.{ts,tsx}, infers each file's FSD layer from its path, parses
// '@/'-prefixed import statements, and rejects imports that reach into a HIGHER
// layer than the importing file's own layer.
//
// Layer order (low -> high):
//   shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
//
// Rule: a module may import from layers with index <= its own. Importing from a
// strictly HIGHER layer is a violation (e.g. shared importing from features).
//
// Usage:
//   node scripts/check-arch.js [--json] [--files <dir>]
//
// Exit code: 1 if any violations, else 0.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const LAYER_ORDER = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
const LAYER_INDEX = Object.fromEntries(LAYER_ORDER.map((name, i) => [name, i]));

const VIOLATION_CODE = 'FSD_LAYER_IMPORT';

/** Parse CLI args: supports --json and --files <dir>. */
function parseArgs(argv) {
	const opts = { json: false, files: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--json') {
			opts.json = true;
		} else if (arg === '--files') {
			opts.files = argv[++i] ?? null;
		}
	}
	return opts;
}

/** Recursively collect *.ts / *.tsx files under a directory. */
function collectSourceFiles(dir) {
	const out = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === 'dist') continue;
			out.push(...collectSourceFiles(full));
		} else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/** Infer the FSD layer of a file from its path relative to src/. */
function inferLayer(absFile, srcRoot) {
	const rel = relative(srcRoot, absFile);
	const first = rel.split(sep)[0];
	return LAYER_INDEX[first] !== undefined ? first : null;
}

/** Infer the FSD layer referenced by an '@/...' import specifier. */
function inferImportLayer(specifier) {
	// specifier like '@/shared/lib/sum' or '@/features/foo'
	const withoutPrefix = specifier.slice(2); // drop '@/'
	const first = withoutPrefix.split('/')[0];
	return LAYER_INDEX[first] !== undefined ? first : null;
}

// Matches: import ... from '@/...'  |  export ... from '@/...'  |  import('@/...')
const IMPORT_RE =
	/(?:import|export)\s[^'"`]*?from\s*['"`](@\/[^'"`]+)['"`]|import\s*\(\s*['"`](@\/[^'"`]+)['"`]\s*\)/g;

/** Find all '@/'-import specifiers in source, with their 1-based line numbers. */
function findAliasImports(source) {
	const results = [];
	let match;
	IMPORT_RE.lastIndex = 0;
	while ((match = IMPORT_RE.exec(source)) !== null) {
		const specifier = match[1] ?? match[2];
		if (!specifier) continue;
		const line = source.slice(0, match.index).split('\n').length;
		results.push({ specifier, line });
	}
	return results;
}

function checkFile(absFile, srcRoot, cwd) {
	const fileLayer = inferLayer(absFile, srcRoot);
	if (!fileLayer) return [];
	const fileLayerIdx = LAYER_INDEX[fileLayer];

	const source = readFileSync(absFile, 'utf8');
	const violations = [];

	for (const { specifier, line } of findAliasImports(source)) {
		const importLayer = inferImportLayer(specifier);
		if (!importLayer) continue;
		const importLayerIdx = LAYER_INDEX[importLayer];
		if (importLayerIdx > fileLayerIdx) {
			violations.push({
				file: relative(cwd, absFile).split(sep).join('/'),
				line,
				code: VIOLATION_CODE,
				message: `${fileLayer} may not import from higher layer ${importLayer} ('${specifier}')`,
			});
		}
	}
	return violations;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();
	const srcRoot = resolve(cwd, 'src');

	let scanRoot = srcRoot;
	if (opts.files) {
		scanRoot = resolve(cwd, opts.files);
	}

	let scanTargets = [];
	try {
		scanTargets = statSync(scanRoot).isDirectory() ? collectSourceFiles(scanRoot) : [scanRoot];
	} catch {
		scanTargets = [];
	}

	const violations = [];
	for (const file of scanTargets) {
		violations.push(...checkFile(file, srcRoot, cwd));
	}

	if (opts.json) {
		process.stdout.write(JSON.stringify({ violationCount: violations.length, violations }, null, 2) + '\n');
	} else {
		for (const v of violations) {
			process.stdout.write(`${v.file}:${v.line}  ${v.code}  ${v.message}\n`);
		}
		process.stdout.write(`\n${violations.length} violation(s) found.\n`);
	}

	process.exit(violations.length > 0 ? 1 : 0);
}

main();
