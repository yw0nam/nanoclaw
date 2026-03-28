# Plans.md — NanoClaw Task Tracking

## Active Tasks

<!-- cc:TODO | cc:WIP | cc:blocked -->

## Completed

<!-- Move finished tasks here -->

<!-- spec: ../docs/superpowers/specs/2026-03-27-nanoclaw-structural-tests-design.md -->
- [x] **NC-S1: T4 console.log 금지** — `src/structural/architecture.test.ts` 신규 생성. `src/**/*.ts` (test/d.ts 제외)에 `console.*` 미존재 검증. DoD: `npm test` NC-S1 그린.
- [x] **NC-S2: T3 파일 LOC 제한** — `src/**/*.ts` 400줄 상한, `index.ts` 800줄 특례, `KNOWN_LARGE_FILES` 초기값 확정. DoD: `npm test` NC-S2 그린, debt 목록 확정. Depends: NC-S1.
- [x] **NC-S3: T1 Channel self-registration** — T1-1(모든 채널 파일이 `registerChannel(` 포함), T1-2(index.ts가 전부 import). DoD: `npm test` NC-S3 그린, http.ts로 양쪽 패스. Depends: NC-S2.
- [x] **NC-S4: T2 skill-as-branch 화이트리스트** — `KNOWN_SRC_FILES` 초기값 확정, 미등록 파일 추가 시 즉시 실패. DoD: `npm test` NC-S4 그린, `npm run build` 타입 에러 없음. Depends: NC-S3.

## Notes

- Skill branches: `skill/{name}` off `main` — never commit skill source to `develop`/`main`
- Escalate to workspace Lead Agent if: backend API changes needed first, or skill merge conflicts
- Change order: backend → nanoclaw → desktop-homunculus
