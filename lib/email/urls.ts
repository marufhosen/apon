export function activityUrl(baseUrl: string, activityId: number, locale: string): string {
  const origin = baseUrl.replace(/\/$/, "");
  const language = locale === "bn" ? "bn" : "en";
  return `${origin}/${language}/activities/${activityId}`;
}
