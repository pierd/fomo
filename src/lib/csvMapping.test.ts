import { describe, expect, it } from "vitest";
import { guessDateOrder, guessMapping, parseDate, parseTime, readTable, toDrafts } from "./csvMapping";

describe("CSV mapping", () => {
  it("guesses columns and reads a game library", () => {
    const table = readTable(
      "Name;Developers;Release Date;Genres;Completion Status;Playtime;Added;Last Played;Source\n" +
        "Hades;Supergiant;2020-09-17;Roguelike, Action;Beaten;7200;2021-01-02;15/03/2022;Epic\n" +
        "Dota 2;Valve;;;Abandoned;;;;Steam\n;x;;;;;;;\n",
    );
    const mapping = guessMapping(table, "en");
    expect(mapping.columns).toMatchObject({ title: "Name", creator: "Developers", played: "Playtime", status: "Completion Status" });
    expect(mapping.dateOrder).toBe("dmy");
    const drafts = toDrafts(table, { ...mapping, playedUnit: "seconds" }, ["games"]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      title: "Hades",
      year: 2020,
      tagNames: ["games", "roguelike", "action"],
      status: "done",
      playedMinutes: 120,
      addedAt: Date.UTC(2021, 0, 2),
      finishedAt: Date.UTC(2022, 2, 15),
      source: "Epic",
      kind: "game",
    });
    expect(drafts[1]).toMatchObject({ status: "discarded", playedMinutes: 0 });
  });

  it("reads dates in either order and ignores placeholders", () => {
    expect(parseDate("03/04/2023", "dmy")).toBe(Date.UTC(2023, 3, 3));
    expect(parseDate("03/04/2023", "mdy")).toBe(Date.UTC(2023, 2, 4));
    expect(parseDate("31/02/2023", "dmy")).toBeUndefined();
    expect(parseDate("0001-01-01", "dmy")).toBeUndefined();
    expect(parseDate("12345", "dmy")).toBeUndefined();
    expect(guessDateOrder(["01/02/2020", "01/13/2020"], "pl")).toBe("mdy");
  });

  it("reads times", () => {
    expect(parseTime("1.5", "hours")).toEqual({ minutes: 90 });
    expect(parseTime("2h 30m", "seconds")).toEqual({ minutes: 150 });
    expect(parseTime("01:30:20", "minutes")).toEqual({ minutes: 90 });
    expect(parseTime("n/a", "minutes")).toEqual({ na: true });
  });
});
