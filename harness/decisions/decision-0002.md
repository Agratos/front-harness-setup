# 협의 결정 로그 — decision-0002

| 키 | 값 |
| --- | --- |
| 안건 | 엔티티 슬라이스 구조: default-setup 방식 → scms-ems 방식 전환 |
| 제기자 | 사용자 |
| 타협 | 폴더 구조·파일 granularity 는 scms-ems 를 따르되, 데이터 흐름 규율(mapper 경유·selectResult)은 v2 규약 유지 |
| 결론 | entities 의 dto·types·mapper·store 를 model/ 세그먼트 아래로 묶고, 파일을 API 동작 단위(<slice>-<action>.*)로 분리한다. 도메인 그룹 2단 중첩 허용. |
| 영향 | src/entities/example 재배치, docs/fsd/entities.md·naming.md 규약 교체, entity-modeler 작업 규약 갱신, 사양서 변경 이력 추가 |
| 연결단계 | (사양서 확정 후 변경 — US 단계 외) |

## 안건

엔티티 슬라이스의 dto/types/mapper 배치를 default-setup 방식(슬라이스 최상위)으로 유지할지, scms-ems 방식(model/ 세그먼트 묶음 + API 동작 단위 파일 분리)으로 전환할지

## 제기자

사용자 (2026-06-12, "default-setup 말고 scms-ems 형태로")

## 주장 : 이유

| 주체 | 주장(claim) | 이유(reason) |
| --- | --- | --- |
| 사용자 | 엔티티 구조는 scms-ems 형태를 따라야 한다 | 실무 참조 프로젝트(scms-ems web-front)의 표준 구조와 일치시켜야 실제 개발 컨벤션과 어긋나지 않는다 |
| Claude (위임) | mutation 의 mapper 경유와 selectResult 어댑터는 scms-ems 를 따르지 않고 v2 규약을 유지해야 한다 | scms-ems 는 mutation 요청을 서버 필드명 그대로 컴포넌트가 채우지만, "컴포넌트는 서버 약어를 모른다"가 v2 핵심 규약(docs/fsd/entities.md §3)이다. envelope 어댑터도 백엔드 교체 대응이 목적 |

## 타협

폴더 구조·파일 granularity(=model/ 묶음, API 동작 단위 분리, 그룹 2단 중첩)는 scms-ems, 데이터 흐름 규율(클라이언트 타입 → mapper → DTO, selectResult)은 v2 유지. 차이는 의도된 것으로 entities.md 에 명시.

## 결론 + 근거(why)

- **결론**: entities 의 dto·types·mapper·store 를 model/ 세그먼트 아래로 묶고, 파일을 API 동작 단위로 분리한다. mutation mapper 경유·selectResult 는 유지한다.
- **근거(why)**: 사용자 직접 지시 + 유지 항목 2건은 Claude 제안을 사용자가 승인 ("추천하는 방향으로 부탁해"). 사양서 변경 이력(docs/spec/interview-2026-06-11.md)에 출처 기록.

## 영향

- src/entities/example 재배치 (main 커밋 b7708ca, step/07-entity-scms-style)
- docs/fsd/entities.md·naming.md 규약 교체, README/AGENTS/entity-modeler 동기 갱신
- 게이트 4종 green + done-gate PASS 후 병합

## 연결 단계

(사양서 확정 후 변경 — US 단계 외. step/07-entity-scms-style)
