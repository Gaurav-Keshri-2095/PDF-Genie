import { FileText, MessagesSquare, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonClasses } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

const features = [
  {
    icon: Sparkles,
    title: "Summaries on upload",
    body: "Every PDF is read, indexed, and summarised in 3-5 sentences the moment it lands.",
  },
  {
    icon: MessagesSquare,
    title: "Ask the document",
    body: "Hybrid retrieval finds the passages that answer your question, and the answer cites its pages.",
  },
  {
    icon: Share2,
    title: "Share without accounts",
    body: "Send a link. The recipient reads the PDF and comments without signing up for anything.",
  },
];

export default async function Home() {
  // Signed-in visitors have no reason to see the marketing page.
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-2 text-accent">
        <FileText className="size-5" />
        <span className="text-sm font-semibold tracking-tight">PDF Genie</span>
      </div>

      <h1 className="mt-8 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Read less. Understand more.
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground">
        Upload a PDF and get a summary worth reading, a chat that answers from the document itself,
        and a share link your collaborators can comment on without creating an account.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/signup" className={buttonClasses("primary", "md", "px-5")}>
          Create an account
        </Link>
        <Link href="/login" className={buttonClasses("secondary", "md", "px-5")}>
          Sign in
        </Link>
      </div>

      <dl className="mt-16 grid gap-6 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="space-y-2">
            <Icon className="size-5 text-accent" />
            <dt className="text-sm font-medium text-foreground">{title}</dt>
            <dd className="text-sm text-muted-foreground">{body}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
