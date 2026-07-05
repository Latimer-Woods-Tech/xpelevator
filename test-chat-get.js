// Test GET /api/chat query
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in environment');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const sessionId = 'a4b0eaee-a953-4dca-b2ac-b99855551a5a';

async function test() {
  try {
    console.log('Testing GET /api/chat query...');
    console.log('SessionId:', sessionId);
    
    const result = await sql`
      SELECT 
        ss.id,
        ss.org_id as "orgId",
        ss.user_id as "userId",
        ss.db_user_id as "dbUserId",
        ss.job_title_id as "jobTitleId",
        ss.scenario_id as "scenarioId",
        ss.type,
        ss.status,
        ss.started_at as "startedAt",
        ss.ended_at as "endedAt",
        ss.created_at as "createdAt",
        json_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'type', s.type,
          'script', s.script
        ) as scenario,
        json_build_object(
          'id', jt.id,
          'name', jt.name,
          'description', jt.description
        ) as "jobTitle",
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.id,
              'role', m.role,
              'content', m.content,
              'timestamp', m.timestamp
            ) ORDER BY m.timestamp
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) as messages,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', sc.id,
                'score', sc.score,
                'feedback', sc.feedback,
                'criteria', json_build_object(
                  'id', c.id,
                  'name', c.name,
                  'description', c.description,
                  'weight', c.weight,
                  'category', c.category
                )
              ) ORDER BY sc.scored_at
            )
            FROM scores sc
            LEFT JOIN criteria c ON c.id = sc.criteria_id
            WHERE sc.session_id = ss.id
          ),
          '[]'
        ) as scores
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      LEFT JOIN chat_messages m ON m.session_id = ss.id
      WHERE ss.id = ${sessionId}
      GROUP BY ss.id, s.id, jt.id
    `;
    
    if (result.length === 0) {
      console.log('Session not found');
      return;
    }
    
    console.log('Success! Session data:');
    console.log(JSON.stringify(result[0], null, 2));
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

test();
