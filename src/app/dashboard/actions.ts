"use server";

import { grantForOwner } from "@/lib/handlers/access";
import { createServiceClient, storageBucket } from "@/lib/supabase/service";

export async function deleteDocumentAction(id: string) {
  const grant = await grantForOwner(id);
  if (!grant) return { error: "Not authorized" };

  const supabase = createServiceClient();

  const { data: document } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .single();

  if (document?.storage_path) {
    await supabase.storage.from(storageBucket()).remove([document.storage_path]);
  }

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
