-- Rename the "UML" timeline domain / checkpoint layer to "flow"/"FLOW".
-- The canvas "UML" tab was renamed to "Flows" (narrated user-journey sequence
-- diagrams), so the persisted domain/layer values follow. Data-only migration:
-- no schema/column change (TimelineEvent.domain stays String, Checkpoint.data
-- stays JSON) — this rewrites existing rows so they satisfy the new enum on read.

-- TimelineEvent.domain is a plain column.
UPDATE "TimelineEvent" SET "domain" = 'flow' WHERE "domain" = 'uml';

-- Checkpoint.data is JSON holding changes[].layer; rewrite the layer literal in place.
-- jsonb::text renders "layer": "UML" (space after the colon), matched below.
UPDATE "Checkpoint"
   SET "data" = REPLACE("data"::text, '"layer": "UML"', '"layer": "FLOW"')::jsonb
 WHERE "data"::text LIKE '%"layer": "UML"%';
