import { describe, expect, it } from 'vitest';

import { mapExampleUpdateRequestToDto } from './example-update.mapper';

describe('example-update.mapper (mutation 입력 변환)', () => {
	it('mutation 입력을 서버 DTO 로 변환한다', () => {
		expect(mapExampleUpdateRequestToDto({ id: 5, name: '수정', isActive: false })).toEqual({
			exam_id: 5,
			exam_name: '수정',
			use_yn: 'N',
		});
	});
});
