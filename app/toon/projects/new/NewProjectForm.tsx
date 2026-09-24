"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { createProjectAction, type CreateProjectState } from "../../../../lib/projects/actions";
import { generateIdeasAction } from "../../../../lib/projects/ideas";
import { createSeriesAction } from "../../../../lib/series/actions";
import {
  MAX_CHARACTERS_PER_PANEL,
  PROJECT_DEFAULT_PANEL_COUNT,
  PROJECT_TOTAL_PANEL_COUNT_MAX,
  PROJECT_TOTAL_PANEL_COUNT_MIN,
} from "../../../../src/providers/projectPanelCountConfig";
import type { StoryIdea } from "../../../../src/providers/storyboardSchema";

const initialState: CreateProjectState = { ok: true };

interface CharacterOption {
  id: string;
  display_name: string;
  role: string;
}

interface SeriesOption {
  id: string;
  title: string;
}

const INDEPENDENT_PROJECT = "__independent__";
const NEW_SERIES = "__new__";

export default function NewProjectForm({
  characters,
  series,
  seriesCharacterIds,
}: {
  characters: CharacterOption[];
  series: SeriesOption[];
  seriesCharacterIds: Record<string, string[]>;
}) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  const [title, setTitle] = useState("");
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"has" | "none">("has");
  const [topicText, setTopicText] = useState("");
  const [ideas, setIdeas] = useState<StoryIdea[] | null>(null);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState<number | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [ideaPending, startIdeaTransition] = useTransition();
  const [panelCount, setPanelCount] = useState(PROJECT_DEFAULT_PANEL_COUNT);

  const [seriesList, setSeriesList] = useState<SeriesOption[]>(series);
  const [seriesCharMap, setSeriesCharMap] = useState<Record<string, string[]>>(seriesCharacterIds);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(INDEPENDENT_PROJECT);
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [creatingSeries, startCreatingSeries] = useTransition();

  const seriesCharacterIdSet = new Set(
    selectedSeriesId !== INDEPENDENT_PROJECT && selectedSeriesId !== NEW_SERIES ? seriesCharMap[selectedSeriesId] ?? [] : []
  );

  function handleSelectSeries(value: string) {
    setSelectedSeriesId(value);
    setSeriesError(null);
    if (value !== INDEPENDENT_PROJECT && value !== NEW_SERIES) {
      // 시리즈를 고르면 그 시리즈의 캐릭터를 기본 선택해 매번 다시 체크하지 않게 한다.
      setSelectedCharIds(seriesCharMap[value] ?? []);
    }
  }

  function handleCreateSeries() {
    setSeriesError(null);
    const trimmed = newSeriesTitle.trim();
    if (trimmed.length === 0) {
      setSeriesError("시리즈 제목을 입력해주세요.");
      return;
    }
    startCreatingSeries(async () => {
      const result = await createSeriesAction(trimmed);
      if (result.ok && result.series) {
        setSeriesList((prev) => [...prev, { id: result.series!.id, title: result.series!.title }]);
        setSeriesCharMap((prev) => ({ ...prev, [result.series!.id]: [] }));
        setSelectedSeriesId(result.series.id);
        setNewSeriesTitle("");
      } else {
        setSeriesError(result.message ?? "시리즈 생성에 실패했습니다.");
      }
    });
  }

  function toggleCharacter(id: string) {
    // 여기서 고르는 것은 "이 에피소드에 등장 가능한" 캐릭터 목록(Episode
    // Characters)이다 — 한 장면(Panel)에 동시에 나오는 인원 제한(최대
    // 4명)은 스토리보드 편집 화면에서 컷 단위로 적용되므로 여기서는
    // 인원 수를 제한하지 않는다.
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
        <label htmlFor="series_select">시리즈</label>
        <select
          id="series_select"
          className="input"
          value={selectedSeriesId}
          onChange={(e) => handleSelectSeries(e.target.value)}
        >
          <option value={INDEPENDENT_PROJECT}>독립 프로젝트 (시리즈 없음)</option>
          {seriesList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
          <option value={NEW_SERIES}>+ 새 시리즈 만들기</option>
        </select>
        {selectedSeriesId !== INDEPENDENT_PROJECT && (
          <input type="hidden" name="series_id" value={selectedSeriesId === NEW_SERIES ? "" : selectedSeriesId} />
        )}

        {selectedSeriesId === NEW_SERIES && (
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <input
              className="input"
              placeholder="예: 유별맘"
              value={newSeriesTitle}
              onChange={(e) => setNewSeriesTitle(e.target.value)}
              maxLength={80}
            />
            <button type="button" className="btn" onClick={handleCreateSeries} disabled={creatingSeries}>
              {creatingSeries ? "만드는 중..." : "만들기"}
            </button>
          </div>
        )}
        {seriesError && <p className="error">{seriesError}</p>}
      </div>

      <div className="field">
        <label>등장인물 * (최소 1명 — 이 에피소드에 나올 수 있는 캐릭터. 한 장면당 최대 {MAX_CHARACTERS_PER_PANEL}명은 스토리보드에서 정합니다)</label>
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
              {seriesCharacterIdSet.has(c.id) && (
                <span style={{ color: "var(--color-primary)", fontSize: 12 }}> · 시리즈 등장인물</span>
              )}
            </span>
          </label>
        ))}
        {characters.length === 0 && (
          <p className="hint">등록된 캐릭터가 없습니다. 새로운 등장인물을 먼저 만들어주세요.</p>
        )}
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
        <label htmlFor="panel_count">총 이미지 수 (표지 포함 {panelCount}장)</label>
        <input
          id="panel_count"
          type="range"
          name="panel_count"
          min={PROJECT_TOTAL_PANEL_COUNT_MIN}
          max={PROJECT_TOTAL_PANEL_COUNT_MAX}
          value={panelCount}
          onChange={(e) => setPanelCount(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <p className="hint">
          표지 1장 + 본문 {panelCount - 1}장 = 총 {panelCount}장 (표지 포함 최소 {PROJECT_TOTAL_PANEL_COUNT_MIN}장 ~
          최대 {PROJECT_TOTAL_PANEL_COUNT_MAX}장)
        </p>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
          {pending ? "만드는 중..." : "프로젝트 만들기"}
        </button>
      </div>
    </form>
  );
}
