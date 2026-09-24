# Crevena Toon 시작 안내

## 현재 기준 상태

- 표지 1장과 본문 장면을 분리해 생성합니다.
- 한 에피소드는 표지를 포함해 2~20장으로 구성할 수 있습니다.
- 캐릭터, Character Sheet, 시리즈, 저장 장소와 프로젝트 전용 장소를 지원합니다.
- 장면 이미지 생성 후 말풍선·내레이션·표지 제목을 편집하고 최종 이미지를 내려받을 수 있습니다.

## 1. 설치

Node.js 20 이상을 권장합니다.

```bash
npm ci
cp .env.example .env.local
```

`.env.local`에 Supabase 값과 사용할 AI API 키를 입력합니다. 실제 키가 들어간 `.env.local`은 공유하거나 ZIP에 넣지 마세요.

## 2. 데이터베이스 적용

새 Supabase 프로젝트에서는 `supabase/001_toon_schema.sql`부터 `supabase/022_toon_project_locations.sql`까지 번호 순서대로 적용합니다.

이미 운영 중인 프로젝트라면 아직 적용하지 않은 마이그레이션만 순서대로 적용하세요. 운영 데이터가 있는 환경에서는 SQL 실행 전 백업과 별도 검증이 필요합니다.

기본 스키마와 RLS 확인용 SQL:

- `supabase/verify_toon_schema.sql`
- `supabase/verify_toon_rls.sql`

Supabase Authentication에 실제로 사용할 관리자 이메일 계정을 1개 생성하세요. 이 앱은 현재 운영자 본인이 사용하는 관리자용 MVP라서 공개 회원가입 화면을 제공하지 않습니다.

## 3. 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/toon/login`으로 접속합니다.

환경값이 빠져 있으면 로그인 화면과 상단 경고에서 누락된 설정 이름을 알려줍니다. 로그인 화면이 정상적으로 열리더라도 AI 생성용 서버 값이 빠져 있으면 캐릭터 분석·스토리보드·이미지 생성은 실행되지 않습니다.

## 4. 변경 전후 필수 검증

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

한 번에 확인하려면 다음 명령을 사용할 수 있습니다.

```bash
npm run check
```

현재 기준본은 테스트 478개, 린트, 타입 검사, Next.js 운영 빌드를 통과합니다.

## 5. 중요한 기준

- 표지는 항상 첫 번째 이미지이며 프로젝트당 최대 1개입니다.
- `panel_count`는 표지를 포함한 전체 이미지 수입니다.
- 표지와 각 장면에는 동시에 최대 4명의 캐릭터가 등장할 수 있습니다.
- 이미지 자체에는 글자를 생성하지 않고 제목·대사·내레이션은 편집기에서 합성합니다.
- 캐릭터 일관성을 위해 Character Sheet와 캐릭터별 고정 외형 지시를 유지합니다.
- 기본 텍스트 모델은 `gemini-3.6-flash`, 기본 이미지 모델은 `gemini-3.1-flash-image`입니다.
- DB, 폼 검증, AI 스키마, UI의 장면 수 제한은 `src/providers/projectPanelCountConfig.ts`를 공통 기준으로 사용합니다.

## 6. 운영 배포 전 확인

- 기존 `crevena.com`, `www.crevena.com`, `yubyeol.crevena.com`은 변경하지 않습니다.
- Crevena Toon은 별도 주소인 `toon.crevena.com`에 연결합니다.
- 배포 환경에는 `.env.local` 파일을 올리지 말고 환경변수 기능으로 값을 등록합니다.
- `SUPABASE_SERVICE_ROLE_KEY`와 AI API 키는 절대 브라우저 공개 변수(`NEXT_PUBLIC_`)로 만들지 않습니다.
- SQL 마이그레이션과 관리자 계정 생성이 끝난 뒤 `npm run check`를 통과한 소스만 배포합니다.
- 실제 배포와 도메인 연결은 별도 승인 후 진행합니다.
