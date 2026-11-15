import { SceneThumb } from "@/components/media/scene-thumb";
import type { Clip } from "@/lib/mock-data";

/** Real poster frame when the engine made one, otherwise the drawn placeholder. */
export function ClipThumb({ clip }: { clip: Pick<Clip, "kind" | "seed" | "posterUrl" | "title"> }) {
  if (clip.posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- local files served by our own route; next/image adds nothing here yet
    return <img src={clip.posterUrl} alt="" loading="lazy" className="block h-full w-full object-cover" />;
  }
  return <SceneThumb kind={clip.kind} seed={clip.seed} orientation="vertical" />;
}
