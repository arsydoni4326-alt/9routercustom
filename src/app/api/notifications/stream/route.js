import { checkForUpdate, onUpdateAvailable } from "@/lib/updateNotifier";

export const dynamic = "force-dynamic";

// SSE stream that pushes update notifications to the dashboard.
// The server polls the custom fork repo's latest git tag and broadcasts an
// event whenever a newer tag comes in (see src/lib/updateNotifier.js).
export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, unsubscribe: null };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (info) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(info)}\n\n`));
        } catch {
          /* client gone; cancel() will clean up */
        }
      };

      state.unsubscribe = onUpdateAvailable(send);

      // Initial check: if an update is already known (or available now), push it
      // immediately so the popup also appears on dashboard load, not only after
      // the next incoming task.
      const info = await checkForUpdate();
      if (info.hasUpdate) send(info);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      clearInterval(state.keepalive);
      if (state.unsubscribe) state.unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}