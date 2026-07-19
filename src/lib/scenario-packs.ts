/**
 * Starter scenario-library packs — the day-one sellable inventory an operator
 * needs (issue #16, Phase 4: "Starter scenario-library packs — operators need
 * sellable inventory on day one, per-vertical packs are their SKUs").
 *
 * The buyer we build for is the **operator** (training consultancies, agencies,
 * enablement / L&D shops). An operator who signs up with an empty workspace has
 * nothing to sell; these curated per-vertical packs give them ready-made
 * inventory to stand up training on day one. Each pack is a per-vertical SKU: a
 * role (job title) plus a spread of scenarios across difficulty and modality.
 *
 * This module is deliberately **pure data + pure helpers** — no DB, no Stripe,
 * no secrets, no network, no Node built-ins. It is Worker-safe (OpenNext) and
 * mirrors the shape of `src/lib/plans.ts`. It is the single source of truth
 * that the public catalog surface (`GET /api/scenario-packs`, the `/library`
 * page) reads, and — in a later slice — the admin "import this pack into my
 * org" action will materialise into `scenarios` + `job_titles` rows.
 *
 * ── Hidden-mechanic boundary (Phase 2 security rule, R-021) ──────────────────
 * A scenario's `script` carries the **hidden mechanics** — the customer's
 * persona, their concealed objective, and context hints — that trainees must
 * never see (it is the core product mechanic). The public catalog helper
 * {@link getPublicPackCatalog} therefore returns a scenario **summary only**
 * (name, difficulty, modality, a non-revealing one-liner) and NEVER the
 * `script`. The full pack (with `script`) stays server-side and only becomes an
 * org-scoped `scenarios` row on an authenticated admin import.
 */

/**
 * Practice modality a trainee runs. Mirrors the Prisma `SimulationType` enum
 * (`prisma/schema.prisma`) and the same union in `src/lib/plans.ts` — kept
 * local so this pure module never imports the generated Prisma client. A unit
 * test asserts every pack scenario uses one of exactly these three.
 */
export type SimulationType = 'PHONE' | 'CHAT' | 'VOICE';

/**
 * A scenario's difficulty tier. Mirrors `ScenarioScript['difficulty']`
 * (`src/types/index.ts`) so an imported pack scenario is a valid script.
 */
export type ScenarioDifficulty = 'easy' | 'medium' | 'hard';

/**
 * The hidden mechanics of a scenario — the persona the simulated customer
 * plays, their concealed objective, and optional context hints. Shape-compatible
 * with `ScenarioScript` (`src/types/index.ts`) so a pack scenario materialises
 * directly into a `scenarios.script`. NEVER exposed by the public catalog.
 */
export interface PackScenarioScript {
  /** Who the simulated customer is (personality, situation, mood cues). */
  customerPersona: string;
  /** The customer's hidden goal — what a successful trainee steers them toward. */
  customerObjective: string;
  /** How hard the customer is to handle. */
  difficulty: ScenarioDifficulty;
  /** Optional context the customer knows but won't volunteer unprompted. */
  hints?: string[];
}

/** One scenario inside a pack. */
export interface PackScenario {
  /** Stable slug, unique within its pack (SKU sub-stem, import idempotency key). */
  key: string;
  /** Trainee-facing scenario name. */
  name: string;
  /**
   * Public, non-revealing one-line summary — safe to show a prospective
   * operator BEFORE purchase. Describes the *situation*, never the customer's
   * hidden objective or the hints.
   */
  summary: string;
  /** Default practice modality for this scenario. */
  type: SimulationType;
  /** Hidden mechanics — persona / objective / hints. Never in the public catalog. */
  script: PackScenarioScript;
}

/** A per-vertical starter pack — an operator's sellable SKU. */
export interface ScenarioPack {
  /** Stable id / SKU stem / URL slug. */
  id: string;
  /** The industry / vertical this pack trains for. */
  vertical: string;
  /** Operator-facing pack name. */
  name: string;
  /** Operator-facing pitch — what an operator can resell this pack as. */
  description: string;
  /** The role trained (materialises into a `job_titles` row on import). */
  jobTitle: { name: string; description: string };
  /** The scenarios in the pack (spread across difficulty + modality). */
  scenarios: PackScenario[];
}

/**
 * Bump when the pack set / scenario shape changes so callers (catalog cache,
 * import idempotency) can detect drift. A unit test pins the current value.
 */
export const PACK_CATALOG_VERSION = 1 as const;

/**
 * The starter library — a set of per-vertical packs, each a role plus four
 * scenarios spanning `easy → hard` and `CHAT / VOICE / PHONE`. Copy follows the
 * org rule — the word "AI" never appears (these strings reach operator + trainee
 * surfaces). Verticals are deliberately distinct, high-training-value SKUs.
 */
