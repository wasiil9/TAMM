const ids = ["today", "month", "year", "total"] as const;
const status = document.querySelector<HTMLElement>("#status")!;
const updated = document.querySelector<HTMLElement>("#updated")!;

async function loadStats() {
  status.hidden = true;
  try {
    const response = await fetch("/api/visit", { cache: "no-store" });
    if (!response.ok) throw new Error("stats unavailable");
    const stats = await response.json();
    ids.forEach((id) => { document.querySelector<HTMLElement>(`#${id}`)!.textContent = Number(stats[id] || 0).toLocaleString("ar"); });
    updated.textContent = `آخر تحديث: ${new Date(stats.updatedAt).toLocaleString("ar")}`;
    if (stats.configured === false) {
      status.textContent = "اربط DATABASE_URL في Render لتبدأ الأرقام الحقيقية.";
      status.hidden = false;
    }
  } catch {
    status.textContent = "تعذّر تحميل الإحصاءات الآن.";
    status.hidden = false;
  }
}

document.querySelector("#refresh")?.addEventListener("click", loadStats);
void loadStats();
