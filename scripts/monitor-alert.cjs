/**
 * monitor-alert.cjs — open or update a single GitHub alert issue when an
 * automated gate fails, so a red run becomes an actual notification instead of
 * a silent red-X in the Actions tab.
 *
 * Called from actions/github-script (CommonJS context). Idempotent per title:
 * it reuses one open issue identified by its title marker — creating it if
 * absent, commenting if present — so repeated failures don't spam a fresh issue
 * on every run. Distinct callers pass distinct `title`s to get independent
 * dedup buckets (the 15-min uptime monitor vs. a blocked deploy promotion).
 *
 * @param {{
 *   github: any,
 *   context: any,
 *   reason: string,
 *   job: string,
 *   title?: string,
 *   intro?: string,
 *   source?: string,
 * }} args
 * @param args.title  Issue title marker (dedup key). Defaults to the uptime marker.
 * @param args.intro  First line of a newly-opened issue's body.
 * @param args.source Footer `Source:` line for a newly-opened issue.
 */
const DEFAULT_TITLE = '🔴 [monitor] xpelevator uptime/scoring alert';
const DEFAULT_INTRO = 'The scheduled uptime / scoring monitor detected a failure.';
const DEFAULT_SOURCE = '`.github/workflows/uptime-monitor.yml` (Phase 1 tail, tracked on #16).';

module.exports = async function alert({
  github,
  context,
  reason,
  job,
  title = DEFAULT_TITLE,
  intro = DEFAULT_INTRO,
  source = DEFAULT_SOURCE,
}) {
  const { owner, repo } = context.repo;
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const stamp = new Date().toISOString();
  const commentBody =
    `**\`${job}\` failed** — ${stamp}\n\n${reason}\n\n` +
    `Run: ${runUrl}\n\n` +
    `_This issue auto-resolves nothing — close it once the underlying failure is confirmed fixed ` +
    `(the gate will re-open a fresh one if it recurs)._`;

  // Find an existing OPEN alert issue by title marker.
  const existing = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  const found = existing.find((i) => !i.pull_request && i.title === title);

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
      title,
      body: `${intro}\n\n${commentBody}\n\n---\nSource: ${source}`,
    });
    console.log(`Opened alert issue #${created.data.number}`);
  }
};
