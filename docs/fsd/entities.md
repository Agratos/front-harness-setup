# entities 레이어

## 1. 책임 / 정의

`entities` 는 **비즈니스 도메인 단위 모델**을 정의하는 레이어입니다. 서버 API 의 타입·상태·변환·호출
로직이 이 계층에 위치하며, 화면 조립 로직은 포함하지 않습니다.

서버 원본(DTO)과 클라이언트 타입(Types)을 **mapper 로 분리·연결**하는 것이 핵심 규약입니다.

> ⭐ **Canonical 실재 예시: [`src/entities/example/`](../../src/entities/example/)** — 컴파일·테스트·게이트를
> 통과하는 살아있는 코드입니다. 새 엔티티는 이 슬라이스의 구조를 그대로 따라 실제 도메인 이름
> (`dashboard`, `user` 등)으로 작성합니다. 두 가지 다른 스타일을 만들지 않습니다.

---

## 2. 슬라이스 구조 (세그먼트)

dto/·types/·mapper/·store/ 를 **`model/` 세그먼트 아래**에 묶고, `api/`·`lib/` 는 슬라이스
최상위에 둡니다 (참조 프로젝트 **scms-ems** 의 표준 방식 — 2026-06-12 default-setup 최상위
배치 방식에서 전환). dto/mapper/types 파일은 엔티티 단위 1파일이 아니라 **API 동작 단위**로
분리합니다 (`<slice>-list.dto.ts`, `<slice>-update.types.ts` …).

```
src/entities/<slice>/
├── api/
│   ├── <slice>-list.query.ts                # queryApi (등록형 — 무파라미터/고정 파라미터)
│   ├── <slice>-list-with-params.query.ts    # useQueryApi (호출형 — 동적 params)
│   └── <slice>-update.mutation.ts           # useMutationApi (생성·수정·삭제)
├── model/
│   ├── dto/
│   │   └── <slice>-<action>.dto.ts     # 서버 원본 (snake_case, 약어, Y/N 그대로) + 응답 envelope + 입력 DTO
│   ├── types/
│   │   └── <slice>-<action>.types.ts   # 클라이언트 형태 (camelCase, boolean, number, ISO, 풀네임)
│   ├── mapper/
│   │   └── <slice>-<action>.mapper.ts  # map<Dto>To<Type>() / map<Type>To<Dto>() 순수 함수 — DTO↔Type 단일 통로
│   └── store/                          # 도메인 상태(Zustand) — stateful 도메인만 (선택)
├── lib/                       # 도메인 비즈니스 로직, 계산 함수 (선택)
└── index.ts                   # 외부 공개 export — query/mutation 훅 + 클라이언트 타입만
```

도메인이 큰 경우 **그룹 폴더 2단 중첩**을 허용합니다 (scms-ems 방식 —
`src/entities/admin/operator/` 처럼 `entities/<group>/<slice>/`). 이때 배럴 import 는
`@/entities/<group>/<slice>` 입니다. 그룹 폴더 자체에는 `index.ts` 를 두지 않습니다.

---

## 3. DTO ↔ Mapper ↔ Types (핵심 패턴)

```
서버 응답(DTO) → query 의 select → mapper → 클라이언트 타입(Types) → 화면
```

### 핵심 원칙

- **컴포넌트/위젯/페이지는 DTO 를 절대 모릅니다.** 항상 `types` 만 봅니다. `index.ts` 배럴도
  DTO/mapper 를 노출하지 않습니다.
- DTO → Type 변환의 **단일 통로 = `mapper`** (순수 함수, 부수효과 X). 다른 곳에서 변환 금지.
- **네이밍**: `dto` 는 서버 약어 그대로 둡니다 (`exam_id`, `reg_dt`, `use_yn`). `types` 는 **약어 금지 —
  풀네임**으로 씁니다 (`id`, `registeredAt`, `isActive`). 약어→풀네임 변환이 일어나는 유일한 지점이
  `mapper` 입니다.
- **백엔드 계약 비의존**: `select` 에서 `resultCode` 를 직접 보지 않고
  `selectResult`(`shared/lib/api/response-adapter`)를 씁니다. envelope 형태가 다른 백엔드면
  `setResponseAdapter()` 한 곳만 교체하면 됩니다 (query 코드 무수정).
- 서버 스펙이 바뀌면 `dto` + `mapper` 만 고치면 됩니다 (클라이언트 코드 무영향).

