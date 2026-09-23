"use client";

import { useActionState, useState } from "react";
import type { LocationActionState } from "../../../lib/locations/actions";
import type { ToonLocation } from "../../../src/db/types";

const initialState: LocationActionState = { ok: true };

/**
 * 생성/수정 공용 폼. 사용자가 반드시 입력해야 하는 값은 이름 + 설명
 * 뿐이고, 나머지("고급 설정")는 기본적으로 접혀 있다 — Character
 * Bible처럼 여러 영어 프롬프트 필드를 강제하지 않는다.
 */
export default function LocationForm({
  action,
  location,
  submitLabel,
}: {
  action: (prevState: LocationActionState, formData: FormData) => Promise<LocationActionState>;
  location?: ToonLocation;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      location &&
        (location.wall_and_floor ||
          location.fixed_furniture ||
          location.window_style ||
          location.recurring_props ||
          location.distinctive_features)
    )
  );

  return (
    <form action={formAction}>
      {!state.ok && state.message && <div className="banner banner-error">{state.message}</div>}

      <div className="field">
        <label htmlFor="display_name">장소 이름 *</label>
        <input
          id="display_name"
          name="display_name"
          className="input"
          placeholder="예: 우리 집 거실"
          defaultValue={location?.display_name}
          required
          maxLength={50}
        />
        {state.errors?.display_name && <p className="error">{state.errors.display_name}</p>}
      </div>

      <div className="field">
        <label htmlFor="visual_prompt">설명 *</label>
        <textarea
          id="visual_prompt"
          name="visual_prompt"
          className="textarea"
          placeholder="예: 회색 소파가 있고 밝은 원목 바닥, 아이보리 러그와 낮은 책장이 있는 거실"
          defaultValue={location?.visual_prompt}
          required
          maxLength={500}
        />
        {state.errors?.visual_prompt && <p className="error">{state.errors.visual_prompt}</p>}
        <p className="hint">
          이 장소가 앞으로 여러 화(에피소드)에서 계속 같은 모습으로 나오는 기준이 됩니다.
        </p>
      </div>

      {!showAdvanced ? (
        <button type="button" className="btn" onClick={() => setShowAdvanced(true)}>
          고급 설정 (선택)
        </button>
      ) : (
        <>
          <div className="field">
            <label htmlFor="wall_and_floor">벽/바닥 (선택)</label>
            <input
              id="wall_and_floor"
              name="wall_and_floor"
              className="input"
              placeholder="예: 크림색 벽, 밝은 원목 바닥"
              defaultValue={location?.wall_and_floor ?? ""}
              maxLength={300}
            />
          </div>

          <div className="field">
            <label htmlFor="fixed_furniture">고정 가구 (선택)</label>
            <input
              id="fixed_furniture"
              name="fixed_furniture"
              className="input"
              placeholder="예: 회색 패브릭 3인용 소파, 낮은 원목 책장"
              defaultValue={location?.fixed_furniture ?? ""}
              maxLength={300}
            />
          </div>

          <div className="field">
            <label htmlFor="window_style">창문 (선택)</label>
            <input
              id="window_style"
              name="window_style"
              className="input"
              placeholder="예: 큰 창문, 흰색 커튼"
              defaultValue={location?.window_style ?? ""}
              maxLength={300}
            />
          </div>

          <div className="field">
            <label htmlFor="recurring_props">자주 나오는 소품 (선택)</label>
            <input
              id="recurring_props"
              name="recurring_props"
              className="input"
              placeholder="예: 화분, 액자"
              defaultValue={location?.recurring_props ?? ""}
              maxLength={300}
            />
          </div>

          <div className="field">
            <label htmlFor="distinctive_features">기타 특징 (선택)</label>
            <input
              id="distinctive_features"
              name="distinctive_features"
              className="input"
              defaultValue={location?.distinctive_features ?? ""}
              maxLength={300}
            />
          </div>
        </>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "저장 중..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
