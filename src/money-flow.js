import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runsDir = join(root, "data", "money-flow-runs");
const historyPath = join(root, "data", "money-flow-search-history.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function listMoneyFlowRuns() {
  const files = (await readdir(runsDir)).filter((f) => f.endsWith(".json")).sort().reverse();
  const runs = [];
  for (const file of files.slice(0, 24)) {
    const data = await readJson(join(runsDir, file));
    runs.push({
      file,
      run_key: data.run_key,
      mode: data.mode,
      threshold_crossed: data.threshold_crossed,
      leader_id: data.current_leader?.id,
      leader_name: data.current_leader?.name,
      score: data.current_leader?.score,
      max_score: data.current_leader?.max_score,
      promotions: data.candidate_events?.promotions?.length || 0,
      demotions: data.candidate_events?.demotions?.length || 0,
      rejections: data.candidate_events?.rejections?.length || 0,
    });
  }
  return runs;
}

export async function latestMoneyFlow() {
  const [history, runs] = await Promise.all([
    readJson(historyPath).catch(() => null),
    listMoneyFlowRuns(),
  ]);
  const latestFile = runs[0]?.file;
  const latest = latestFile ? await readJson(join(runsDir, latestFile)) : null;
  return { history, latest, runs };
}
