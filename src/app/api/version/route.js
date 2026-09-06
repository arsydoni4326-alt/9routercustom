import { checkForUpdate } from "@/lib/updateNotifier";

export const dynamic = "force-dynamic";

// Latest version is read from the custom fork repository
// (github.com/arsydoni4326-alt/9routercustom) instead of the npm registry.
export async function GET() {
  return Response.json(await checkForUpdate());
}
