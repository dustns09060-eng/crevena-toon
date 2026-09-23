/**
 * Storyboard AI가 캐릭터를 지칭할 때 쓰는 "안정적인 AI용 식별자".
 *
 * 이전에는 AI가 반환한 display_name 문자열(예: "엄마")을 프로젝트의
 * 캐릭터 display_name과 직접 문자열 비교해서 매칭했다. 이 방식은
 * 실제 Production에서 "알 수 없는 캐릭터 '엄마'"처럼 실패했다 —
 * 근본 원인은 두 문자열이 육안으로는 같아 보여도 유니코드 정규화
 * 형태(NFC/NFD)가 다르면 완전히 다른 바이트 시퀀스가 되기 때문이다
 * (모바일 브라우저/OS의 한글 입력기가 자모를 분리된 형태(NFD)로 만드는
 * 경우가 흔하다). 문자열 매칭을 아무리 trim/lowercase 해도 이 문제는
 * 해결되지 않는다.
 *
 * 그래서 이름 문자열 매칭 자체를 없앤다: 서버가 프로젝트의 캐릭터
 * 목록 순서대로 "CHARACTER_A", "CHARACTER_B", ... 라는 순수 ASCII
 * 식별자를 만들어 AI에게 "이 식별자만 그대로 반환하라"고 요구하고,
 * 그 식별자 → 실제 character_id 매핑은 서버가 배열 인덱스만으로
 * deterministic하게 계산한다. 텍스트 비교(정규화, trim, 대소문자)가
 * 전혀 필요 없다.
 */

const IDENTIFIER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const MAX_IDENTIFIABLE_CHARACTERS = IDENTIFIER_LETTERS.length;

export function buildCharacterIdentifier(index: number): string {
  if (index < 0 || index >= IDENTIFIER_LETTERS.length) {
    throw new Error(`캐릭터 수가 너무 많아 identifier를 만들 수 없습니다 (index=${index}).`);
  }
  return `CHARACTER_${IDENTIFIER_LETTERS[index]}`;
}

export interface IdentifiedCharacter<T> {
  identifier: string;
  character: T;
}

/**
 * 캐릭터 배열 순서대로 CHARACTER_A, CHARACTER_B, ... 식별자를 부여한다.
 * 이 순서는 프롬프트 생성과 결과 매핑에서 항상 같은 배열 인스턴스를
 * 재사용하기만 하면 되므로, DB 조회 순서가 매번 같을 필요는 없다 —
 * 한 번의 스토리보드 생성 요청 안에서만 일관되면 충분하다.
 */
export function assignCharacterIdentifiers<T>(characters: T[]): IdentifiedCharacter<T>[] {
  return characters.map((character, i) => ({ identifier: buildCharacterIdentifier(i), character }));
}

export function buildIdentifierToIdMap(identified: IdentifiedCharacter<{ id: string }>[]): Map<string, string> {
  return new Map(identified.map((entry) => [entry.identifier, entry.character.id]));
}
