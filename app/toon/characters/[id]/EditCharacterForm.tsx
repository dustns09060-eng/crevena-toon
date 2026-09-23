"use client";

import { useActionState } from "react";
import { updateCharacterAction, type ActionState } from "../../../../lib/characters/actions";
import type { ToonCharacter } from "../../../../src/db/types";

const initialState: ActionState = { ok: true };

export default function EditCharacterForm({ character }: { character: ToonCharacter }) {
  const boundAction = updateCharacterAction.bind(null, character.id);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction}>
      {!state.ok && state.message && <div className="banner banner-error">{state.message}</div>}

      <div className="field">
        <label htmlFor="display_name">캐릭터 이름 *</label>
        <input
          id="display_name"
          name="display_name"
          className="input"
          defaultValue={character.display_name}
          required
          maxLength={50}
        />
        {state.errors?.display_name && <p className="error">{state.errors.display_name}</p>}
      </div>

      <div className="field">
        <label htmlFor="role">역할 *</label>
        <input
          id="role"
          name="role"
          className="input"
          defaultValue={character.role ?? ""}
          required
          maxLength={50}
        />
        {state.errors?.role && <p className="error">{state.errors.role}</p>}
      </div>

      <div className="field">
        <label htmlFor="personality">성격 (선택)</label>
        <textarea
          id="personality"
          name="personality"
          className="textarea"
          defaultValue={character.personality ?? ""}
          maxLength={500}
        />
      </div>

      <div className="field">
        <label htmlFor="speaking_style">말투 (선택)</label>
        <textarea
          id="speaking_style"
          name="speaking_style"
          className="textarea"
          defaultValue={character.speaking_style ?? ""}
          maxLength={500}
        />
      </div>

      <div className="field">
        <label htmlFor="representative_outfit">대표 의상 메모 (선택)</label>
        <textarea
          id="representative_outfit"
          name="representative_outfit"
          className="textarea"
          defaultValue={character.representative_outfit ?? ""}
          maxLength={500}
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
