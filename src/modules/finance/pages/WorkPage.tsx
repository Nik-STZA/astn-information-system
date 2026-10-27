// Work: a client's tasks and sub-tasks, what blocks them, and their history
// (redesign step 3). The List view; Board and Timeline follow.

import WorkView, { type BillOption } from "@/modules/finance/components/WorkView";
import { fetchEntities } from "@/modules/finance/lib/api";
import { fetchApItems } from "@/modules/finance/lib/ap-queue";
import { fetchTasks, type Task } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

export default async function WorkPage({ params, searchParams }: {
  params: { slug: string };
  searchParams: { task?: string; view?: string };
}) {
  let tasks: Task[] = [];
  let error: string | null = null;
  let entities: Array<{ id: string; slug: string; name: string }> = [];
  const bills: BillOption[] = [];
  try {
    [tasks, entities] = await Promise.all([
      fetchTasks(params.slug),
      fetchEntities(params.slug).then((rows) => rows.map((e) => ({ id: e.id, slug: e.slug, name: e.name }))),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "The tasks could not be read";
  }
  // Open Bills items, so a task can wait for one. A slow Bills read leaves the
  // list empty rather than failing the page.
  await Promise.all(entities.map(async (e) => {
    try {
      const items = await fetchApItems(params.slug, e.slug, ["exception", "clean", "approved"]);
      for (const i of items) {
        bills.push({ id: i.id, label: `${e.name}: ${i.supplier ?? i.file_name}${i.total ? ` · ${i.currency ?? ""} ${Number(i.total).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""}` });
      }
    } catch { /* no bills to offer for this company */ }
  }));

  return <WorkView slug={params.slug} tasks={tasks} entities={entities} bills={bills} error={error} initialTask={searchParams.task ?? null}
    initialView={searchParams.view === "board" || searchParams.view === "list" ? searchParams.view : null} />;
}
