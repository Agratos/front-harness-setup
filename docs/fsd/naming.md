# 네이밍 규약

이 문서는 harness-setup 프로젝트의 파일·폴더·심볼 네이밍, 배럴 규약, 슬라이스 폴더 구조 규약을 종합합니다.

---

## 1. 파일·폴더 네이밍

모든 파일과 폴더는 **kebab-case** 를 사용합니다.

| 종류                 | 규칙                 | 예시                                                         |
| -------------------- | -------------------- | ------------------------------------------------------------ |
| 일반 TypeScript 파일 | `kebab-case.ts`      | `sum.ts`, `api-client.ts`                                    |
| React 컴포넌트 파일  | `kebab-case.tsx`     | `example-card.tsx`, `page-header.tsx`                        |
| DTO 파일             | `<slice>-<action>.dto.ts`    | `example-list.dto.ts`, `example-update.dto.ts`       |
| 타입 파일            | `<slice>-<action>.types.ts`  | `example-list.types.ts`, `example-update.types.ts`   |
| 매퍼 파일            | `<slice>-<action>.mapper.ts` | `example-list.mapper.ts`                             |
| 스토어 파일          | `<name>.store.ts`    | `example.store.ts`                                           |
| 쿼리 파일            | `<name>.query.ts`    | `example-list.query.ts`, `example.query.ts`                  |
| 뮤테이션 파일        | `<name>.mutation.ts` | `example-update.mutation.ts`                                 |
| 훅 파일              | `use-<name>.ts(x)`   | `use-debounce.ts`                                            |
| 테스트 파일          | `<name>.test.ts(x)`  | `sum.test.ts`, `button.test.tsx`                             |
| 세그먼트 폴더        | `kebab-case/`        | `api/`, `model/`(하위 `dto/`·`types/`·`mapper/`·`store/`), `ui/`, `lib/`, `config/` |
| 슬라이스 폴더        | `kebab-case/`        | `example/`, `work-order/`                                    |

---

## 2. 심볼 네이밍

| 심볼 종류        | 규칙                 | 예시                             |
| ---------------- | -------------------- | -------------------------------- |
| React 컴포넌트   | `PascalCase`         | `ExampleCard`, `PageHeader`      |
| 타입·인터페이스  | `PascalCase`         | `ExampleItem`, `ApiResponse`     |
| 함수·변수        | `camelCase`          | `sum`, `fetchExampleItems`       |
| React 훅         | `use` + `PascalCase` | `useExampleQuery`, `useDebounce` |
| 상수 (모듈 레벨) | `UPPER_SNAKE_CASE`   | `MAX_PAGE_SIZE`, `API_BASE_URL`  |
| enum 값          | `UPPER_SNAKE_CASE`   | `STATUS.ACTIVE`                  |

### 금지 패턴

```ts
// ❌ interface 로 props 정의 금지 → type 사용
interface Props { name: string }

// ✅ 올바른 방식
type Props = { name: string }

// ❌ React.FC 사용 금지
const MyComponent: React.FC<Props> = ({ name }) => ...

// ✅ 올바른 방식
const MyComponent = ({ name }: Props) => ...

// ❌ export default 금지 (라우트 컴포넌트 등 특수 케이스 제외)
export default MyComponent

// ✅ 올바른 방식
export const MyComponent = ...
```

---

## 3. 배럴(Barrel) 규약

각 슬라이스·레이어는 루트에 `index.ts` 배럴을 두어 **public API** 를 선언합니다.

```ts
// ✅ index.ts — public API 만 노출 (훅 + 스토어 + 클라이언트 타입; dto 는 숨김)
export { useExampleListQuery } from './api/example-list.query';
export { useExampleSelectionStore } from './model/store/example-selection.store';
export type { ExampleItem } from './model/types/example-list.types';
```

### 배럴 규칙

1. 외부 레이어는 반드시 `@/<layer>/<slice>` 경로(배럴)를 통해 import 합니다.
2. 세그먼트 내부 파일(`@/<layer>/<slice>/model/types/<name>.types`)을 직접 import 하는 것은 **금지**입니다.
3. 내부 구현(헬퍼 함수, DTO, mapper 등)은 배럴에 노출하지 않습니다.
4. `export` 순서는 `eslint-plugin-simple-import-sort` 규칙을 따릅니다.

```ts
// ✅ 올바른 사용
import type { ExampleItem } from '@/entities/example';

// ❌ 금지 — 세그먼트 직접 접근
import type { ExampleItem } from '@/entities/example/model/types/example-list.types';
```

---

## 4. 슬라이스 폴더 구조 규약

```
src/<layer>/<slice-name>/
├── api/         (쿼리/뮤테이션 훅 — <name>.query.ts / <action>.mutation.ts, 선택)
├── model/       (도메인 모델 묶음 — 하위에 dto/ types/ mapper/ store/ — 주로 entities)
│   ├── dto/        (서버 원본 타입 <slice>-<action>.dto.ts)
│   ├── types/      (클라이언트 타입 <slice>-<action>.types.ts)
│   ├── mapper/     (DTO ↔ Types 변환 <slice>-<action>.mapper.ts)
│   └── store/      (상태 스토어 <name>.store.ts, 선택)
├── ui/          (컴포넌트 — features/widgets/pages, 선택)
├── lib/         (순수 유틸, 선택)
├── config/      (상수, 선택)
└── index.ts     ← 필수. public API 배럴
```

- `index.ts` 는 **필수**입니다. 없으면 슬라이스가 외부에 노출되지 않습니다.
- 필요한 세그먼트만 생성합니다. 빈 폴더는 만들지 않습니다.
- 세그먼트 폴더 이름은 위 목록에서 선택합니다. 임의 이름 사용 금지입니다.
- **entities 의 `dto`·`types`·`mapper`·`store` 는 `model/` 세그먼트 아래**에 둡니다 (참조 프로젝트
  scms-ems 표준 방식 — 2026-06-12 default-setup 최상위 배치에서 전환). 도메인이 크면
  `entities/<group>/<slice>/` 2단 중첩을 허용합니다. 실재 예시·상세: `docs/fsd/entities.md`.

---

## 5. Path Alias

프로젝트는 `tsconfig.json` 에 정의된 절대 경로 별칭을 사용합니다.

| 별칭          | 실제 경로        |
| ------------- | ---------------- |
| `@/*`         | `src/*`          |
| `@app/*`      | `src/app/*`      |
| `@pages/*`    | `src/pages/*`    |
| `@widgets/*`  | `src/widgets/*`  |
| `@features/*` | `src/features/*` |
| `@entities/*` | `src/entities/*` |
| `@shared/*`   | `src/shared/*`   |

슬라이스 import 시 `@/<layer>/<slice>` 형태를 권장합니다.

```ts
import type { ExampleItem } from '@/entities/example';
import { ExampleList } from '@/features/example-list';
```
