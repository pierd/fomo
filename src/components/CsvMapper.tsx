import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  columnValues,
  FIELDS,
  guessDateOrder,
  guessMapping,
  guessStatuses,
  guessUnit,
  statusValues,
  toDrafts,
  type CsvTable,
  type DateOrder,
  type Field,
  type Mapping,
  type Unit,
} from "../lib/csvMapping";
import type { Draft, Status } from "../lib/importers";
import type { Tag } from "../lib/types";
import { currentLocale } from "../i18n";
import { TagInput } from "./TagInput";

const UNITS: Unit[] = ["minutes", "hours", "seconds"];
const STATUSES: Status[] = ["active", "done", "discarded"];

// Which column is what, for a CSV from anywhere.
export function CsvMapper({
  table,
  tags,
  onParsed,
}: {
  table: CsvTable;
  tags: Tag[];
  onParsed: (drafts: Draft[], optIn: boolean) => void;
}) {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<Mapping>(() => guessMapping(table, currentLocale()));
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [optIn, setOptIn] = useState(false);
  const { columns } = mapping;

  const setColumn = (field: Field, column: string | undefined) =>
    setMapping((m) => {
      const next: Mapping = { ...m, columns: { ...m.columns, [field]: column } };
      if (field === "status") next.statuses = guessStatuses(statusValues(table, column));
      if (field === "duration") next.durationUnit = guessUnit(column);
      if (field === "played") next.playedUnit = guessUnit(column);
      if (field === "addedAt" || field === "finishedAt") {
        next.dateOrder = guessDateOrder(
          [...columnValues(table, next.columns.addedAt), ...columnValues(table, next.columns.finishedAt)],
          currentLocale(),
        );
      }
      return next;
    });

  const statuses = statusValues(table, columns.status);

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="text-sm text-muted">{t("import.csv.intro")}</div>
        {FIELDS.map((field) => {
          const column = columns[field];
          const unitKey = field === "duration" ? "durationUnit" : field === "played" ? "playedUnit" : null;
          const example = columnValues(table, column)[0];
          return (
            <div key={field} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr_1fr]">
              <label className="text-sm font-medium" htmlFor={`csv-${field}`}>
                {t(`import.csv.fields.${field}`)}
                {field === "title" && " *"}
              </label>
              <div className="flex gap-2">
                <select
                  id={`csv-${field}`}
                  className="input min-w-0 flex-1"
                  value={column ?? ""}
                  onChange={(e) => setColumn(field, e.target.value || undefined)}
                >
                  <option value="">{t("import.csv.noColumn")}</option>
                  {table.fields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                {unitKey && column !== undefined && (
                  <select
                    className="input w-auto"
                    aria-label={t("import.csv.unit")}
                    value={mapping[unitKey]}
                    onChange={(e) => setMapping((m) => ({ ...m, [unitKey]: e.target.value as Unit }))}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`import.csv.units.${u}`)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="truncate text-xs text-muted">{example && t("import.csv.example", { value: example })}</div>
            </div>
          );
        })}
        {(columns.addedAt !== undefined || columns.finishedAt !== undefined) && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            {t("import.csv.dateOrder")}
            <select
              className="input w-auto"
              value={mapping.dateOrder}
              onChange={(e) => setMapping((m) => ({ ...m, dateOrder: e.target.value as DateOrder }))}
            >
              <option value="dmy">{t("import.csv.dmy")}</option>
              <option value="mdy">{t("import.csv.mdy")}</option>
            </select>
          </label>
        )}
      </div>

      {statuses.length > 0 && (
        <div className="card max-h-72 space-y-2 overflow-y-auto p-4">
          <div className="text-sm text-muted">{t("import.csv.statuses")}</div>
          {statuses.map((s) => (
            <label key={s} className="grid grid-cols-2 items-center gap-3 text-sm">
              <span className="truncate">{s}</span>
              <select
                className="input"
                value={mapping.statuses[s] ?? "active"}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, statuses: { ...m.statuses, [s]: e.target.value as Status } }))
                }
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div>
        <span className="label">{t("import.tagEverything")}</span>
        <TagInput
          value={extraTags}
          onChange={setExtraTags}
          existing={tags.map((tag) => tag.name)}
          placeholder={t("import.optionalTags")}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-accent" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        {t("import.csv.optIn")}
      </label>
      <button
        className="btn btn-primary"
        disabled={columns.title === undefined}
        onClick={() => onParsed(toDrafts(table, mapping, extraTags), optIn)}
      >
        {t("import.csv.review")}
      </button>
    </div>
  );
}
