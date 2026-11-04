# 01: 테스트 기반 준비

**What to build:** 개발자가 `npm test`로 계정 모듈 테스트를 돌릴 수 있는 기반. Vitest와 테스트용 Postgres(외부 서버 없이 프로세스 안에서 도는 Postgres)를 설정하고, 테스트마다 데이터를 비운다. Next 16 문서(`node_modules/next/dist/docs/`)의 Vitest 안내를 따른다.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm test`가 한 번 실행으로 모든 테스트를 돌리고 종료한다
- [ ] 테스트가 Docker나 외부 DB 없이 Postgres 호환 DB를 쓴다
- [ ] 테스트 사이에 데이터가 남지 않는다
- [ ] 타입체크 명령이 있다
