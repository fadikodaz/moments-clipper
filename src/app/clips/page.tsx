import { ClipsInbox } from "@/components/clips/clips-inbox";
import { projects } from "@/lib/mock-data";

export const metadata = { title: "Clips | Moments" };

export default function ClipsPage() {
  const project = projects.find((p) => p.status === "ready")!;
  return <ClipsInbox project={project} />;
}
