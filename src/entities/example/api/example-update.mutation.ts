import type { ApiResponseBase } from '@/shared/lib/api/types';
import { useMutationApi } from '@/shared/lib/react-query/use-mutation-api';

import type { ExampleUpdateRequestDto } from '../model/dto/example-update.dto';
import { mapExampleUpdateRequestToDto } from '../model/mapper/example-update.mapper';
import type { ExampleUpdateRequest } from '../model/types/example-update.types';

/**
 * 생성/수정 mutation 표준 패턴.
 * - `useMutationApi<응답DTO, 입력파라미터DTO>` 로 등록 (api 는 정적)
 * - 호출 측에서 mapper 를 거쳐 dto 를 만들어 넘긴다.
 */
export const useExampleUpdateMutation = () =>
	useMutationApi<ApiResponseBase, ExampleUpdateRequestDto>({
		api: {
			type: 'post',
			url: '/example/update',
		},
	});

/**
 * 클라이언트 타입을 받아 자동으로 mapper 를 적용하는 편의 훅.
 * 컴포넌트에서 DTO 를 직접 다루지 않게 해주는 정석 패턴이다.
 *
 * 사용:
 *   const { mutate } = useExampleUpdate();
 *   mutate({ id, name, isActive });
 */
export function useExampleUpdate() {
	const mutation = useExampleUpdateMutation();

	return {
		...mutation,
		mutate: (request: ExampleUpdateRequest) => mutation.mutate(mapExampleUpdateRequestToDto(request)),
		mutateAsync: (request: ExampleUpdateRequest) =>
			mutation.mutateAsync(mapExampleUpdateRequestToDto(request)),
	};
}
