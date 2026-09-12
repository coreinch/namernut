import { getDictionaryStats, parseLangs } from "@/lib/dictionary";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  return Response.json(getDictionaryStats(langs));
}
