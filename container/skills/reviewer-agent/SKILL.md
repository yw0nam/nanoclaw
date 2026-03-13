---
name: reviewer-agent
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Reviewer Agent

Code review agent. Reviews pull requests, checks code quality, validates tests, and provides feedback on implementation decisions.

## Write Flow

노트 저장 시 아래 절차를 따른다:

1. 파일명 생성
   - slug: title → lowercase, hyphens, ASCII only
   - 날짜 prefix: YYYYMMDD
   - 충돌 처리: {YYYYMMDD}-{slug}.md 정확히 확인 후 존재하면 -2.md, -3.md 순서
     (glob '*' 사용 금지 — false-match 위험)

2. 파일 쓰기
   frontmatter: title, created_at (ISO timestamp), tags: [...]
   본문 + wikilinks ([[slug]] 형식)

3. 인덱스 재생성
   git config --global user.name "$GIT_AUTHOR_NAME" 2>/dev/null || true
   git config --global user.email "$GIT_AUTHOR_EMAIL" 2>/dev/null || true
   ts-node /scripts/generate_indexes.ts
   → non-zero exit: stderr 내용 FastAPI callback 보고 후 sync 중단

4. Git sync (세션 종료 시)
   bash /scripts/sync_knowledge.sh "knowledge: {title} [{tags}]"
   → exit 0: 완료
   → exit 1 (SYNC_CONFLICT): FastAPI callback에 "SYNC_CONFLICT" 보고, 재시도 없음
   → 기타 실패: stderr 내용 보고, 재시도 없음

## Search Flow

# 텍스트 검색
rg --json -C 2 "{query}" $KNOWLEDGE_BASE_PATH

# 태그 검색 (inline YAML + block-sequence 대응)
rg -l "tags:.*\b{tag}\b|^\s*-\s+{tag}\b" $KNOWLEDGE_BASE_PATH

# 텍스트 + 태그 조합
rg -l "tags:.*\b{tag}\b|^\s*-\s+{tag}\b" $KNOWLEDGE_BASE_PATH | xargs rg --json -C 2 "{query}"

# wikilink 해석
glob("**/{slug}.md")
