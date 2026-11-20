import { deletePreset } from "@/lib/jobs";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/presets/[id]">) {
  const { id } = await ctx.params;
  await deletePreset(id);
  return Response.json({ ok: true });
}
