# shared 레이어

## 1. 책임 / 정의

`shared` 는 FSD **최하위 계층(0)** 입니다. 특정 도메인·비즈니스 로직과 **무관한** 범용 코드만 둡니다 —
HTTP/쿼리/스토어 인프라, 공용 UI 컴포넌트, 범용 유틸·타입·에셋.

> shared 는 슬라이스(도메인 폴더)가 없습니다. **세그먼트(lib·ui·types …)가 곧 폴더 구조**입니다.

---

## 2. 세그먼트

| 세그먼트  | 내용                                                          |
| --------- | ------------------------------------------------------------- |
| `lib/`    | 인프라·유틸을 **관심사별 그룹**으로: `api/`·`react-query/`·`zustand/`·`date/`·`object/`·`format/` 등 |
| `ui/`     | 공용 컴포넌트 (`button/`·`input/`·`select/`·`modal/`·`container-table/`·`typography/` …) |
| `types/`  | 공용 제네릭 타입                                              |
| `utils/`  | 그룹화 이전의 단독 순수 유틸                                  |
| `assets/` | 전역 이미지·SVG·폰트                                          |
| `config/` | 환경 변수 래퍼·전역 상수                                      |

> 현재 harness 베이스는 **`lib/{api, react-query, zustand}` 인프라만** 시드되어 있습니다.
> `ui/`·`types/`·`utils/` 등은 필요할 때 추가합니다(scms 의 shared 형태를 계승).

---

## 3. 현재 제공 인프라 (`shared/lib`)

entities 가 의존하는 데이터 계층 헬퍼입니다(`entities.md §4` 참고).

| 그룹                | 주요 export                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `lib/api`           | `axiosApi`, `ApiError`/`isApiError`, `selectResult`·`setResponseAdapter`(응답 어댑터 seam), `ApiResponseBase`(`./types`) |
| `lib/react-query`   | `queryApi`(튜플), `useQueryApi`, `useMutationApi`, `prefetchQueryApi`, `queryClient`         |
| `lib/zustand`       | `createStoreWithDevtool` (devtools/persist 래퍼)                                             |

> **응답 계약 단일 교체 지점**: 백엔드 envelope 가 다르면 `lib/api/response-adapter.ts` 의
> `setResponseAdapter(...)` 한 곳만 바꾸면 됩니다(쿼리/엔티티 코드 무수정).

---

## 4. import 규약

소비자(entities/features/widgets)는 **그룹 경로**로 import 합니다(상위 문서들과 동일).

```ts
// 데이터 인프라 (entities 에서)
import { useQueryApi } from '@/shared/lib/react-query/use-query-api';
import { selectResult } from '@/shared/lib/api/response-adapter';
import type { ApiResponseBase } from '@/shared/lib/api/types';

// 공용 UI (features/widgets 에서 — ui/ 추가 시)
import { ExampleInput } from '@/shared/ui/input';
```

> 그룹 배럴(`@/shared/lib/react-query`)과 통합 배럴(`@/shared`)도 제공되지만, 위처럼 **그룹/파일 경로**로
> 쓰는 것이 scms 의 표준입니다. 그룹이 노출하지 않는 내부 헬퍼는 import 하지 않습니다.

---

## 5. 의존성 역전 (auth 토큰 seam)

`shared` 는 `entities` 를 import 할 수 없으므로, 토큰처럼 상위 정보가 필요한 곳은 **주입받습니다**.

```ts
// shared/lib/api/axios-api.ts — 상위 레이어가 토큰을 주입
export function setAuthToken(token: string | undefined): void { /* ... */ }
```

`auth` 엔티티/`app` 이 로그인·로그아웃 시 `setAuthToken(token)` 을 호출해 의존을 역전시킵니다.

---

## 6. Import 규칙

```
shared(0) < entities(1) < features(2) < widgets(3) < pages(4) < app(5)
```

`shared` 는 최하위 레이어이므로 `@/entities/`·`@/features/`·`@/widgets/`·`@/pages/`·`@/app/` import 가
**모두 금지**됩니다(외부 패키지 import 만 허용). 위반 시 `node scripts/check-arch.js` 가 오류를 반환합니다.

---

## 7. 네이밍

- **파일·폴더**: `kebab-case` (예: `axios-api.ts`, `use-query-api.ts`, `create-excel-file-name.ts`)
- **컴포넌트**: `PascalCase`
- **함수·변수**: `camelCase`
- **타입**: `PascalCase`
- `interface`·`React.FC`·`export default` 금지(`naming.md`).

---

## 8. 미니 예시 트리

```
src/shared/
├── lib/
│   ├── api/              ← axiosApi, ApiError, response-adapter(selectResult), types(ApiResponseBase)
│   ├── react-query/      ← queryApi, useQueryApi, useMutationApi, queryClient
│   └── zustand/          ← createStoreWithDevtool
│   └── (date/ object/ format/ … 필요 시 추가)
├── ui/                   ← 공용 컴포넌트 (button/ input/ … — 추가 시)
├── types/                ← 공용 타입 (추가 시)
└── index.ts              ← 통합 배럴
```
