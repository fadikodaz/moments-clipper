import { notFound } from "next/navigation";
import { ComingNext } from "@/components/shell/coming-next";
import { clips } from "@/lib/mock-data";

export function generateStaticParams() {
  return clips.map((c) => ({ clipId: c.id }));
}

export async function generateMetadata(props: PageProps<"/clips/[clipId]/edit">) {
  const { clipId } = await props.params;
  const clip = clips.find((c) => c.id === clipId);
  return { title: clip ? `Edit: ${clip.title} | Moments` : "Clip not found | Moments" };
}

export default async function EditClipPage(props: PageProps<"/clips/[clipId]/edit">) {
  const { clipId } = await props.params;
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) notFound();

  return (
    <ComingNext
      title={`Editor: ${clip.title}`}
      body="Trim, framing, captions and audio come in the editor step. Your Keep and Remove choices are kept on the Clips page."
      backHref="/clips"
      backLabel="Back to Clips"
    />
  );
}
