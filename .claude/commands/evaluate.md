# /evaluate — 고객 평가 (Playwright) + 루브릭 채점 + Notion 동기화

harness-setup 의 한 사이클 산출물을 **실사용 관점에서 평가** 하고, 고정 루브릭으로 채점해
`harness/evaluations/<id>.{md,json}` 에 기록하는 명령입니다. done-gate(완료 게이트)는 이 평가의
`score` / `majorComplaints` 를 읽어 통과/탈락을 판정합니다.

## 동작 요약

1. **dev 서버 기동**: `yarn dev --port 8000 --strictPort` 를 detached/background child 로 띄우고 pid 캡처.
2. **준비 대기**: `http://127.0.0.1:8000` 가 응답할 때까지 폴링(최대 ~30s).
3. **Playwright 실측**(설치된 경우): chromium headless 로 접속 →
   - 스크린샷 `harness/evaluations/<id>/screenshot.png` 저장
   - 관찰값 수집: 문서 title, `harness-setup` heading 존재, `#root` 마운트, console/runtime 오류 수.
4. **채점**: `docs/eval-rubric.md` 의 고정 루브릭(`scripts/lib/rubric.mjs`)으로 4차원(UI/UX/기능/품질)
   점수와 종합·불만 목록 산출.
5. **기록**: `<id>.json`(머신리더블, done-gate 계약 필드 `score`/`majorComplaints`) + `<id>.md`(사람용).
6. **TEARDOWN(필수)**: 항상 `finally` 에서 dev 서버 프로세스 트리를 종료하고 포트 해제를 검증.

## 실행

```bash
# 기본 (포트 8000, id 자동 증가 eval-NNNN)
node scripts/eval-playwright.mjs

# 포트/ id 지정
node scripts/eval-playwright.mjs --port=8000 --id=eval-0007

# 결정적 테스트용 주입 (관찰과 무관하게 점수/major 덮어쓰기)
node scripts/eval-playwright.mjs --score=95 --major-complaints=0

# 외부에서 띄운 서버에 붙기(서버 기동/종료 생략)
node scripts/eval-playwright.mjs --no-server --port=8000
```

| 인자                   | 의미                                | 기본값           |
| ---------------------- | ----------------------------------- | ---------------- |
| `--port=N`             | dev 서버 고정 포트                  | `8000`           |
| `--id=ID`              | 평가 식별자(파일명)                 | `eval-NNNN` 자동 |
| `--score=N`            | 종합 점수 주입(테스트/CI)           | (관찰 기반 산출) |
| `--major-complaints=N` | major 불만 수 주입                  | (관찰 기반 산출) |
| `--no-server`          | 서버 기동·종료 생략(외부 서버 가정) | off              |

## 루브릭 (요약)

- 4차원: **UI(0.25) / UX(0.20) / 기능(0.35) / 품질(0.20)**, 가중 평균 = 종합 점수.
- **불만 = 실패한 체크리스트 항목**. 심각도 `major`/`minor` 는 항목별로 고정.
- **major 불만이 1건이라도 있으면 done-gate FAIL** (점수와 독립).
- 상세 기준: `docs/eval-rubric.md`.

## TEARDOWN (Windows critical)

평가가 끝나거나 도중에 예외가 나도 **항상** 다음을 수행합니다.

- Windows: `taskkill /F /T /PID <pid>` 로 dev 서버 **프로세스 트리 전체** 강제 종료.
- POSIX: detached 프로세스 그룹에 `kill(-pid, SIGKILL)`.
- 종료 후 포트가 free 가 될 때까지 폴링 → **free 확인 로그**.
- 결과: orphan node/vite 프로세스가 남지 않음을 보장.

> 주의: 종료 직후 `netstat` 에 `TIME_WAIT` 항목이 잠시 보일 수 있으나, 이는 평가 스크립트가
> 사용한 **클라이언트 소켓이 닫히며 드레이닝** 되는 정상 상태이며 `LISTENING` 리스너가 아닙니다.

## 폴백 (Playwright 미설치/브라우저 실패)

- `@playwright/test` 가 없거나 chromium 실행이 실패하면 **정적 폴백(static-fallback)** 으로 전환:
  `index.html` / `app.tsx` 를 정적 파싱해 가능한 관찰값으로 채점하고
  로그에 `Playwright 미설치 — 정적 폴백` 을 남깁니다.
- 폴백 경로에서도 **dev 서버 teardown 은 동일하게 수행** 하며 종료 코드는 `0` 입니다.
- 설치: `yarn add -D @playwright/test && npx playwright install chromium`.

## Notion 동기화 (outbox)

- `scripts/lib/notion.mjs` 는 `harness/config.json` 의 `useMcp` 로 게이트됩니다.
- `useMcp=false` → 모든 함수 no-op(`{skipped:true}`), outbox 미기록.
- `useMcp=true` → 페이로드를 `harness/notion-outbox/<id>.json` 에 적재(라이브 API 직접 호출 X).
  실제 전송은 오케스트레이터/MCP 레이어가 outbox 를 flush 하며 수행.
- 대시보드/댓글 미러 스펙: `docs/notion-dashboard.md`.

## 자가검증

```bash
# Playwright 없이 teardown + 루브릭 + notion no-op 을 결정적으로 검증
node scripts/eval.selftest.mjs   # → 'EVAL SELFTEST: PASS', exit 0
```

## 관련 파일

- `scripts/eval-playwright.mjs` — 평가 CLI 진입점.
- `scripts/lib/rubric.mjs` — 루브릭 채점(순수 함수).
- `scripts/lib/teardown.mjs` — 프로세스 트리 종료 + 포트 해제 검증.
- `scripts/lib/notion.mjs` — Notion outbox 어댑터.
- `scripts/eval.selftest.mjs` — 자가검증.
- `docs/eval-rubric.md`, `docs/notion-dashboard.md` — 스펙 문서.
