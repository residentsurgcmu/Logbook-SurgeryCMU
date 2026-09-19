import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { residentTemplates } from "../src/generated/residentTemplates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = path.join(
  root,
  "supabase/migrations/20260919095717_rebuild_resident_epa_pba_catalog.sql",
);
const start = "-- BEGIN GENERATED CATALOG";
const end = "-- END GENERATED CATALOG";
const original = readFileSync(migration, "utf8");
if (!original.includes(start) || !original.includes(end))
  throw new Error("Catalog markers missing");
const payload = JSON.stringify(residentTemplates);
if (payload.includes("$catalog_json$"))
  throw new Error("Unexpected SQL delimiter in catalog");
const sql = `do $catalog_seed$
declare
  item jsonb;
  criterion jsonb;
  template_id uuid;
begin
  for item in select value from jsonb_array_elements($catalog_json$${payload}$catalog_json$::jsonb) loop
    insert into public.resident_template_definitions (
      template_code, template_type, title, source_file, source_hash,
      score_options, score_legend, outcome_options, max_attempts,
      requires_self_assessment, recommended_pgy, active
    ) values (
      item->>'code', item->>'type', item->>'title', item->>'sourceFile', item->>'sourceHash',
      item->'scoreOptions', item->'scoreLegend', item->'outcomeOptions',
      (item->>'maxAttempts')::smallint, (item->>'requiresSelfAssessment')::boolean,
      item->'recommendedPgy', true
    ) returning id into template_id;
    for criterion in select value from jsonb_array_elements(item->'criteria') loop
      insert into public.resident_template_criteria (
        template_id, criterion_code, section_title, criterion_text, sort_order, active
      ) values (
        template_id, criterion->>'code', criterion->>'section', criterion->>'label',
        (criterion->>'sortOrder')::integer, true
      );
    end loop;
  end loop;
end;
$catalog_seed$;`;
const prefix = original.slice(0, original.indexOf(start) + start.length);
const suffix = original.slice(original.indexOf(end));
writeFileSync(migration, `${prefix}\n${sql}\n${suffix}`);
console.log(`Seeded SQL migration with ${residentTemplates.length} templates.`);
