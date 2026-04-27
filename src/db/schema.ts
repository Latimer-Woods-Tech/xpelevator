/**
 * Drizzle ORM schema for xpelevator.
 * Experience elevation platform — members, journeys, milestones, subscriptions.
 */
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  doublePrecision,
  timestamptz,
  jsonb,
} from 'drizzle-orm/pg-core';

/** Registered members on the platform. */
export const members = pgTable('members', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      text('user_id').notNull().unique(),  // JWT sub
  email:       text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl:   text('avatar_url'),
  plan:        text('plan').notNull().default('free'),  // free | starter | pro | elite
  stripeCustomerId: text('stripe_customer_id'),
  createdAt:   timestamptz('created_at').notNull().defaultNow(),
  updatedAt:   timestamptz('updated_at').notNull().defaultNow(),
});

/** Structured growth journeys that members enroll in. */
export const journeys = pgTable('journeys', {
  id:          uuid('id').primaryKey().defaultRandom(),
  title:       text('title').notNull(),
  description: text('description'),
  category:    text('category').notNull(),  // mindset | career | fitness | finance | relationships
  difficulty:  text('difficulty').notNull().default('beginner'),  // beginner | intermediate | advanced
  durationDays: integer('duration_days').notNull(),
  status:      text('status').notNull().default('draft'),  // draft | published | archived
  metadata:    jsonb('metadata'),
  createdAt:   timestamptz('created_at').notNull().defaultNow(),
  updatedAt:   timestamptz('updated_at').notNull().defaultNow(),
});

/** A member's enrollment in a journey with progress tracking. */
export const enrollments = pgTable('enrollments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  memberId:    uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  journeyId:   uuid('journey_id').notNull().references(() => journeys.id),
  status:      text('status').notNull().default('active'),  // active | paused | completed | dropped
  progressPct: doublePrecision('progress_pct').notNull().default(0),
  startedAt:   timestamptz('started_at').notNull().defaultNow(),
  completedAt: timestamptz('completed_at'),
  createdAt:   timestamptz('created_at').notNull().defaultNow(),
  updatedAt:   timestamptz('updated_at').notNull().defaultNow(),
});

/** Discrete milestones within a journey that members check off. */
export const milestones = pgTable('milestones', {
  id:           uuid('id').primaryKey().defaultRandom(),
  enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id, { onDelete: 'cascade' }),
  journeyId:    uuid('journey_id').notNull().references(() => journeys.id),
  title:        text('title').notNull(),
  dayNumber:    integer('day_number').notNull(),
  completed:    boolean('completed').notNull().default(false),
  completedAt:  timestamptz('completed_at'),
  notes:        text('notes'),
  createdAt:    timestamptz('created_at').notNull().defaultNow(),
});

/** Stripe subscription records per member. */
export const subscriptions = pgTable('subscriptions', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  memberId:             uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripePriceId:        text('stripe_price_id').notNull(),
  status:               text('status').notNull(),  // active | past_due | canceled | trialing
  currentPeriodEnd:     timestamptz('current_period_end').notNull(),
  createdAt:            timestamptz('created_at').notNull().defaultNow(),
  updatedAt:            timestamptz('updated_at').notNull().defaultNow(),
});
