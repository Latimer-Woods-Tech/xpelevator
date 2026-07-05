# Chat Testing Guide

## Quick Test Script

Run this command to test all chat components:

```bash
npx tsx test-chat.js
```

This will test:
- GROQ API connectivity
- Database seeding (jobs/scenarios)
- Simulation creation
- Chat API functionality

## Manual Testing Steps

### 1. Start the Development Server
```bash
npm run dev
```

### 2. Test GROQ API
- Visit: http://localhost:3000/admin
- Click "Test GROQ API" button
- Should see success message with API response

### 3. Check Database Seeding
- Visit: http://localhost:3000/admin
- Check if jobs and scenarios are listed
- If empty, run: `npm run seed`

### 4. Test Chat in Simulator
- Visit: http://localhost:3000/simulate
- Select a job and scenario
- Start simulation
- Try sending a message in the chat
- Check browser console for detailed logs

## Debug Tools

### Browser Console Logging
- Open browser DevTools (F12)
- Go to Console tab
- Look for logs starting with `[SimulationPage]`, `[ChatAPI]`, `[AI]`
- These show detailed debugging information

### Admin Debug Panel
- Visit: http://localhost:3000/admin
- Use the debug tools section to test APIs
- Toggle console logging for enhanced debugging

## Common Issues & Fixes

### GROQ API Issues
- Check `GROQ_API_KEY` in `.env`
- Verify API key is valid and has credits
- Test with the admin panel button

### Database Issues
- Run `npm run seed` to populate database
- Check Prisma connection in `.env`
- Verify Neon database is running

### Authentication Issues
- Check NextAuth configuration
- Verify session creation in API routes
- Test with admin panel

### Chat Not Streaming
- Check browser console for SSE errors
- Verify edge runtime in API routes
- Test fallback responses (should work even if AI fails)

## Fallback Behavior

The chat system includes fallback responses that work even when the AI API fails:
- If GROQ API fails, you'll get a simulated response
- Chat interface remains functional
- Error details logged to console

## Need Help?

If tests fail, check the browser console and admin panel for detailed error messages. The comprehensive logging will help identify exactly where the issue occurs.