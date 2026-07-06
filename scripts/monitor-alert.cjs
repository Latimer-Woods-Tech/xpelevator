/**
 * monitor-alert.cjs — open or update a single GitHub alert issue when the uptime
 * monitor fails, so a red scheduled run becomes an actual notification.
 *
 * Called from actions/github-script (CommonJS context). Idempotent: it reuses one
 * open issue identified by a title marker — creating it if absent, commenting if
 * present — so repeated failures don't spam a new issue every 15 minutes.
 *
 * @param {{ github: any, context: any, reason: string, job: string }} args
 */
const TITLE = '🔴 [monitor] xpelevator uptime/scoring alert';

module.exports = async function alert({ github, context, reason, job }) {
  const { owner, repo } = context.repo;
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const stamp = new Date().toISOString();
  const commentBody =
    `**Monitor job \`${job}\` failed** — ${stamp}\n\n${reason}\n\n` +
    `Run: ${runUrl}\n\n` +
    `_This issue auto-resolves nothing — close it once the underlying failure is confirmed fixed ` +
    `(the monitor will re-open a fresh one if it recurs)._`;

  // Find an existing OPEN alert issue by title marker.
  const existing = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  const found = existing.find((i) => !i.pull_request && i.title === TITLE);

  if (found) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: found.number,
      body: commentBody,
    });
    console.log(`Commented on existing alert issue #${found.number}`);
  } else {
    const created = await github.rest.issues.create({
      owner,
      repo,
      title: TITLE,
      body:
        `The scheduled uptime / scoring monitor detected a failure.\n\n${commentBody}\n\n` +
        `---\nSource: \`.github/workflows/uptime-monitor.yml\` (Phase 1 tail, tracked on #16).`,
    });
    console.log(`Opened alert issue #${created.data.number}`);
  }
};
