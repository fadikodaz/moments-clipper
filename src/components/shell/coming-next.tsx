import Link from "next/link";

/** Honest placeholder for pages that are designed in the mockups but not built yet. */
export function ComingNext({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-[-0.015em]">{title}</h1>
        <p className="mt-1.5 text-muted-foreground">{body}</p>
        <Link href="/" className="mt-4 inline-flex h-8 items-center rounded-md border bg-raised px-3 text-xs font-medium hover:bg-hover">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
