import { CaptionLine } from "@/components/home/caption-line";
import { Intake } from "@/components/home/intake";
import { KeyGate } from "@/components/home/key-gate";
import { RecentProjects } from "@/components/home/recent";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[1120px] px-4 pt-6 pb-[130px] md:px-10 md:pt-12 md:pb-[120px]">
      <section className="mx-auto max-w-[760px]">
        <CaptionLine words={["Paste", "a", "stream.", "Get", "the", "shorts."]} />
      </section>
      <KeyGate>
        <Intake />
        <RecentProjects />
      </KeyGate>
    </div>
  );
}
