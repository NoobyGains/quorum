async function getGreeting(): Promise<{ message: string; shipped_at: string }> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/hello`, { cache: "no-store" });
  if (!res.ok) {
    return { message: "(api unreachable)", shipped_at: new Date().toISOString() };
  }
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
