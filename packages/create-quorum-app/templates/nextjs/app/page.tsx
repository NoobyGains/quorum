// Server component. The /api/hello route handler is imported and called
// directly — no HTTP hop, no reliance on a particular port or host. The
// route is still a real endpoint for browser clients, but the starter
// page renders without needing the server to talk to itself.
import { GET } from "./api/hello/route";

async function getGreeting(): Promise<{ message: string; shipped_at: string }> {
  const res = GET();
  return res.json();
}

export default async function Page() {
  const { message, shipped_at } = await getGreeting();
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>{message}</h1>
      <p style={{ opacity: 0.6 }}>shipped at {shipped_at}</p>
      <p style={{ marginTop: "2rem", opacity: 0.75 }}>
        This page was scaffolded by <code>create-quorum-app</code>. Ask your
        agents to add a feature — they&rsquo;ll write a Plan artifact first,
        cross-review each other&rsquo;s work, and only then change code.
      </p>
    </main>
  );
}
