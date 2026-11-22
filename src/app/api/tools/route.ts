import "@/tools";
import { toolCatalog } from "@/platform/tools";

/** The catalogue with JSON Schema inputs. Not secret: it describes the API, not the data. */
export function GET() {
  return Response.json({ tools: toolCatalog() });
}
