-- Fix 1: Add maxTurns to all scenarios based on difficulty
UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '10'::jsonb)
WHERE script->>'difficulty' = 'easy';

UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '12'::jsonb)
WHERE script->>'difficulty' = 'medium';

UPDATE scenarios 
SET script = jsonb_set(script, '{maxTurns}', '16'::jsonb)
WHERE script->>'difficulty' = 'hard';

-- Fix 2: Delete the "lost dog" test scenario and all related data
DELETE FROM chat_messages WHERE session_id IN (
  SELECT id FROM simulation_sessions WHERE scenario_id IN (
    SELECT id FROM scenarios WHERE name = 'lost dog'
  )
);

DELETE FROM scores WHERE session_id IN (
  SELECT id FROM simulation_sessions WHERE scenario_id IN (
    SELECT id FROM scenarios WHERE name = 'lost dog'
  )
);

DELETE FROM simulation_sessions WHERE scenario_id IN (
  SELECT id FROM scenarios WHERE name = 'lost dog'
);

DELETE FROM scenarios WHERE name = 'lost dog';

-- Fix 3: Remove Upsell/Cross-sell from Technical Support Specialist
DELETE FROM job_criteria 
WHERE job_title_id IN (SELECT id FROM job_titles WHERE name = 'Technical Support Specialist')
AND criteria_id IN (SELECT id FROM criteria WHERE name = 'Upsell/Cross-sell');

-- Fix 4: Remove Compliance from Sales Associate (not needed for sales roles)
DELETE FROM job_criteria 
WHERE job_title_id IN (SELECT id FROM job_titles WHERE name = 'Sales Associate')
AND criteria_id IN (SELECT id FROM criteria WHERE name = 'Compliance');

-- Verification query: Show updated mappings
SELECT 
  jt.name AS job_title, 
  c.name AS criteria, 
  c.weight 
FROM job_criteria jc
JOIN job_titles jt ON jc.job_title_id = jt.id
JOIN criteria c ON jc.criteria_id = c.id
ORDER BY jt.name, c.weight DESC, c.name;