실제 코드는 실재 예시를 보십시오:
[dto](../../src/entities/example/model/dto/example-list.dto.ts) ·
[types](../../src/entities/example/model/types/example-list.types.ts) ·
[mapper](../../src/entities/example/model/mapper/example-list.mapper.ts) (+ [mapper 단위 테스트](../../src/entities/example/model/mapper/example-list.mapper.test.ts))

---

## 4. API 헬퍼 선택 기준

| 상황 | 헬퍼 | 반환 | 실재 예시 |
| --- | --- | --- | --- |
| 무파라미터 / 고정 파라미터 list·detail | `queryApi(...)` | `[useXxxQuery, prefetchXxx]` 튜플 | [example-list.query.ts](../../src/entities/example/api/example-list.query.ts) |
| 호출마다 params 가 바뀌는 list·detail | `useQueryApi(...)` | `useQuery` 결과 그대로 | [example-list-with-params.query.ts](../../src/entities/example/api/example-list-with-params.query.ts) |
| 생성·수정·삭제 mutation | `useMutationApi(...)` | `useMutation` 결과 | [example-update.mutation.ts](../../src/entities/example/api/example-update.mutation.ts) |

> **참조 프로젝트와의 차이 (의도된 것)**: scms-ems 는 mutation 요청 타입을 서버 필드명 그대로
> `model/types` 에 두고 컴포넌트가 직접 채우지만, 이 프로젝트는 **클라이언트 타입 → mapper → DTO**
> 변환을 유지합니다 (컴포넌트가 서버 약어를 모르게 하는 §3 규약 우선). envelope 처리도 mapper 내
> null 가드 대신 `selectResult` 어댑터를 유지합니다.

- `queryApi` 는 등록 시점에 key/params 가 고정됩니다 → 동적 params 에는 쓸 수 없습니다.
- `useQueryApi` 는 hook 안에서 호출하며 `key: ['xxx', dtoParams]` 로 파라미터별 캐싱이 분리됩니다.
- mutation 은 컴포넌트가 DTO 를 보지 않도록 mapper 를 자동 적용하는 wrapper 훅(`useXxxUpdate()`)을
  함께 둡니다.
- 제네릭 순서는 모두 `<응답DTO, 입력파라미터, 변환된 결과타입>` 입니다.

---

## 5. store — 도메인 상태 (선택)

서버 상태는 react-query 가 관리하므로, store(Zustand)는 **클라이언트 측 도메인 상태**가 실제로 있을
때만 `model/store/` 에 둡니다 (예: 세션, 선택 상태). `shared/lib/zustand/create-store-with-devtool`
헬퍼를 사용합니다.

---

## 6. 서버 API 문서 → 엔티티 변환 절차 (7단계)

서버가 API 문서를 제공하면 다음 순서로 엔티티를 만듭니다 (엔티티모델러 에이전트의 작업 규약):

1. **응답 원본 분석** — 필드명·타입·envelope 구조를 그대로 적는다 (변형 금지).
2. **`model/dto/<slice>-<action>.dto.ts`** — 응답·요청을 서버 사정 그대로 타입화한다 (`ApiResponseBase` 합성).
3. **`model/types/<slice>-<action>.types.ts`** — 클라이언트 도메인 모델을 풀네임·정규화 타입으로 설계한다.
4. **`model/mapper/<slice>-<action>.mapper.ts`** — DTO→Type (필요 시 Type→DTO) 순수 함수를 작성하고 **단위 테스트**를 붙인다.
5. **`api/`** — 위 §4 기준으로 query/mutation 훅을 작성한다 (`selectResult` + mapper 합성).
6. **`index.ts`** — 훅 + 클라이언트 타입만 공개한다.
7. **게이트 확인** — `yarn typecheck && yarn lint && yarn test:run && node scripts/check-arch.js` green.

---

## 7. entities 에 두지 않는 것

| 사례 | 올바른 위치 |
| --- | --- |
| 단순 공용 UI 컴포넌트 | `shared/ui` |
| 사용자 액션 중심 기능 (폼, 토글 등) | `features` |
| 여러 기능을 조립한 UI 블록 | `widgets` |
| 라우트 단위 화면 구성 | `pages` |
| 도메인과 무관한 전역 유틸 | `shared/lib`, `shared/utils` |
