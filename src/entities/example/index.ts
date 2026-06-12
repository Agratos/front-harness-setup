// 외부 공개 export — query/mutation 훅 + "클라이언트 타입"만 노출한다 (DTO/mapper 비공개).
export { prefetchExampleList, useExampleListQuery } from './api/example-list.query';
export { useExampleListWithParamsQuery } from './api/example-list-with-params.query';
export { useExampleUpdate, useExampleUpdateMutation } from './api/example-update.mutation';
export type { ExampleItem, ExampleListParams, ExampleListResult } from './model/types/example-list.types';
export type { ExampleUpdateRequest } from './model/types/example-update.types';
