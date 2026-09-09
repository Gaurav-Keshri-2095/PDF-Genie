"use client";

import { Check, Trash2, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { deleteDocumentAction } from "@/app/dashboard/actions";
import { Spinner } from "@/components/ui";

export function DeleteButton({ id, onDeleted }: { id: string; onDeleted?: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowConfirm(false);
      }
    }
    if (showConfirm) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showConfirm]);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteDocumentAction(id);
    if (result.error) {
      alert(result.error);
      setIsDeleting(false);
      setShowConfirm(false);
    } else {
      onDeleted?.();
    }
  };

  if (showConfirm) {
    return (
      <div 
        ref={containerRef}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-md"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="px-1 text-xs font-medium text-muted-foreground">Delete?</span>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label="Confirm delete"
        >
          {isDeleting ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />}
        </button>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          onClick={() => setShowConfirm(false)}
          disabled={isDeleting}
          aria-label="Cancel delete"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      className="absolute right-2 top-2 z-10 rounded p-2 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowConfirm(true);
      }}
      aria-label="Delete document"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
