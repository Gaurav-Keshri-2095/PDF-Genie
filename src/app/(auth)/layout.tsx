import { FileText } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 text-accent">
        <FileText className="size-5" />
        <span className="text-sm font-semibold tracking-tight">PDF Genie</span>
      </Link>
      {children}
    </main>
  );
}
