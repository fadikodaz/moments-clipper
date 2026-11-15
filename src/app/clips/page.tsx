import { ClipsEntry } from "@/components/clips/clips-entry";
import { projects } from "@/lib/mock-data";

export const metadata = { title: "Clips | Moments" };

export default function ClipsPage() {
  const project = projects.find((p) => p.status === "ready")!;
  return <ClipsEntry example={project} />;
}
