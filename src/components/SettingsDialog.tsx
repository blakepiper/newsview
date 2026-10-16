import { useEffect, useRef, useState } from "react";
import {
  categories,
  categoryNames,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type Category,
  type Settings,
} from "../settings";
import { usePollingQuery } from "../hooks/usePollingQuery";

export function SettingsDialog({
  value,
  onSave,
  onClose,
}: {
  value: Settings;
  onSave: (value: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);
  const sources = usePollingQuery<Record<Category, string[]>>(
    "/api/sources",
    3600000,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function toggle(category: Category, source: string) {
    setDraft((previous) => ({
      ...previous,
      sources: {
        ...previous.sources,
        [category]: previous.sources[category].includes(source)
          ? previous.sources[category].filter((name) => name !== source)
          : [...previous.sources[category], source],
      },
    }));
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(normalizeSettings(draft));
          onClose();
        }}
      >
        <div className="settings-heading">
          <div>
            <h2>Display settings</h2>
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose}>
            [x]
          </button>
        </div>
        <div className="settings-fields">
          <label>
            Weather ZIP code
            <input
              required
              pattern="[0-9]{5}"
              inputMode="numeric"
              maxLength={5}
              value={draft.zip}
              onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
            />
          </label>
          <label>
            Seconds per story
            <input
              type="number"
              min={10}
              max={120}
              required
              value={draft.slideSeconds}
              onChange={(e) =>
                setDraft({ ...draft, slideSeconds: Number(e.target.value) })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.radarAnimation}
              onChange={(e) =>
                setDraft({ ...draft, radarAnimation: e.target.checked })
              }
            />
            Animate recent radar
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.dim}
              onChange={(e) => setDraft({ ...draft, dim: e.target.checked })}
            />
            Dim display
          </label>
        </div>
        <div className="settings-sources">
          <h3>News sources</h3>
          <p>
            Local coverage follows the sources selected here. The ZIP code sets
            weather only.
          </p>
          {categories.map((category) => (
            <details key={category}>
              <summary>
                {categoryNames[category]}
                <span>{draft.sources[category].length} selected</span>
              </summary>
              <div className="source-actions">
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sources: {
                        ...draft.sources,
                        [category]:
                          sources.data?.[category] ||
                          DEFAULT_SETTINGS.sources[category],
                      },
                    })
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sources: { ...draft.sources, [category]: [] },
                    })
                  }
                >
                  Clear
                </button>
              </div>
              <div className="source-list">
                {(
                  sources.data?.[category] || [
                    ...new Set([
                      ...DEFAULT_SETTINGS.sources[category],
                      ...draft.sources[category],
                    ]),
                  ]
                ).map((source) => (
                  <label className="check" key={source}>
                    <input
                      type="checkbox"
                      checked={draft.sources[category].includes(source)}
                      onChange={() => toggle(category, source)}
                    />
                    {source}
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
        <p className="keyboard-hint">
          Space: pause · ← / →: change story · S: settings · Alt+F4: close
          display
        </p>
        <div className="settings-footer">
          <button
            type="button"
            onClick={() => setDraft(normalizeSettings(DEFAULT_SETTINGS))}
          >
            Restore defaults
          </button>
          <button type="submit" className="primary-button">
            Save settings
          </button>
        </div>
      </form>
    </dialog>
  );
}