export const SCENARIO_PACKS: readonly ScenarioPack[] = [
  {
    id: 'saas-support-essentials',
    vertical: 'B2B SaaS support',
    name: 'SaaS Support Essentials',
    description:
      'A ready-to-sell pack for software support teams: billing disputes, a broken integration, an angry churn-risk account, and a routine how-to. Trains de-escalation, expectation-setting, and clean handoffs.',
    jobTitle: {
      name: 'SaaS Support Specialist',
      description:
        'Front-line support for a B2B software product — handles billing, technical, and account questions over chat and phone.',
    },
    scenarios: [
      {
        key: 'password-reset-howto',
        name: 'Locked out before a deadline',
        summary:
          'A customer cannot log in and has a report due within the hour. A calm, routine how-to under mild time pressure.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Dana, a mid-level operations manager. Polite but visibly stressed — a board report is due in 50 minutes and she is locked out. Not technical; describes symptoms, not causes.',
          customerObjective:
            'Regain access to the account in time to export the report. Will feel reassured if given a clear time estimate and a fallback.',
          difficulty: 'easy',
          hints: [
            'She reset her password yesterday and may be typing the old one.',
            'She has admin rights but has never used the account-recovery flow.',
          ],
        },
      },
      {
        key: 'surprise-invoice',
        name: 'The invoice doubled this month',
        summary:
          "A customer opens firm and unhappy about an unexpected charge. Trains billing-dispute handling and expectation-setting.",
        type: 'CHAT',
        script: {
          customerPersona:
            'Marcus, a small-business owner. Direct, budget-conscious, and irritated: this month’s invoice is roughly double last month’s with no warning. Reasonable if the charge is explained clearly, sharp if stonewalled.',
          customerObjective:
            'Understand exactly why the bill rose and get it corrected or credited if it was an error. Success = a clear line-item explanation and a concrete next step.',
          difficulty: 'medium',
          hints: [
            'He added five seats mid-cycle, which triggered a proration he did not notice.',
            'He will threaten to cancel if he feels the charge is being defended before it is explained.',
          ],
        },
      },
      {
        key: 'broken-integration',
        name: 'The sync stopped overnight',
        summary:
          'A technical customer reports a data integration silently failing. Trains structured troubleshooting over a live voice channel.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Priya, a technical operations lead. Precise and a little terse; she has already checked the obvious things and wants a peer, not a script. Respects competence, loses patience with canned steps.',
          customerObjective:
            'Get the integration syncing again, or a credible root-cause and ETA. Success = being treated as technical and given a real diagnostic path.',
          difficulty: 'hard',
          hints: [
            'An API token rotated on her side two days ago and was never updated in the integration.',
            'She will disengage if asked to "try turning it off and on again" before her setup is acknowledged.',
          ],
        },
      },
      {
        key: 'churn-risk-escalation',
        name: 'Cancel my account today',
        summary:
          'A long-time customer calls in ready to cancel after a bad week. Trains retention, ownership, and de-escalation on the phone.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Ellen, a three-year customer and team lead. Frustrated and decided — opens by demanding to cancel. Under the anger is loyalty worn thin by a recent outage and a slow prior ticket.',
          customerObjective:
            'Feel heard and see that someone owns the problem. She will stay if given genuine acknowledgement plus one concrete commitment — not a discount thrown at her to end the call.',
          difficulty: 'hard',
          hints: [
            'A discount offered too early reads as dismissive and hardens her position.',
            'She references a support ticket that sat two days without a reply.',
          ],
        },
      },
    ],
  },
  {
    id: 'retail-frontline-care',
    vertical: 'Retail & hospitality frontline',
    name: 'Retail Frontline Care',
    description:
      'For operators training frontline retail and hospitality staff: a returns dispute, an upset guest, an upsell moment, and a policy edge case. Trains warmth under pressure and policy delivered with a human touch.',
    jobTitle: {
      name: 'Frontline Retail Associate',
      description:
        'Customer-facing retail / hospitality associate handling returns, complaints, and in-the-moment service recovery.',
    },
    scenarios: [
      {
        key: 'gift-recommendation',
        name: 'Help me pick a gift',
        summary:
          'A friendly customer wants a recommendation and is open to spending a little more. A warm, low-stakes upsell moment.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Sam, cheerful and a bit indecisive, shopping for a birthday gift with a rough budget in mind. Enjoys being guided; responds well to a couple of thoughtful questions.',
          customerObjective:
            'Leave with a gift they feel good about. Happy to trade up if the reason is genuine, put off by a hard sell.',
          difficulty: 'easy',
          hints: [
            'The gift is for a sibling who likes the outdoors.',
            'A sincere "this one is a little more but here is why" lands; a scripted upsell does not.',
          ],
        },
      },
      {
        key: 'return-past-window',
        name: 'A return just past the window',
        summary:
          'A customer wants to return an item a few days outside policy. Trains delivering a firm policy with empathy and options.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Rosa, reasonable but disappointed. The receipt is a few days past the return window and she feels the timing is unfair given she was travelling.',
          customerObjective:
            'Get her money back, or failing that, a fair alternative. Success = feeling respected even if the exact ask cannot be met.',
          difficulty: 'medium',
          hints: [
            'Store credit or an exchange is within the associate’s discretion; a cash refund is not.',
            'She escalates only if she feels the policy is being quoted at her without any flexibility.',
          ],
        },
      },
      {
        key: 'upset-guest-wait',
        name: 'A guest kept waiting too long',
        summary:
          'An in-person guest is visibly upset about a long wait. Trains real-time service recovery on a voice channel.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Terrence, normally easygoing but now openly annoyed after a 40-minute wait he was not warned about. Wants acknowledgement more than compensation.',
          customerObjective:
            'A genuine apology and confidence it will not happen again. Warms quickly to sincere ownership; hardens if handed a scripted "sorry for the inconvenience".',
          difficulty: 'medium',
          hints: [
            'The delay was a staffing gap, not his fault — he will relax once that is owned honestly.',
            'A small gesture offered after the apology lands well; offered instead of one, it does not.',
          ],
        },
      },
      {
        key: 'loud-complaint-phone',
        name: 'A complaint that carries across the floor',
        summary:
          'A customer calls in loud and angry about a faulty product. Trains de-escalation and boundary-setting by phone.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Gloria, angry and loud — a product failed the day after purchase and she feels cheated. Talks over interruptions; calms only when she believes she has been fully heard.',
          customerObjective:
            'A replacement or refund and an admission the product was faulty. Will not accept a solution offered before she has finished venting.',
          difficulty: 'hard',
          hints: [
            'Letting her finish her first full sentence before responding cuts the volume in half.',
            'She has the receipt and the faulty item — the resolution is straightforward once she is calm.',
          ],
        },
      },
    ],
  },
  {
    id: 'inbound-sales-discovery',
    vertical: 'Inbound sales & discovery',
    name: 'Inbound Sales & Discovery',
    description:
      'For operators training inbound sales and SDR teams: a warm inbound lead, a price objection, a "just send me info" brush-off, and a skeptical technical evaluator. Trains discovery, objection handling, and earning the next meeting.',
    jobTitle: {
      name: 'Inbound Sales Representative',
      description:
        'Handles inbound leads and discovery calls — qualifies, handles objections, and books the next step.',
    },
    scenarios: [
      {
        key: 'warm-inbound-lead',
        name: 'A warm lead who filled out the form',
        summary:
          'An engaged prospect who requested a call. A friendly discovery conversation to qualify and set a next step.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Jordan, curious and genuinely interested — filled out the contact form after a colleague’s recommendation. Open, a little unsure exactly what they need.',
          customerObjective:
            'Figure out whether this is a fit and what the next step is. Responds well to good questions, drifts if pitched at before being understood.',
          difficulty: 'easy',
          hints: [
            'Their team of eight is outgrowing a spreadsheet-based process.',
            'A crisp recap of their need plus a proposed next step earns the meeting.',
          ],
        },
      },
      {
        key: 'price-objection',
        name: '"It’s more than we budgeted"',
        summary:
          'A qualified prospect stalls on price. Trains value framing and objection handling without discounting reflexively.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Aisha, a pragmatic buyer who likes the product but flags the price as above budget. Not bluffing — she needs to justify the spend internally.',
          customerObjective:
            'Get to a number or a value story she can defend to her manager. Success = a reframe around outcomes, not a knee-jerk discount.',
          difficulty: 'medium',
          hints: [
            'The real blocker is proving ROI to her manager, not the sticker price itself.',
            'An immediate discount signals the price was soft and invites more pushback.',
          ],
        },
      },
      {
        key: 'send-me-info-brushoff',
        name: '"Just email me something"',
        summary:
          'A distracted prospect tries to end the call with a brush-off. Trains keeping a light, earned hold on the conversation.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Kev, busy and half-checked-out — defaults to "just send me info" to get off the call. Not hostile, just protecting his time. Re-engages if given a reason that respects it.',
          customerObjective:
            'Escape the call quickly — unless the rep earns 60 more seconds with one sharp, relevant question. Success = a real next step, not a PDF into the void.',
          difficulty: 'hard',
          hints: [
            'One specific question about his current process cuts through the brush-off; a generic pitch does not.',
            'He will agree to a short follow-up if it is framed around his time, not the rep’s pipeline.',
          ],
        },
      },
      {
        key: 'skeptical-evaluator',
        name: 'A skeptical technical evaluator',
        summary:
          'A detail-oriented evaluator probes for weaknesses on a call. Trains honesty, precision, and handling "we already use a competitor".',
        type: 'PHONE',
        script: {
          customerPersona:
            'Dr. Okonkwo, a technical evaluator comparing options. Sharp, unhurried, and unimpressed by hype; already uses a competitor and expects the rep to know it. Rewards a straight answer, penalises a dodge.',
          customerObjective:
            'Decide whether this is worth a deeper evaluation. Success = honest, specific answers — including where the product is not the best fit — that earn a technical follow-up.',
          difficulty: 'hard',
          hints: [
            'He will test a weak point on purpose; admitting a real limitation builds more trust than deflecting.',
            'He respects a rep who knows the competitor honestly and does not trash it.',
          ],
        },
      },
    ],
  },
  {
    id: 'sales-motivation-mastery',
    vertical: 'Sales & motivational coaching',
    name: 'Sales & Motivational Coaching',
    description:
      'The day-one demo line for operators selling into sales floors and personal-development coaching practices (the Jim-Rohn tradition — conviction, personal responsibility, moving people to decide). A hesitant first-call prospect, a burned "I have tried programs before" skeptic, a price-and-commitment stall, and a coachee who has lost momentum. Trains leading with belief, reframing an objection as a hidden doubt, and taking someone to an honest decision without pressure.',
    jobTitle: {
      name: 'Sales & Motivation Coach',
      description:
        'A sales professional in the motivational-coaching tradition — sells high-performance and personal-development programs and re-motivates their own team; leads conversations with conviction over chat, browser voice, and the phone.',
    },
    scenarios: [
      {
        key: 'hesitant-first-call',
        name: 'Just exploring for now',
        summary:
          'A warm prospect who booked a discovery call after a free workshop, but hedges that they are only looking. A friendly first conversation about building belief and earning one small next step.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Renee, a mid-career professional who booked a discovery call after a free workshop. Genuinely interested but hedges — "I am just exploring right now." Warm and a little self-doubting; responds to belief and a clear next step, and freezes the moment she feels pushed.',
          customerObjective:
            'Move from "just exploring" to committing to one concrete, small next step. Success = she feels understood and takes the small action herself, never a hard close she agrees to just to end the call.',
          difficulty: 'easy',
          hints: [
            'She has wanted to change direction for two years but keeps postponing the first step.',
            'A high-pressure close makes her retreat to "let me think about it" and go quiet.',
          ],
        },
      },
      {
        key: 'tried-programs-before',
        name: 'I have tried programs like this before',
        summary:
          'A guarded prospect who has bought coaching before and "got nothing out of it." Trains handling a reflexive dismissal by getting them to define, in their own words, what would actually make it worth it.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Marcus, a small-business owner who has paid for two coaching programs before and feels he got nothing out of them. Direct and guarded; he is testing whether this one is different. Respects candor, shuts down instantly at hype or a scripted pitch.',
          customerObjective:
            'Get him to separate the past programs from this decision and name what would make it worth it. Success = he states his own success criteria out loud instead of dismissing on reflex.',
          difficulty: 'medium',
          hints: [
            'His last program was all motivation and no accountability — that gap is the real objection under the words.',
            'He will disengage the moment he hears anything that sounds rehearsed.',
          ],
        },
      },
      {
        key: 'lost-momentum-coachee',
        name: 'Ready to quit at week twelve',
        summary:
          'A team member three months into a program who has stopped doing the work and is ready to walk. Trains re-motivating over voice — reconnecting someone to their own reason and winning back one small commitment, without a guilt trip.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Theo, three months into a program, has quietly stopped doing the work and is ready to quit. Discouraged, offering "life got busy" excuses that mask a missed early win. Loyal underneath; re-engages when reminded of why he started in his own words.',
          customerObjective:
            'Reconnect him to why he started and get one small commitment back on the board. Success = he re-owns the goal and names the next action himself, not because he was shamed into it.',
          difficulty: 'medium',
          hints: [
            'He hit one setback in week three and privately decided he "is not the type who follows through."',
            'Telling him to just try harder confirms that story and loses him.',
          ],
        },
      },
      {
        key: 'price-commitment-stall',
        name: 'It is a lot of money and I have no time',
        summary:
          'A prospect who is ready in principle but stalls at the investment on the decision call. Trains surfacing the doubt hiding behind a money objection and taking them to an honest decision over the phone.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Dana, ready in principle but stalling at the investment — "it is a lot of money and I do not have the time." Warm but anxious; the money is standing in for a fear of committing and not following through.',
          customerObjective:
            'Surface that the real objection is belief in herself, not the price, and help her decide from there. Success = an honest decision either way — a genuine yes or a real not-now — never a pressured yes she cancels the next day.',
          difficulty: 'hard',
          hints: [
            'She can afford it; the fear is committing publicly and then failing.',
            'Dropping the price validates the wrong objection and quietly lowers her belief that it will work.',
          ],
        },
      },
    ],
  },
  {
    id: 'sales-floor-coaching',
    vertical: 'Sales-floor performance coaching',
    name: 'Sales Floor Coaching',
    description:
      'The second demo line for the sales-and-motivation wedge — but pointed inward. Here the trainee is the sales-floor coach or team lead, and the simulated person is one of their own reps: a new hire frozen on the phones, a rep blaming the leads for a missed number, a top seller gutted by a lost deal, and a veteran coasting on last quarter. Trains the Jim-Rohn tradition applied to a team — leading with belief, turning an excuse into a decision, and holding a rep accountable to their own goal without shaming them off the floor. Operators serving sales teams sell this beside the outward-facing coaching pack as a distinct SKU.',
    jobTitle: {
      name: 'Sales Floor Coach',
      description:
        'A sales manager or team lead in the motivational-coaching tradition — coaches and re-energises their own reps rather than selling to prospects; runs one-to-one performance conversations over chat, browser voice, and the phone.',
    },
    scenarios: [
      {
        key: 'call-reluctant-new-rep',
        name: 'Frozen on the phones in week one',
        summary:
          'A new hire who has found every reason not to dial all morning. A first coaching conversation about naming the fear underneath the busywork and winning one dial, not a lecture about activity.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Priya, a bright new rep in her first week who keeps "getting ready" — cleaning her list, re-reading the script — instead of dialling. Eager to do well and quietly terrified of the first rejection; opens up when the coach treats the fear as normal, clams up when handed a quota lecture.',
          customerObjective:
            'Get her to name what she is afraid of and commit to one real dial while still on the call. Success = she makes the first call herself because she wants to, not because she was ordered to hit an activity number.',
          difficulty: 'easy',
          hints: [
            'She is convinced the first "no" will prove she was a bad hire.',
            'Being told to "just pick up the phone, it is easy" makes her feel more alone, not braver.',
          ],
        },
      },
      {
        key: 'blames-the-leads',
        name: 'It is the leads, not me',
        summary:
          'A rep who missed quota and has a ready explanation — the leads are junk and the territory is picked over. Trains separating what is real from what is a shield, and moving them back onto the one thing they control.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Devon, a capable rep who missed the number two months running and has settled into blaming the lead quality and the territory. Sharp and a little defensive; some of his complaint is even true, which is why he hides behind it. Respects a coach who agrees where he is right, then refuses to let him stop there.',
          customerObjective:
            'Get him to own the part of the outcome that is his and pick one action he controls this week. Success = he names his own next move instead of re-litigating the leads.',
          difficulty: 'medium',
          hints: [
            'His real fear is that if he tries his hardest and still misses, the excuse is gone.',
            'Arguing that the leads are fine hands him the fight he wants and dodges the real work.',
          ],
        },
      },
      {
        key: 'gutted-by-lost-deal',
        name: 'I am done after that one',
        summary:
          'A strong rep who just lost the biggest deal of the quarter and is talking about walking away. Trains re-motivating over voice — reconnecting them to why they are good at this and getting one commitment back, without a pep-talk that rings hollow.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Sam, a rep who nurtured a marquee deal for months and lost it at the finish line. Flattened and raw, half-serious about quitting, reading the loss as proof they are not cut out for it. Loyal and talented underneath; steadies when reminded, in their own words, of deals they have won.',
          customerObjective:
            'Reconnect them to their own track record and get one small commitment for tomorrow back on the board. Success = they re-own the goal and name the next step, not a hollow "I am fine" to end the call.',
          difficulty: 'medium',
          hints: [
            'One brutal loss has overwritten a year of wins in their head.',
            'A generic "shake it off, next one is yours" confirms the coach does not get how much it hurt.',
          ],
        },
      },
      {
        key: 'coasting-top-performer',
        name: 'I already hit my number',
        summary:
          'A veteran who cleared quota early and has quietly downshifted for the rest of the quarter, waving off feedback. Trains holding a high performer accountable over the phone — raising the bar they set for themselves without picking a fight or threatening.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Marcus, a top closer who hit his number three weeks early and has coasted since, treating any coaching as beneath him. Confident and a touch complacent; deflects with "I already delivered." Moves only when the standard comes from his own ambition rather than a manager pulling rank.',
          customerObjective:
            'Get him to raise his own bar for the rest of the quarter instead of coasting, from pride not pressure. Success = he sets a stretch he chose himself and commits to it out loud.',
          difficulty: 'hard',
          hints: [
            'He is bored, not lazy — coasting is what boredom looks like on a strong rep.',
            'Threatening or invoking the quota makes him do the minimum out of spite.',
          ],
        },
      },
    ],
  },
  {
    id: 'personal-development-coaching',
    vertical: 'Personal-development coaching',
    name: 'Personal-Development Coaching',
    description:
      'A ready-to-sell pack for personal-development and life-coaching practices in the conviction-led tradition: a vague newcomer, a serial restarter, a mid-program motivation dip, and a client hiding behind a busy life. Trains naming a real goal, building follow-through, and holding a client accountable without shaming them.',
    jobTitle: {
      name: 'Personal-Development Coach',
      description:
        'A life / personal-development coach who works one-to-one with clients on habits, discipline, and follow-through — over chat, voice, and phone sessions.',
    },
    scenarios: [
      {
        key: 'vague-first-session',
        name: 'I just want to be better',
        summary:
          'A first-session client who knows they want their life to change but cannot say into what. A gentle opener that trains turning a wish into one concrete, chosen goal.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Priya, a bright, well-meaning newcomer who signed up on a burst of motivation. Earnest and a little embarrassed that she cannot name what she actually wants — she talks in wishes ("be more disciplined", "feel less stuck") rather than goals. Warms up fast when a coach helps her get specific instead of nodding along.',
          customerObjective:
            'Leave the session with one concrete goal in her own words and a first tiny step she chose. Success = she names something measurable ("walk before work three days") instead of another vague wish.',
          difficulty: 'easy',
          hints: [
            'Every time she is vague she is testing whether the coach will do the naming for her — they should not.',
            'She has a real, specific goal underneath; she is afraid it sounds too small to say out loud.',
          ],
        },
      },
      {
        key: 'serial-restarter',
        name: 'I will start again on Monday',
        summary:
          'A client who launches a new plan every Monday and has quit by Wednesday, for the fourth time. Trains breaking the restart cycle — a smaller commitment they actually keep beats a grand plan they abandon.',
        type: 'CHAT',
        script: {
          customerPersona:
            'Marcus, enthusiastic and genuinely sincere each time he recommits, which is exactly the trap — the fresh-start high feels like progress, so he keeps buying it. Slightly ashamed of the pattern but frames it as "just needing the right system". Respects a coach who names the cycle kindly and refuses to hand him another grand plan.',
          customerObjective:
            'Get him to commit to one small thing he will do the very next day, not next Monday, and small enough that quitting is not worth it. Success = he trades the grand restart for one action he starts now and can repeat.',
          difficulty: 'medium',
          hints: [
            'The clean-slate Monday is the addiction — planning feels like doing, so he never has to risk actually doing.',
            'Another ambitious multi-step plan is what he wants; it lets him fail big and restart again.',
          ],
        },
      },
      {
        key: 'motivation-dip-midprogram',
        name: 'I do not think this is working',
        summary:
          'Six weeks in, a client who did the work but has hit the flat stretch where the early excitement is gone and results are quiet. Trains re-anchoring them to why they started over voice — before the dip talks them out of it.',
        type: 'VOICE',
        script: {
          customerPersona:
            'Elena, a disciplined client who followed the plan honestly for six weeks and has now hit the plateau where the novelty is gone and the scale barely moves. Not lazy — discouraged and quietly building a case to quit while it still feels reasonable. Steadies when reminded, in her own words, of why she began and how far she has already come.',
          customerObjective:
            'Reconnect her to the reason she started and the ground she has already gained, and get one commitment to stay the course through the flat stretch. Success = she re-owns the goal for herself instead of a hollow "maybe you are right" to end the call.',
          difficulty: 'medium',
          hints: [
            'The plateau is normal and expected here, but to her it reads as proof the effort is wasted.',
            'A cheerful "just push through, it gets easier" rings hollow and confirms the coach is not really listening.',
          ],
        },
      },
      {
        key: 'life-got-busy-excuse',
        name: 'Life just got in the way',
        summary:
          'A client who has quietly dropped the plan for three weeks and opens the call deflecting with how busy life got. Trains holding a client accountable over the phone — turning the excuse into an honest decision — without shaming them into leaving.',
        type: 'PHONE',
        script: {
          customerPersona:
            'Devon, a likeable, capable client who has ghosted the plan for three weeks and leads with a genuinely full calendar as cover. The busyness is partly real, which is what makes it such a good hiding place. Defensive if cornered, but responds to a coach who neither swallows the excuse nor scolds — one who names the choice underneath it and asks him to own it.',
          customerObjective:
            'Get him past the busy-life story to the honest fact that he chose other things over the goal, and to one commitment he actually controls this week. Success = he stops defending the excuse and names his own next move.',
          difficulty: 'hard',
          hints: [
            'He is not too busy — he deprioritised the goal and "busy" is the socially acceptable way to say so.',
            'Accepting the excuse lets him off the hook; shaming him for it gives him a reason to disappear for good.',
          ],
        },
      },
    ],
  },
];

