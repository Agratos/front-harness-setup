import { selectResult } from '@/shared/lib/api/response-adapter';
import { queryApi } from '@/shared/lib/react-query/query-api';

import type { ExampleListResponseDto } from '../model/dto/example-list.dto';
import { mapExampleItemDtoToExampleItem } from '../model/mapper/example-list.mapper';
import type { ExampleItem } from '../model/types/example-list.types';

/**
 * 쿼리는 DTO 를 받아 select 에서 mapper 로 변환해 "클라이언트 타입"만 외부에 노출한다.
 * envelope(성공판정/payload추출)는 selectResult(어댑터)가 담당 → 백엔드 계약 의존 제거.
 * 제네릭: queryApi<응답DTO, 입력파라미터, 변환된 결과타입>
 */
export const [useExampleListQuery, prefetchExampleList] = queryApi<
	ExampleListResponseDto,
	null,
	ExampleItem[]
>({
	key: ['example-list'],
	api: { url: '/example/list', type: 'get', useAuth: true },
	options: {
		select: (response) =>
			selectResult(
				response,
				(payload: ExampleListResponseDto['result']) =>
					payload.resultList.map(mapExampleItemDtoToExampleItem),
				[],
			),
	},
});
