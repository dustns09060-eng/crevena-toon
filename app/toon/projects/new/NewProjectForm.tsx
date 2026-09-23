"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { createProjectAction, type CreateProjectState } from "../../../../lib/projects/actions";
import { generateIdeasAction } from "../../../../lib/projects/ideas";
import type { StoryIdea } from "../../../../src/providers/storyboardSchema";

const initialState: CreateProjectState = { ok: true };

interface CharacterOption {
  id: string;
  display_name: string;
  role: string;
}

export default function NewProjectForm({ characters }: { characters: CharacterOption[] }) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  const [title, setTitle] = useState("");
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"has" | "none">("has");
  const [topicText, setTopicText] = useState("");
  const [ideas, setIdeas] = useState<StoryIdea[] | null>(null);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState<number | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [ideaPending, startIdeaTransition] = useTransition();
  const [panelCount, setPanelCount] = useState<6 | 8 | 10>(8);

  function toggleCharacter(id: string) {
    setSelectedCharIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleRecommend() {
    setIdeaError(null);
    if (selectedCharIds.length === 0) {
      setIdeaError("캐릭터를 먼저 선택해주세요.");
      return;
    }
    startIdeaTransition(async () => {
      const result = await generateIdeasAction(selectedCharIds);
      if (result.ok && result.ideas) {
        setIdeas(result.ideas);
        setSelectedIdeaIndex(null);
      } else {
        setIdeaError(result.message ?? "소재 추천에 실패했습니다.");
      }
    });
  }

  const effectiveTopic = useMemo(() => {
    if (mode === "has") return topicText.trim();
    if (selectedIdeaIndex !== null && ideas) {
      const idea = ideas[selectedIdeaIndex];
      return `${idea.title}: ${idea.description}`;
    }
    return "";
  }, [mode, topicText, ideas, selectedIdeaIndex]);

  const canSubmit = title.trim().length > 0 && selectedCharIds.length > 0 && effectiveTopic.length > 0;

  return (
    <form action={formAction}>
      {!state.ok && state.message && <div className="banner banner-error">{state.message}</div>}

      <div className="field">
        <label htmlFor="title">프로젝트 제목 *</label>
        <input
          id="title"
          name="title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
        />
        {state.errors?.title && <p className="error">{state.errors.title}</p>}
      </div>

      <div className="field">
        <label>등장 캐릭터 * (최소 1명)</label>
        {characters.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <input
              type="checkbox"
              name="character_ids"
              value={c.id}
              checked={selectedCharIds.includes(c.id)}
              onChange={() => toggleCharacter(c.id)}
            />
            <span>
              {c.display_name} <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>({c.role})</span>
            </span>
          </label>
        ))}
        {state.errors?.character_ids && <p className="error">{state.errors.character_ids}</p>}
      </div>

      <div className="field">
        <label>소재</label>
        <div className="form-actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <button
            type="button"
            className={mode === "has" ? "btn btn-primary" : "btn"}
            onClick={() => setMode("has")}
          >
            소재가 있어요
          </button>
          <button
            type="button"
            className={mode === "none" ? "btn btn-primary" : "btn"}
            onClick={() => setMode("none")}
          >
            소재가 없어요 ✨
          </button>
        </div>

        {mode === "has" ? (
          <textarea
            className="textarea"
            placeholder="예: 아이가 잠들어서 드디어 커피 마시려고 했는데 컵을 드는 순간 둘째가 깨어났다."
            value={topicText}
            onChange={(e) => setTopicText(e.target.value)}
            maxLength={1000}
          />
        ) : (
          <div>
            <button
              type="button"
              className="btn btn-block"
              onClick={handleRecommend}
              disabled={ideaPending}
            >
              {ideaPending ? "추천 받는 중..." : ideas ? "다시 추천" : "소재 추천받기"}
            </button>
            {ideaError && <p className="error">{ideaError}</p>}

            {ideas && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {ideas.map((idea, i) => (
                  <label
                    key={i}
                    className="card"
                    style={{
                      margin: 0,
                      cursor: "pointer",
                      borderColor: selectedIdeaIndex === i ? "var(--color-primary)" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="idea_choice"
                        checked={selectedIdeaIndex === i}
                        onChange={() => setSelectedIdeaIndex(i)}
                        style={{ marginTop: 4 }}
                      />
                      <div>
                        <div style={{ fontWeight: 700 }}>{idea.title}</div>
                        <div style={{ fontSize: 14, color: "var(--color-text-muted)" }}>{idea.description}</div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <input type="hidden" name="topic" value={effectiveTopic} />
        {state.errors?.topic && <p className="error">{state.errors.topic}</p>}
      </div>

      <div className="field">
        <label>컷 수</label>
        <div style={{ display: "flex", gap: 8 }}>
          {([6, 8, 10] as const).map((n) => (
            <label
              key={n}
              className="btn"
              style={{
                flex: 1,
                cursor: "pointer",
                background: panelCount === n ? "var(--color-primary)" : undefined,
                color: panelCount === n ? "#fff" : undefined,
                borderColor: panelCount === n ? "var(--color-primary)" : undefined,
              }}
            >
              <input
                type="radio"
                name="panel_count"
                value={n}
                checked={panelCount === n}
                onChange={() => setPanelCount(n)}
                style={{ display: "none" }}
              />
              {n}컷
            </label>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
          {pending ? "만드는 중..." : "프로젝트 만들기"}
        </button>
      </div>
    </form>
  );
}