/** Look up a single pack by its stable id. Returns `undefined` if unknown. */
export function getScenarioPack(id: string): ScenarioPack | undefined {
  return SCENARIO_PACKS.find((pack) => pack.id === id);
}

// ── Import plan (admin "import pack → org") ──────────────────────────────────
//
// The admin import materialises a pack into org-scoped `job_titles` + `scenarios`
// rows. This is the pure, DB-free half — it derives the exact rows to write from
// a pack + an orgId, so the route stays a thin executor and the shaping logic is
// unit-testable without a live database. The write itself is idempotent on the
// pack/scenario `key` (see the route + `20260712120000_add_pack_provenance`),
// so re-importing a pack never duplicates and never clobbers an operator's
// later edits — the "freeze a pack for a client even if the public pack later
// improves" property the founder called for. `packVersion` is stamped on every
// row so drift from an improved public pack is detectable in a later slice.

/** The `job_titles` row an import materialises (org-scoped, pack-provenanced). */
export interface JobTitleImportRow {
  orgId: string;
  name: string;
  description: string;
  sourcePackId: string;
  packVersion: number;
}

/** A `scenarios` row an import materialises (org-scoped, pack-provenanced). */
export interface ScenarioImportRow {
  orgId: string;
  name: string;
  description: string;
  type: SimulationType;
  /** Full hidden-mechanic script — persona / objective / hints. Server-side only. */
  script: PackScenarioScript;
  sourcePackId: string;
  /** Stable per-scenario key — the idempotency key for re-import. */
  sourceScenarioKey: string;
  packVersion: number;
}

