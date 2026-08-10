import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '@/app';

import pkg from '../../package.json';

describe('App (스모크 테스트)', () => {
	// ⚠️ 프로젝트 이름을 하드코딩하지 않는다. `reset-project` 는 새 프로젝트명으로
	// package.json·index.html·App.tsx 를 치환하는데, 예전에는 이 테스트가 빠져 있어서
	// **복사한 새 프로젝트가 생성 직후 테스트 RED 로 출발**했다(실측 사고).
	// package.json 의 name 을 읽으면 치환 대상이 아니어도 항상 정합한다.
	it('프로젝트 이름을 heading 으로 렌더한다', () => {
		render(<App />);
		expect(screen.getByRole('heading', { name: pkg.name, level: 1 })).toBeInTheDocument();
	});
});
