export function activityUrl(baseUrl: string, activityId: number, locale: string): string {
  const origin = baseUrl.replace(/\/$/, "");
  void locale;
  return `${origin}/activities/${activityId}`;
}
