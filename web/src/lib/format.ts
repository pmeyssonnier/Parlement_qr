// Display helpers shared with the client bundle: keep this module free of
// runtime dependencies (no zod, no server code).
const longDate = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeZone: "UTC" });

export function shortTitle(title: string) { return title.replace(/^Question écrite concernant /i, ""); }
export function dateLabel(date: string | null) {
  return date ? longDate.format(new Date(date)) : "date non renseignée";
}
