/**
 * Storyboard AI가 장소(Location)를 지칭할 때 쓰는 "안정적인 AI용 식별자".
 *
 * characterIdentifier.ts와 완전히 동일한 이유로 존재한다 — display_name
 * 문자열("우리 집 거실")을 AI 구조화 필드에 직접 쓰게 하면 유니코드
 * 정규화(NFC/NFD) 문제로 매칭이 실패할 수 있다. 그래서 서버가 그
 * 시리즈의 Location Set 배열 순서대로 "LOCATION_A", "LOCATION_B", ...
 * 라는 순수 ASCII 식별자를 만들어 AI에게 그 식별자만 반환하라고
 * 요구하고, 식별자 → 실제 location_id 매핑은 서버가 배열 인덱스만으로
 * deterministic하게 계산한다.
 *
 * LOCATION_A/B/C는 매 Storyboard 생성 요청마다 부여되는 임시 식별자일
 * 뿐, DB의 영구 ID가 아니다 — 영구 ID는 항상 toon_locations.id(uuid)다.
 */

const IDENTIFIER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const MAX_IDENTIFIABLE_LOCATIONS = IDENTIFIER_LETTERS.length;

export function buildLocationIdentifier(index: number): string {
  if (index < 0 || index >= IDENTIFIER_LETTERS.length) {
    throw new Error(`장소 수가 너무 많아 identifier를 만들 수 없습니다 (index=${index}).`);
  }
  return `LOCATION_${IDENTIFIER_LETTERS[index]}`;
}

export interface IdentifiedLocation<T> {
  identifier: string;
  location: T;
}

/**
 * 장소 배열 순서대로 LOCATION_A, LOCATION_B, ... 식별자를 부여한다.
 * characterIdentifier.assignCharacterIdentifiers와 동일한 계약: 한 번의
 * 스토리보드 생성 요청 안에서만 순서가 일관되면 충분하다.
 */
export function assignLocationIdentifiers<T>(locations: T[]): IdentifiedLocation<T>[] {
  return locations.map((location, i) => ({ identifier: buildLocationIdentifier(i), location }));
}

export function buildLocationIdentifierToIdMap(
  identified: IdentifiedLocation<{ id: string }>[]
): Map<string, string> {
  return new Map(identified.map((entry) => [entry.identifier, entry.location.id]));
}