/** The complete set of rows a pack import writes into one org. */
export interface PackImportPlan {
  packId: string;
  packVersion: number;
  orgId: string;
  jobTitle: JobTitleImportRow;
  scenarios: ScenarioImportRow[];
}

/**
 * Derive the exact rows an "import this pack into my org" action must write.
 * Pure — no DB, no auth, no network. The route executes this plan with
 * `ON CONFLICT DO NOTHING` against the org-scoped provenance indexes, so the
 * result is idempotent on `(orgId, sourcePackId, sourceScenarioKey)`.
 *
 * @param pack  The starter pack to materialise.
 * @param orgId The org the rows belong to (never null — imports are tenant-scoped).
 */
export function buildPackImportPlan(pack: ScenarioPack, orgId: string): PackImportPlan {
  return {
    packId: pack.id,
    packVersion: PACK_CATALOG_VERSION,
    orgId,
    jobTitle: {
      orgId,
      name: pack.jobTitle.name,
      description: pack.jobTitle.description,
      sourcePackId: pack.id,
      packVersion: PACK_CATALOG_VERSION,
    },
    scenarios: pack.scenarios.map((s) => ({
      orgId,
      name: s.name,
      description: s.summary,
      type: s.type,
      script: s.script,
      sourcePackId: pack.id,
      sourceScenarioKey: s.key,
      packVersion: PACK_CATALOG_VERSION,
    })),
  };
}

