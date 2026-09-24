# Crevena Toon 실사용 체크리스트

## 최초 1회

- [ ] Supabase 프로젝트 준비
- [ ] `001_toon_schema.sql`부터 `022_toon_project_locations.sql`까지 순서대로 적용
- [ ] `verify_toon_schema.sql` 확인
- [ ] `verify_toon_rls.sql` 확인
- [ ] Supabase Authentication에 관리자 계정 생성
- [ ] Storage 버킷과 정책 생성 여부 확인
- [ ] 배포 환경변수 등록
- [ ] `npm run check` 통과

## 필수 환경변수

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `GEMINI_API_KEY`
- [ ] OpenAI 이미지 생성기를 선택한 경우 `OPENAI_API_KEY`

## 실제 제작 흐름

1. 관리자 로그인
2. 캐릭터 생성 및 참조 사진 등록
3. Character Bible 분석·검토·저장
4. Character Sheet 생성·검토·승인
5. 필요하면 장소와 시리즈 등록
6. 새 프로젝트 생성
7. 표지 1장과 본문 장면으로 스토리보드 생성
8. 장면 내용·등장인물·장소·시간대를 검토하고 확정
9. 컷별 이미지 생성 또는 부분 수정
10. 사용할 이미지 승인
11. 말풍선·내레이션·표지 제목 편집
12. 최종 PNG 또는 ZIP 다운로드

## 배포 후 빠른 점검

- [ ] `/toon/login`이 오류 없이 열림
- [ ] 잘못된 비밀번호에 내부 오류가 노출되지 않음
- [ ] 로그인 후 캐릭터·시리즈·장소·프로젝트 메뉴 이동 가능
- [ ] 로그아웃 후 보호 화면에 다시 접근할 수 없음
- [ ] 사진 업로드 후 서명 URL이 정상 표시됨
- [ ] 캐릭터 분석 1회 성공
- [ ] Character Sheet 생성·승인 1회 성공
- [ ] 표지 포함 스토리보드 생성·저장 1회 성공
- [ ] 이미지 생성·승인·편집·다운로드 1회 성공
- [ ] 다른 사용자 데이터가 RLS로 조회되지 않음

## 도메인 원칙

Crevena Toon은 `toon.crevena.com`에만 연결합니다. 기존 Crevena 서비스와 포트폴리오 도메인은 수정하지 않습니다.
