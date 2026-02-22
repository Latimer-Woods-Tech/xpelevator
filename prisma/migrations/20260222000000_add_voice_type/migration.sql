-- Add VOICE simulation type (browser WebRTC - no Telnyx required)
ALTER TYPE "SimulationType" ADD VALUE IF NOT EXISTS 'VOICE';
