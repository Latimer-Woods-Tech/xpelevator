-- CreateEnum
CREATE TYPE "SimulationType" AS ENUM ('PHONE', 'CHAT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'AGENT');

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "job_title_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "SimulationType" NOT NULL,
    "script" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criteria" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 5,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_criteria" (
    "id" TEXT NOT NULL,
    "job_title_id" TEXT NOT NULL,
    "criteria_id" TEXT NOT NULL,

    CONSTRAINT "job_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "job_title_id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "type" "SimulationType" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "criteria_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_name_key" ON "job_titles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "job_criteria_job_title_id_criteria_id_key" ON "job_criteria"("job_title_id", "criteria_id");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_criteria" ADD CONSTRAINT "job_criteria_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_criteria" ADD CONSTRAINT "job_criteria_criteria_id_fkey" FOREIGN KEY ("criteria_id") REFERENCES "criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_sessions" ADD CONSTRAINT "simulation_sessions_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_sessions" ADD CONSTRAINT "simulation_sessions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_criteria_id_fkey" FOREIGN KEY ("criteria_id") REFERENCES "criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
