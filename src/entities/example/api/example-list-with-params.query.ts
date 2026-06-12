import { selectResult } from '@/shared/lib/api/response-adapter';
import { useQueryApi } from '@/shared/lib/react-query/use-query-api';

import type { ExampleListPagedResponseDto, ExampleListParamsDto } from '../model/dto/example-list.dto';
import { mapExampleItemDtoToExampleItem, mapExampleListParamsToDto } from '../model/mapper/example-list.mapper';
import type { ExampleListParams, ExampleListResult } from '../model/types/example-list.types';

/**
 * 파라미터(페이지·필터)가 호출마다 바뀌는 list — `useQueryApi` 사용.
 * - 클라이언트 파라미터를 mapper 로 DTO 화 → api.params 에 전달
 * - key 에 dtoParams 포함 → 파라미터별 캐싱 분리
 * - select 는 `selectResult` 로 envelope 처리 (resultCode 직접 검사 X)
 *
 * 사용: const { data } = useExampleListWithParamsQuery({ page: 1, pageSize: 20, isActive: true });
 */
const EXAMPLE_LIST_FALLBACK: ExampleListResult = { totalCount: 0, items: [] };

export function useExampleListWithParamsQuery(params: ExampleListParams) {
	const dtoParams = mapExampleListParamsToDto(params);

	return useQueryApi<ExampleListPagedResponseDto, ExampleListParamsDto, ExampleListResult>({
		key: ['example-list-with-params', dtoParams],
		api: {
			url: '/example/list',
			type: 'get',
			useAuth: true,
			params: dtoParams,
		},
		options: {
			select: (response) =>
				selectResult(
					response,
					(payload: ExampleListPagedResponseDto['result']) => ({
						totalCount: payload.total_count,
						items: payload.resultList.map(mapExampleItemDtoToExampleItem),
					}),
					EXAMPLE_LIST_FALLBACK,
				),
		},
	});
}
