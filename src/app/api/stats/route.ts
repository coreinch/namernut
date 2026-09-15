import { parseKeyword } from "@/lib/candidates";
import { getDictionaryStats, parseLangs, parseMaxLength } from "@/lib/dictionary";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const maxLength = parseMaxLength(searchParams.get("maxLength"));
  const keyword = parseKeyword(searchParams.get("keyword"));
  return Response.json(getDictionaryStats(langs, maxLength, keyword));
}
