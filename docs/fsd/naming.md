# 네이밍 규약

이 문서는 harness-setup 프로젝트의 파일·폴더·심볼 네이밍, 배럴 규약, 슬라이스 폴더 구조 규약을 종합합니다.

---

## 1. 파일·폴더 네이밍

모든 파일과 폴더는 **kebab-case** 를 사용합니다.

| 종류                 | 규칙                 | 예시                                                         |
| -------------------- | -------------------- | ------------------------------------------------------------ |
| 일반 TypeScript 파일 | `kebab-case.ts`      | `sum.ts`, `api-client.ts`                                    |
| React 컴포넌트 파일  | `kebab-case.tsx`     | `example-card.tsx`, `page-header.tsx`                        |
| DTO 파일             | `<name>.dto.ts`      | `example.dto.ts`                                             |
| 타입 파일            | `<name>.types.ts`    | `example.types.ts`                                           |
| 매퍼 파일            | `<name>.mapper.ts`   | `example.mapper.ts`                                          |
| 스토어 파일          | `<name>.store.ts`    | `example.store.ts`                                           |
| 쿼리 파일            | `<name>.query.ts`    | `example-list.query.ts`, `example.query.ts`                  |
| 뮤테이션 파일        | `<name>.mutation.ts` | `example-update.mutation.ts`                                 |
| 훅 파일              | `use-<name>.ts(x)`   | `use-debounce.ts`                                            |
| 테스트 파일          | `<name>.test.ts(x)`  | `sum.test.ts`, `button.test.tsx`                             |
| 세그먼트 폴더        | `kebab-case/`        | `api/`, `dto/`, `types/`, `mapper/`, `store/`, `ui/`, `lib/`, `config/` |
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
export { useExampleSelectionStore } from './store/example-selection.store';
export type { ExampleItem } from './types/example.types';
```

### 배럴 규칙

1. 외부 레이어는 반드시 `@/<layer>/<slice>` 경로(배럴)를 통해 import 합니다.
2. 세그먼트 내부 파일(`@/<layer>/<slice>/types/<name>.types`)을 직접 import 하는 것은 **금지**입니다.
3. 내부 구현(헬퍼 함수, DTO, mapper 등)은 배럴에 노출하지 않습니다.
4. `export` 순서는 `eslint-plugin-simple-import-sort` 규칙을 따릅니다.

```ts
// ✅ 올바른 사용
import type { ExampleItem } from '@/entities/example';

// ❌ 금지 — 세그먼트 직접 접근
import type { ExampleItem } from '@/entities/example/types/example.types';
```

---

## 4. 슬라이스 폴더 구조 규약

```
src/<layer>/<slice-name>/
├── api/         (쿼리/뮤테이션 훅 — <name>.query.ts / <action>.mutation.ts, 선택)
├── dto/         (서버 원본 타입 <name>.dto.ts — 주로 entities)
├── types/       (클라이언트 타입 <name>.types.ts — 주로 entities)
├── mapper/      (DTO ↔ Types 변환 <name>.mapper.ts — 주로 entities)
├── store/       (상태 스토어 <name>.store.ts, 선택)
├── ui/          (컴포넌트 — features/widgets/pages, 선택)
├── lib/         (순수 유틸, 선택)
├── config/      (상수, 선택)
└── index.ts     ← 필수. public API 배럴
```

- `index.ts` 는 **필수**입니다. 없으면 슬라이스가 외부에 노출되지 않습니다.
- 필요한 세그먼트만 생성합니다. 빈 폴더는 만들지 않습니다.
- 세그먼트 폴더 이름은 위 목록에서 선택합니다. 임의 이름 사용 금지입니다.
- **entities 의 `dto`·`types`·`mapper`·`store` 는 슬라이스 최상위 세그먼트**로 둡니다 (default-setup
  표준 방식 계승 — 예전 `model/` 단일 폴더 방식은 폐기). 실재 예시·상세: `docs/fsd/entities.md`.

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
