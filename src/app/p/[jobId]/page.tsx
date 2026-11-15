import { Suspense } from "react";
import { JobView } from "@/components/jobs/job-view";

export const metadata = { title: "Your clips | Moments" };

async function Job({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobView jobId={jobId} />;
}

export default function JobPage(props: PageProps<"/p/[jobId]">) {
  return (
    <Suspense fallback={null}>
      <Job params={props.params} />
    </Suspense>
  );
}