// ── Upgrade plan (admin "upgrade a frozen pack → current catalog version") ────
//
// The deliberate, opt-in counterpart to the non-clobbering import. Import is
// frozen-by-default: re-importing never overwrites an operator's rows, so a pack
// materialised at version N stays at N even after the public catalog improves
// (the "freeze a pack for a client" property the founder called for). Upgrade is
// the escape hatch — an admin explicitly re-syncs an already-imported pack to
// the current catalog. This is the pure, DB-free half: given the current catalog
// pack + the org's stored provenanced scenario rows (their key + `pack_version`),
// it derives exactly which scenarios to UPDATE (stale — stored version older
// than the catalog), INSERT (added to the catalog since the import), leave
// UNCHANGED (already at the catalog version), or report as ORPHANED (removed
// from the catalog — reported, NEVER deleted, since the operator may still be
// running it). The route executes the plan; the shaping is unit-tested here.

/** One of the org's currently-stored, pack-provenanced scenario rows. */
export interface StoredPackScenario {
  sourceScenarioKey: string;
  /** The catalog version this row was last written at (`null` = pre-versioning). */
  packVersion: number | null;
}

/** What an upgrade will do to a single scenario. */
export type ScenarioUpgradeAction = 'update' | 'insert' | 'unchanged' | 'orphaned';

