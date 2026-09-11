import { getDictionaryStats, parseLangs, parseShortOnly } from "@/lib/dictionary";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const shortOnly = parseShortOnly(searchParams.get("len"));
  return Response.json(getDictionaryStats(langs, shortOnly));
}
