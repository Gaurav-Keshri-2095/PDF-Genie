import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useCallback, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

export function useTour(userId: string, hasCompletedTour: boolean) {
  const markedComplete = useRef(false);
  const activeTour = useRef<any>(null);

  const markComplete = useCallback(async () => {
    if (markedComplete.current || hasCompletedTour) return;
    markedComplete.current = true;

    try {
      const supabase = createClient();
      await supabase.from("profiles").update({ has_completed_tour: true }).eq("id", userId);
    } catch (e) {
      console.error("Failed to mark tour as complete", e);
    }
  }, [hasCompletedTour, userId]);

  const startUploadTour = useCallback(() => {
    if (hasCompletedTour || markedComplete.current || activeTour.current) return;

    const tour = driver({
      showProgress: false,
      steps: [
        {
          element: "#tour-upload-dropzone",
          popover: {
            title: "Welcome to PDF Genie!",
            description: "Upload your first PDF here to get started.",
            side: "bottom",
            align: "start",
          },
        },
      ],
      onDestroyed: () => {
        activeTour.current = null;
      },
    });

    activeTour.current = tour;
    tour.drive();
  }, [hasCompletedTour]);

  const startDocumentCardTour = useCallback(() => {
    if (hasCompletedTour || markedComplete.current || activeTour.current) return;

    const tour = driver({
      showProgress: false,
      steps: [
        {
          element: "#tour-document-card",
          popover: {
            title: "Document processing",
            description: "Great! Your document is being processed. Click on it to open the workspace.",
            side: "top",
            align: "start",
          },
        },
      ],
      onDestroyed: () => {
        activeTour.current = null;
      },
    });

    activeTour.current = tour;
    tour.drive();
  }, [hasCompletedTour]);

  const startWorkspaceTour = useCallback(() => {
    if (hasCompletedTour || markedComplete.current || activeTour.current) return;

    const tour = driver({
      showProgress: true,
      allowClose: true,
      steps: [
        {
          element: "#tour-ai-chat",
          popover: {
            title: "AI Chat",
            description: "Ask questions about your document here. Our AI has read it and will answer based on its contents.",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-comments",
          popover: {
            title: "Comments",
            description: "Click here to leave comments on specific pages. Great for collaboration!",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-share",
          popover: {
            title: "Share",
            description: "Share this document with others to collaborate in real-time.",
            side: "bottom",
            align: "end",
          },
        },
        {
          element: "#tour-pdf",
          popover: {
            title: "PDF Viewer",
            description: "Read your document, zoom in, or jump to specific pages.",
            side: "left",
            align: "start",
          },
        },
      ],
      onDestroyed: () => {
        activeTour.current = null;
        void markComplete();
      },
    });

    activeTour.current = tour;

    // Slight delay to ensure the viewer is mounted
    setTimeout(() => {
      if (activeTour.current === tour) {
        tour.drive();
      }
    }, 500);
  }, [hasCompletedTour, markComplete]);

  return { startUploadTour, startDocumentCardTour, startWorkspaceTour };
}