/** Per-scenario audit line for the upgrade preview. */
export interface ScenarioUpgradeItem {
  sourceScenarioKey: string;
  /** Trainee-facing name (from the catalog; the key itself for an orphaned row). */
  name: string;
  action: ScenarioUpgradeAction;
  /** The stored version (`null` for a fresh insert). */
  fromVersion: number | null;
  /** The version the row will be at after upgrade (unchanged for `unchanged`/`orphaned`). */
  toVersion: number | null;
}

/** The full set of writes + audit an upgrade performs for one org. */
export interface PackUpgradePlan {
  packId: string;
  /** The catalog version everything is being synced up to. */
  targetVersion: number;
  orgId: string;
  /** Stale rows to overwrite with the current content + bumped version. */
  toUpdate: ScenarioImportRow[];
  /** Catalog scenarios the org lacks — inserted (idempotent, same shape as import). */
  toInsert: ScenarioImportRow[];
  /** Keys already at the target version — no write. */
  unchangedKeys: string[];
  /** Stored keys no longer in the catalog — reported, never deleted. */
  orphanedKeys: string[];
  /** Full per-scenario audit, in catalog order then orphaned. */
  items: ScenarioUpgradeItem[];
}

/**
 * Derive the exact writes an "upgrade this imported pack to the current catalog
 * version" action must perform, plus a per-scenario audit for the preview. Pure
 * — no DB, no auth, no network.
 *
 * A stored scenario is **stale** (→ `update`) when its `packVersion` is `null`
 * (pre-versioning) or strictly less than {@link PACK_CATALOG_VERSION}; a stored
 * row already at or beyond the catalog version is left **unchanged** (never
 * downgraded). A catalog scenario with no stored row is an **insert**; a stored
 * row whose key has left the catalog is **orphaned** and only reported.
 *
 * @param pack   The current catalog pack to sync up to.
 * @param stored The org's currently-stored provenanced rows for this pack.
 * @param orgId  The org the rows belong to (imports/upgrades are tenant-scoped).
 */
export function buildPackUpgradePlan(
  pack: ScenarioPack,
  stored: readonly StoredPackScenario[],
  orgId: string,
): PackUpgradePlan {
  const target = PACK_CATALOG_VERSION;
  const storedByKey = new Map(stored.map((s) => [s.sourceScenarioKey, s]));
  const catalogKeys = new Set(pack.scenarios.map((s) => s.key));

  const toUpdate: ScenarioImportRow[] = [];
  const toInsert: ScenarioImportRow[] = [];
  const unchangedKeys: string[] = [];
  const items: ScenarioUpgradeItem[] = [];

  for (const s of pack.scenarios) {
    const row: ScenarioImportRow = {
      orgId,
      name: s.name,
      description: s.summary,
      type: s.type,
      script: s.script,
      sourcePackId: pack.id,
      sourceScenarioKey: s.key,
      packVersion: target,
    };
    const existing = storedByKey.get(s.key);
    if (!existing) {
      toInsert.push(row);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'insert', fromVersion: null, toVersion: target });
    } else if (existing.packVersion == null || existing.packVersion < target) {
      toUpdate.push(row);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'update', fromVersion: existing.packVersion, toVersion: target });
    } else {
      unchangedKeys.push(s.key);
      items.push({ sourceScenarioKey: s.key, name: s.name, action: 'unchanged', fromVersion: existing.packVersion, toVersion: existing.packVersion });
    }
  }

  const orphanedKeys: string[] = [];
  for (const s of stored) {
    if (!catalogKeys.has(s.sourceScenarioKey)) {
      orphanedKeys.push(s.sourceScenarioKey);
      items.push({ sourceScenarioKey: s.sourceScenarioKey, name: s.sourceScenarioKey, action: 'orphaned', fromVersion: s.packVersion, toVersion: s.packVersion });
    }
  }

  return { packId: pack.id, targetVersion: target, orgId, toUpdate, toInsert, unchangedKeys, orphanedKeys, items };
}

