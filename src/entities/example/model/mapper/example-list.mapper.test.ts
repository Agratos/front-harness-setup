import { describe, expect, it } from 'vitest';

import type { ExampleItemDto } from '../dto/example-list.dto';

import { mapExampleItemDtoToExampleItem, mapExampleListParamsToDto } from './example-list.mapper';

describe('example-list.mapper (DTO ↔ Types 단일 통로)', () => {
	it('서버 DTO 를 클라이언트 타입으로 정규화한다 (약어→풀네임, Y/N→boolean, 문자열→number)', () => {
		const dto: ExampleItemDto = {
			exam_id: 7,
			exam_name: '예시',
			use_yn: 'Y',
			status: '3',
			reg_dt: '2026-06-11T00:00:00Z',
		};

		expect(mapExampleItemDtoToExampleItem(dto)).toEqual({
			id: 7,
			name: '예시',
			isActive: true,
			status: 3,
			registeredAt: '2026-06-11T00:00:00Z',
		});
	});

	it('status 가 빈 문자열/숫자 아님이면 null 로 정규화한다', () => {
		const base: ExampleItemDto = { exam_id: 1, exam_name: 'a', use_yn: 'N', status: '', reg_dt: '' };

		expect(mapExampleItemDtoToExampleItem(base).status).toBeNull();
		expect(mapExampleItemDtoToExampleItem({ ...base, status: 'abc' }).status).toBeNull();
		expect(mapExampleItemDtoToExampleItem(base).isActive).toBe(false);
	});

	it('클라이언트 list 파라미터를 서버 DTO 로 변환한다 (isActive 생략 시 use_yn 미포함)', () => {
		expect(mapExampleListParamsToDto({ page: 1, pageSize: 20, isActive: true })).toEqual({
			page: 1,
			page_size: 20,
			use_yn: 'Y',
		});
		expect(mapExampleListParamsToDto({ page: 2, pageSize: 10 })).toEqual({ page: 2, page_size: 10 });
	});
});