// ── Upgrade-preview presentation (admin dry-run surface) ──────────────────────
//
// Pure formatting for the "preview before you commit" step (R-062): the upgrade
// route already returns a per-scenario audit (`items`) + `counts` on a
// `{ dryRun: true }` call, but the operator had no way to SEE it — the admin tab
// fired a blind `confirm()`. These helpers turn the audit into felt copy so the
// preview panel stays free of business logic (and is unit-tested, not JSX-buried).
// No DB, no network, Worker-safe.

/** The per-scenario drift counts returned by the dry-run upgrade. */
export interface UpgradePreviewCounts {
  update: number;
  insert: number;
  unchanged: number;
  orphaned: number;
}

/** A trainee-neutral verb + swatch class for one audit action (drives the badge). */
export function upgradeActionLabel(action: ScenarioUpgradeAction): { label: string; cls: string } {
  switch (action) {
    case 'update':
      return { label: 'Update', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50' };
    case 'insert':
      return { label: 'Add', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' };
    case 'orphaned':
      return { label: 'Retired (kept)', cls: 'bg-slate-700/60 text-slate-300 border-slate-600' };
    case 'unchanged':
    default:
      return { label: 'Unchanged', cls: 'bg-slate-800/60 text-slate-400 border-slate-700' };
  }
}

/**
 * One operator-facing sentence summarising an upgrade preview — what the commit
 * will actually do. Copy follows the org rule (no "AI"). Returns the no-op line
 * when nothing would change so the operator can safely dismiss the preview.
 */
export function summarizeUpgradeCounts(counts: UpgradePreviewCounts): string {
  const parts: string[] = [];
  if (counts.update > 0) parts.push(`${counts.update} to update`);
  if (counts.insert > 0) parts.push(`${counts.insert} to add`);
  if (parts.length === 0) {
    return counts.orphaned > 0
      ? `Nothing to sync — ${counts.orphaned} retired scenario${counts.orphaned === 1 ? '' : 's'} will be kept in place.`
      : 'Already up to date — nothing would change.';
  }
  const orphanNote =
    counts.orphaned > 0
      ? `; ${counts.orphaned} retired scenario${counts.orphaned === 1 ? '' : 's'} left in place`
      : '';
  return `${parts.join(', ')}${orphanNote}. Scenarios you authored are never touched.`;
}

// ── Per-pack import status (admin "Scenario Packs" surface) ───────────────────
//
// The read the admin workspace needs to turn the pack machinery into a felt
// operator control: for every catalog pack, is it imported into this org, and is
// an opt-in upgrade (R-054) available? Import (R-047) and upgrade (R-054) are
// write routes; without this the UI would have to probe each write path to know
// which action to offer. Pure — no DB, no auth, no network — so the route stays a
// thin org-scoped read over `computePackStatus`.

/** An org's import state for a single pack — drives the admin packs surface. */
export type PackImportState = 'not_imported' | 'up_to_date' | 'upgrade_available';

/** One pack's import status for an org (the surface reads a list of these). */
export interface PackStatus {
  packId: string;
  packName: string;
  vertical: string;
  /** The role the pack trains (materialises into a `job_titles` row on import). */
  role: string;
  /** The catalog version this status was computed against. */
  catalogVersion: number;
  state: PackImportState;
  /** How many of the org's scenario rows are provenanced to this pack (0 = not imported). */
  importedScenarioCount: number;
  /** How many scenarios the catalog pack currently defines. */
  catalogScenarioCount: number;
  /**
   * How the opt-in upgrade (R-054) would re-sync this pack, when imported. All
   * zero (and state `up_to_date`) when nothing is stale or newly added.
   */
  drift: { update: number; insert: number; unchanged: number; orphaned: number };
}

/**
 * Derive an org's import status for a single pack from its stored,
 * pack-provenanced scenario rows (their key + `pack_version`). Pure — no DB, no
 * auth, no network. Carries NO hidden mechanics (no `script`): only import
 * bookkeeping.
 *
 * `not_imported` when the org holds no rows for the pack. Otherwise the drift is
 * derived by {@link buildPackUpgradePlan}: `upgrade_available` when any scenario
 * is stale (older `pack_version`) or newly added to the catalog, else
 * `up_to_date`. Orphaned rows alone do NOT force an upgrade — they are reported
 * for awareness but the upgrade never deletes them, so a pack that only has
 * orphans (a scenario dropped from the catalog) is still `up_to_date`.
 *
 * @param pack   The current catalog pack.
 * @param stored The org's stored provenanced rows for this pack (empty = not imported).
 * @param orgId  The org the rows belong to (status is tenant-scoped).
 */
export function computePackStatus(
  pack: ScenarioPack,
  stored: readonly StoredPackScenario[],
  orgId: string,
): PackStatus {
  const base = {
    packId: pack.id,
    packName: pack.name,
    vertical: pack.vertical,
    role: pack.jobTitle.name,
    catalogVersion: PACK_CATALOG_VERSION,
    catalogScenarioCount: pack.scenarios.length,
  };
  if (stored.length === 0) {
    return {
      ...base,
      state: 'not_imported',
      importedScenarioCount: 0,
      drift: { update: 0, insert: 0, unchanged: 0, orphaned: 0 },
    };
  }
  const plan = buildPackUpgradePlan(pack, stored, orgId);
  const drift = {
    update: plan.toUpdate.length,
    insert: plan.toInsert.length,
    unchanged: plan.unchangedKeys.length,
    orphaned: plan.orphanedKeys.length,
  };
  const state: PackImportState =
    drift.update > 0 || drift.insert > 0 ? 'upgrade_available' : 'up_to_date';
  return { ...base, state, importedScenarioCount: stored.length, drift };
}

// ── Modality / cost profile ──────────────────────────────────────────────────
//
// A lightweight, pure read of what a pack costs to *run* (founder note on the
// #55 import slice: "carry a lightweight modality/cost profile into the admin
// import path — expected turn count, voice/phone latency risk, whether the
// scenario needs interruption handling — so operators understand why two
// scenarios can look similar in the catalog but behave very differently in live
// training"). Surfaced on the import preview/response so an operator sees the
// operational shape before committing a pack to a client workspace.

/** Coarse latency risk of running a pack, driven by its heaviest modality. */
export type PackLatencyRisk = 'low' | 'medium' | 'high';

/** Per-difficulty rough turn estimate — a planning heuristic, not a guarantee. */
const ESTIMATED_TURNS: Record<ScenarioDifficulty, number> = { easy: 4, medium: 6, hard: 8 };

/** The operational shape of a pack — how it behaves in live training. */
export interface PackModalityProfile {
  totalScenarios: number;
  /** Scenario counts per practice modality. */
  byModality: Record<SimulationType, number>;
  /**
   * Coarse latency risk of the pack's heaviest channel: PHONE (real carrier
   * round-trip) → high, VOICE (browser speech) → medium, CHAT-only → low.
   */
  latencyRisk: PackLatencyRisk;
  /**
   * True when the pack contains a real-time voice channel (VOICE or PHONE) — the
   * trainee can talk over the customer, so the run needs interruption handling.
   */
  needsInterruptionHandling: boolean;
  /** Rough total turn count across the pack (sum of the per-difficulty estimate). */
  estimatedTurnsTotal: number;
  /** One-line operator-facing summary of the above. */
  note: string;
}

/**
 * Compute the pure {@link PackModalityProfile} for a pack. No DB, no network.
 */
export function packModalityProfile(pack: ScenarioPack): PackModalityProfile {
  const byModality: Record<SimulationType, number> = { CHAT: 0, VOICE: 0, PHONE: 0 };
  let estimatedTurnsTotal = 0;
  for (const s of pack.scenarios) {
    byModality[s.type] += 1;
    estimatedTurnsTotal += ESTIMATED_TURNS[s.script.difficulty];
  }
  const latencyRisk: PackLatencyRisk =
    byModality.PHONE > 0 ? 'high' : byModality.VOICE > 0 ? 'medium' : 'low';
  const needsInterruptionHandling = byModality.PHONE > 0 || byModality.VOICE > 0;
  const channels = (['CHAT', 'VOICE', 'PHONE'] as SimulationType[])
    .filter((m) => byModality[m] > 0)
    .join(' + ');
  const note = needsInterruptionHandling
    ? `${pack.scenarios.length} scenarios (${channels}); real-time voice present — expect interruption handling and ${latencyRisk} latency.`
    : `${pack.scenarios.length} scenarios (${channels}); text-only — low latency, no interruption handling.`;
  return {
    totalScenarios: pack.scenarios.length,
    byModality,
    latencyRisk,
    needsInterruptionHandling,
    estimatedTurnsTotal,
    note,
  };
}

// ── Public catalog (hidden-mechanic-safe) ────────────────────────────────────

/** A single scenario as exposed on the public catalog — never carries `script`. */
export interface PublicPackScenario {
  key: string;
  name: string;
  summary: string;
  difficulty: ScenarioDifficulty;
  type: SimulationType;
}

/** A single pack as exposed on the public catalog. */
export interface PublicScenarioPack {
  id: string;
  vertical: string;
  name: string;
  description: string;
  /** The role this pack trains (name only). */
  role: string;
  /** How many scenarios the pack contains. */
  scenarioCount: number;
  /** Distinct difficulties present, in `easy → medium → hard` order. */
  difficulties: ScenarioDifficulty[];
  /** Distinct practice modalities present. */
  modalities: SimulationType[];
  /** Per-scenario summaries — no persona, objective, or hints. */
  scenarios: PublicPackScenario[];
}

/** The serialisable payload returned by `GET /api/scenario-packs`. */
export interface PublicPackCatalog {
  version: number;
  packCount: number;
  packs: PublicScenarioPack[];
}

const DIFFICULTY_ORDER: readonly ScenarioDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * Build the public, hidden-mechanic-safe catalog for the operator-facing
 * `/library` surface and `GET /api/scenario-packs`. Deliberately strips every
 * scenario `script` (persona / objective / hints) — the same hidden-mechanic
 * boundary the Phase-2 scenario sanitizer enforces (R-021). What remains is a
 * sales/browse view: pack pitch, role, difficulty + modality mix, and a
 * non-revealing per-scenario summary.
 */
export function getPublicPackCatalog(): PublicPackCatalog {
  const packs = SCENARIO_PACKS.map((pack) => {
    const difficulties = DIFFICULTY_ORDER.filter((d) =>
      pack.scenarios.some((s) => s.script.difficulty === d),
    );
    const modalities = Array.from(new Set(pack.scenarios.map((s) => s.type)));
    return {
      id: pack.id,
      vertical: pack.vertical,
      name: pack.name,
      description: pack.description,
      role: pack.jobTitle.name,
      scenarioCount: pack.scenarios.length,
      difficulties,
      modalities,
      scenarios: pack.scenarios.map((s) => ({
        key: s.key,
        name: s.name,
        summary: s.summary,
        difficulty: s.script.difficulty,
        type: s.type,
      })),
    };
  });
  return {
    version: PACK_CATALOG_VERSION,
    packCount: packs.length,
    packs,
  };
}
