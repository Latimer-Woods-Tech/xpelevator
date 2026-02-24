# XPElevator User Guide

**Version:** 1.0  
**Last Updated:** February 23, 2026

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [User Roles](#user-roles)
4. [Main Features](#main-features)
5. [Starting a Simulation](#starting-a-simulation)
6. [During a Simulation](#during-a-simulation)
7. [Reviewing Sessions](#reviewing-sessions)
8. [Analytics Dashboard](#analytics-dashboard)
9. [Admin Panel](#admin-panel)
10. [Tips & Best Practices](#tips--best-practices)
11. [Troubleshooting](#troubleshooting)

---

## Introduction

**XPElevator** is a virtual customer simulator designed to help employees practice and improve their customer interaction skills. The platform uses AI-powered virtual customers to create realistic training scenarios via:

- **💬 Chat** - Text-based customer conversations
- **🎙️ Voice** - Browser-based voice conversations (using microphone)
- **📞 Phone** - Real phone call simulations via Telnyx

After completing a simulation, users receive detailed performance scores based on configurable criteria such as empathy, problem-solving, product knowledge, and more.

---

## Getting Started

### Accessing the Platform

1. Navigate to **https://xpelevator.com** (or your organization's deployment URL)
2. Click **Sign in** in the top-right corner
3. Choose your authentication method:
   - **GitHub OAuth** (if configured)
   - **Email login** (credentials-based)

### First Time Login

For demo/development environments:
- Simply enter your email address
- A user account will be automatically created with MEMBER role
- You'll have immediate access to simulations

For production environments:
- Contact your administrator to create your account
- You'll need an existing user account to sign in

---

## User Roles

### MEMBER (Standard User)
**Can access:**
- ✅ Start simulations
- ✅ View their own simulation sessions
- ✅ Review transcripts and scores
- ✅ View personal analytics

**Cannot access:**
- ❌ Admin panel
- ❌ Other users' sessions (in organizations)
- ❌ Criteria management

### ADMIN
**Has all MEMBER permissions, plus:**
- ✅ Manage job titles
- ✅ Create and edit scenarios
- ✅ Configure scoring criteria
- ✅ Link criteria to job titles
- ✅ View organization-wide sessions (if in an organization)
- ✅ Access all analytics across the organization

---

## Main Features

### Home Dashboard

The home page provides quick access to four main areas:

| Feature | Icon | Description |
|---------|------|-------------|
| **Start Simulation** | 🎯 | Begin a new training session |
| **View Sessions** | 📊 | Review past performance and transcripts |
| **Admin Panel** | ⚙️ | Manage simulations (admin only) |
| **Analytics** | 📈 | View performance trends and insights |

---

## Starting a Simulation

### Step 1: Select a Job Title

1. Click **Start Simulation** from the home page
2. Browse available job titles (e.g., "Customer Support Rep", "Sales Associate")
3. Click on a job title card to select it
4. The card will highlight in blue when selected

**Job title cards show:**
- Job title name
- Brief description
- Number of available scenarios

### Step 2: Choose a Scenario

Once you've selected a job title, available scenarios will appear below:

**Scenario cards display:**
- Scenario name and description
- Scenario type (PHONE, CHAT, or VOICE)
- Icon: 📞 for phone, 💬 for chat/voice

### Step 3: Select Simulation Mode

For **CHAT** scenarios, you can choose between two modes:

#### 💬 Chat Mode
- Text-based conversation
- Type your responses
- Instant AI customer replies
- Best for: Written communication practice

#### 🎙️ Voice Mode
- Speak using your browser microphone
- AI customer responds with synthesized voice
- Real-time conversation
- Best for: Verbal communication practice
- **Requirements:** 
  - Modern browser with microphone access
  - Allow microphone permissions when prompted

For **PHONE** scenarios:
- Click **Start** to initiate a real phone call
- You'll need to provide a phone number
- The AI customer will call you directly

### Step 4: Start the Simulation

1. Click the corresponding button (💬 Chat, 🎙️ Voice, or Start)
2. The button will show "Starting..." briefly
3. You'll be redirected to the simulation interface

---

## During a Simulation

### Chat Interface

**Layout:**
- **Left side:** Conversation transcript
- **Right side:** Scenario information and status
- **Bottom:** Message input box

**How to interact:**
1. Read the customer's opening message
2. Type your response in the text box at the bottom
3. Press **Enter** or click **Send**
4. Wait for the AI customer's response (appears in real-time)
5. Continue the conversation naturally

**Chat Features:**
- Messages appear in conversation bubbles
- **Customer messages** - Gray background on left
- **Your messages** - Blue background on right
- Timestamps show when each message was sent
- Scroll to see conversation history

**Ending the chat:**
1. Complete the conversation naturally
2. Click **End Session** button
3. Confirm when prompted
4. You'll be redirected to view your scores

### Voice Interface

**Layout:**
- Visual audio waveform showing when AI is speaking
- Microphone status indicator
- Start/Stop recording controls
- Conversation transcript (optional display)

**How to interact:**
1. Click **Allow** when prompted for microphone access
2. Click the microphone button to start speaking
3. Speak clearly and naturally
4. Click again to stop recording and send
5. Listen to the AI customer's voice response
6. Repeat until conversation is complete

**Voice Features:**
- Real-time voice recognition
- Natural-sounding AI voice responses
- Visual feedback during recording
- Automatic transcript generation

**Tips for voice mode:**
- Speak in a quiet environment
- Use a good quality microphone if available
- Wait for the AI to finish speaking before responding
- Speak at a normal conversational pace

### Phone Interface

**Before the call:**
1. Enter your phone number in E.164 format (e.g., +12125550100)
2. Click **Start Call**
3. Wait for the system to connect (5-15 seconds)

**During the call:**
- Answer the incoming call from the Telnyx number
- The AI customer will speak first
- Respond naturally as you would in a real call
- The call is recorded for transcript and scoring

**Ending the call:**
- Simply hang up when the conversation is complete
- The system will detect the end of the call
- Scoring will be processed automatically

---

## Reviewing Sessions

### Sessions List

Access from: **Home → View Sessions** or **Sessions** in the navigation

**The sessions list shows:**
- All your completed and in-progress simulations
- Session status badges (PENDING, IN_PROGRESS, COMPLETED, CANCELLED)
- Scenario name and job title
- Simulation type (📞 or 💬)
- Overall average score (if completed)
- Creation date and time

**Session status colors:**
- 🟢 **Green** - COMPLETED
- 🟡 **Yellow** - IN_PROGRESS
- ⚪ **Gray** - PENDING/CANCELLED

**Actions available:**
- **Resume** - Continue an in-progress session
- **View Details** - See full transcript and detailed scores

### Session Details

Click **View Details** on any session to see:

#### Left Panel - Transcript
- Complete conversation history
- Chronological message flow
- Timestamps for each message
- Searchable and scrollable

**Transcript format:**
- **Customer messages** - Gray bubble on left, labeled "C"
- **Your messages** - Blue bubble on right, labeled "You"
- Time displayed below each message

#### Right Panel - Scores

**Overall Score:**
- Large number showing average score
- Color-coded:
  - 🟢 Green (8-10) - Excellent
  - 🟡 Yellow (5-7) - Good
  - 🔴 Red (1-4) - Needs improvement

**Per-Criteria Breakdown:**
Each scoring criterion shows:
- Criterion name (e.g., "Empathy", "Product Knowledge")
- Score out of 10
- Visual progress bar
- AI-generated feedback (if available)

**Example criteria:**
- **Empathy** - How well you understood customer feelings
- **Problem Solving** - Effectiveness of your solutions
- **Product Knowledge** - Accuracy of product information
- **Communication** - Clarity and professionalism
- **Response Time** - Speed of handling the issue

---

## Analytics Dashboard

Access from: **Home → Analytics** or **Analytics** in the navigation

### Overview Statistics

**Top metrics:**
- **Total Sessions** - Number of simulations completed
- **Overall Average** - Your average score across all sessions
- **Score Trend** - Visual chart showing improvement over time

### Score Trend Chart

**Visual bar chart showing:**
- Daily or weekly average scores
- Color-coded bars (green/yellow/red)
- Hover to see exact scores and session counts
- Identifies performance patterns and trends

**How to interpret:**
- **Rising trend** - Your skills are improving! 📈
- **Flat trend** - Consistent performance 📊
- **Falling trend** - May need additional training 📉

### Breakdown by Job Title

**Shows performance by role:**
- Job title name
- Number of sessions for that role
- Average score for that role
- Visual score bar

**Use this to:**
- Identify which roles you're strongest in
- Focus training on weaker areas
- Track role-specific improvement

### Breakdown by Criteria

**Performance per scoring criterion:**
- Criterion name and weight
- Average score on that criterion
- Number of times scored
- Visual progress bar

**Use this to:**
- Identify your strongest skills
- Find areas needing improvement
- Focus on high-weight criteria

### Breakdown by Type

**Comparison of simulation modes:**
- CHAT vs PHONE performance
- Number of sessions per type
- Average scores per type

**Insights:**
- Some people perform better in chat vs voice
- Identify your preferred communication channel
- Balance training across all modes

---

## Admin Panel

**Access:** Home → Admin Panel (requires ADMIN role)

The admin panel has four tabs for managing the simulation platform:

### Tab 1: Criteria Management

**Purpose:** Define what aspects of performance are scored

**Actions:**
- ➕ **Add Criteria** - Create new scoring dimensions
- ✏️ **Edit** - Modify existing criteria
- 🗑️ **Delete** - Remove unused criteria

**Criteria fields:**
- **Name** (required) - e.g., "Empathy", "Product Knowledge"
- **Description** - What this criterion measures
- **Category** - Group similar criteria (e.g., "Soft Skills", "Technical")
- **Weight (1-10)** - Importance level (higher = more important)
- **Active** - Whether to use in current scoring

**Creating effective criteria:**
1. Be specific about what you're measuring
2. Use consistent terminology across criteria
3. Set appropriate weights based on business priorities
4. Keep the total number manageable (5-8 is ideal)

**Example criteria:**

| Name | Category | Weight | Description |
|------|----------|--------|-------------|
| Empathy | Soft Skills | 8 | Understanding and acknowledging customer emotions |
| Product Knowledge | Technical | 9 | Accuracy of product information provided |
| Problem Solving | Core Skills | 10 | Effectively resolving customer issues |
| Communication | Soft Skills | 7 | Clear, professional language |
| Closing | Process | 6 | Proper call/chat conclusion |

### Tab 2: Job Titles Management

**Purpose:** Define roles that employees will simulate

**Actions:**
- ➕ **Add Job Title** - Create new roles
- ✏️ **Edit** - Update role information
- 🗑️ **Delete** - Remove roles
- 🎯 **Assign Criteria** - Link specific criteria to this role

**Job title fields:**
- **Name** (required) - e.g., "Customer Support Rep", "Sales Associate"
- **Description** - What this role entails

**Assigning criteria to job titles:**
1. Click **Assign Criteria** on a job title
2. Check the criteria that apply to this role
3. Click **Save**
4. Only checked criteria will be scored for simulations in this role

**Example job titles:**
- Customer Support Representative
- Technical Support Specialist
- Sales Development Representative
- Account Manager
- Billing Specialist

### Tab 3: Scenarios Management

**Purpose:** Create realistic customer interaction scenarios

**Actions:**
- ➕ **Add Scenario** - Create new training situations
- ✏️ **Edit** - Modify existing scenarios
- 🗑️ **Delete** - Remove scenarios
- 📋 **View Script** - See scenario configuration

**Scenario fields:**
- **Name** (required) - Brief scenario title
- **Job Title** (required) - Which role this scenario belongs to
- **Type** (required) - PHONE, CHAT, or VOICE
- **Description** - What the scenario involves
- **Script (JSON)** - AI customer configuration

**Script configuration:**

The script is a JSON object that defines how the AI customer behaves:

```json
{
  "customerPersona": "Frustrated customer, item not delivered",
  "customerObjective": "Get refund or reship product",
  "difficulty": "medium",
  "hints": [
    "Customer is upset but willing to work with you",
    "Order #12345 placed 2 weeks ago",
    "Customer prefers phone contact"
  ]
}
```

**Script fields explained:**
- **customerPersona** - Who the customer is and their emotional state
- **customerObjective** - What the customer wants to achieve
- **difficulty** - `easy`, `medium`, `hard` (affects AI behavior)
- **hints** - Background information for realistic responses

**Creating effective scenarios:**
1. Base on real customer situations
2. Include clear objectives
3. Vary difficulty levels
4. Provide enough hints for realistic AI responses
5. Match scenario type to training goals

**Example scenarios:**

| Name | Type | Difficulty | Description |
|------|------|------------|-------------|
| Late Delivery Complaint | CHAT | Medium | Customer didn't receive package on time |
| Product Return Request | PHONE | Easy | Customer wants to return defective item |
| Billing Dispute | CHAT | Hard | Customer claims incorrect charge |
| Technical Support Issue | VOICE | Medium | Customer can't access account |
| Upsell Opportunity | PHONE | Medium | Existing customer interested in upgrade |

### Tab 4: Organizations Management

**Purpose:** Manage multi-tenant organization settings (if enabled)

**Actions:**
- ➕ **Create Organization** - Add new tenant organization
- ✏️ **Edit** - Update organization details
- 👥 **Manage Users** - Assign users to organizations

**Organization fields:**
- **Name** - Organization display name
- **Slug** - URL-friendly identifier
- **Plan** - FREE, PRO, or ENTERPRISE

---

## Tips & Best Practices

### For Employees (Users)

#### Before Starting
- ✅ Review the scenario description carefully
- ✅ Understand the job title requirements
- ✅ Choose a quiet environment for voice/phone simulations
- ✅ Have any reference materials ready if needed

#### During the Simulation
- ✅ **Be professional** - Treat the AI like a real customer
- ✅ **Take your time** - Don't rush responses
- ✅ **Stay in character** - Maintain the role throughout
- ✅ **Use proper grammar** - Especially in chat mode
- ✅ **Be empathetic** - Acknowledge customer concerns
- ✅ **Provide solutions** - Don't just sympathize, solve problems

#### After Completing
- ✅ Review your transcript honestly
- ✅ Read AI feedback carefully
- ✅ Identify patterns in low scores
- ✅ Practice weak areas more frequently
- ✅ Track improvement over time in analytics

### For Administrators

#### Setting Up Criteria
- ✅ Align criteria with business values
- ✅ Keep the list focused (5-10 criteria max)
- ✅ Weight criteria appropriately
- ✅ Review and update quarterly
- ✅ Get stakeholder input on what matters

#### Creating Scenarios
- ✅ Base on real customer interactions
- ✅ Include various difficulty levels
- ✅ Cover common situations first
- ✅ Add edge cases as users improve
- ✅ Test scenarios before deploying

#### Managing Users
- ✅ Assign appropriate roles
- ✅ Group users by actual job functions
- ✅ Monitor analytics for trends
- ✅ Provide feedback based on data
- ✅ Celebrate improvements publicly

---

## Troubleshooting

### Common Issues and Solutions

#### Can't Sign In
**Problem:** "Authentication failed" or redirect loop

**Solutions:**
1. Clear browser cache and cookies
2. Ensure JavaScript is enabled
3. Try a different browser
4. Contact admin to verify your account exists
5. Check if you're using the correct email address

#### Simulation Won't Start
**Problem:** Clicking "Start" doesn't load the simulation

**Solutions:**
1. Check browser console for errors (F12)
2. Verify you're signed in
3. Ensure database is awake (first load may take 10-15 seconds)
4. Try refreshing the page
5. Clear browser cache

#### Voice Mode Not Working
**Problem:** Microphone not detected or audio issues

**Solutions:**
1. Allow microphone permissions in browser
2. Check system microphone settings
3. Use Chrome or Edge (best compatibility)
4. Ensure no other app is using the microphone
5. Try headphones with a microphone

#### Phone Call Not Connecting
**Problem:** Call doesn't come through

**Solutions:**
1. Verify phone number is in E.164 format (+12125550100)
2. Check if your phone can receive calls
3. Wait 15-30 seconds for connection
4. Try again if it fails the first time
5. Contact admin to verify Telnyx configuration

#### Scores Not Appearing
**Problem:** Session completed but no scores shown

**Solutions:**
1. Wait a few minutes (scoring is AI-powered and may take time)
2. Refresh the session details page
3. Ensure the session is marked as COMPLETED
4. Check if job title has criteria assigned
5. Contact admin if issue persists

#### Chat Messages Not Sending
**Problem:** Message doesn't send or AI doesn't respond

**Solutions:**
1. Check internet connection
2. Ensure message isn't empty
3. Wait for AI response (may take 5-10 seconds)
4. Refresh page if stuck
5. Check browser console for errors

#### 404 - Page Not Found
**Problem:** Accessing a session or page that doesn't exist

**Solutions:**
1. Verify the URL is correct
2. Go back to home page and navigate normally
3. Session may have been deleted
4. Clear browser cache

#### 500 - Server Error
**Problem:** "Internal Server Error" message

**Solutions:**
1. Wait a moment and try again
2. Database may be waking up (serverless)
3. Check status page if available
4. Contact administrator
5. Report the error with what you were trying to do

### Database Wake-Up Times

XPElevator uses Neon serverless Postgres, which may "sleep" when inactive.

**Symptoms:**
- First page load takes 10-15 seconds
- "Failed to connect to database" messages
- Timeouts on initial requests

**Solutions:**
- Wait 10-15 seconds and try again
- Subsequent requests will be fast
- This is normal for serverless databases
- Production can be configured for always-on

### Browser Compatibility

**Recommended browsers:**
- ✅ Chrome (latest)
- ✅ Edge (latest)
- ✅ Firefox (latest)
- ⚠️ Safari (may have voice limitations)

**Not supported:**
- ❌ Internet Explorer (use Edge instead)
- ❌ Mobile browsers for voice mode (use chat instead)

### Getting Help

**If you're still experiencing issues:**

1. **Check the status page** (if configured)
2. **Review the browser console** (F12 → Console tab)
3. **Contact your administrator** with:
   - What you were trying to do
   - Error message (exact text or screenshot)
   - Browser and version
   - Timestamp when it occurred
4. **Report bugs** via your organization's support channel

---

## Keyboard Shortcuts

### Chat Interface
- **Enter** - Send message
- **Shift+Enter** - New line in message
- **Esc** - Focus message input box

### General Navigation
- **Alt+H** - Go to home (if configured)
- **Alt+S** - Go to sessions (if configured)
- **Alt+A** - Go to admin (if configured)

---

## Glossary

**Terms used in XPElevator:**

- **Simulation** - A single training session with an AI customer
- **Scenario** - A specific customer situation to practice (e.g., "Late Delivery")
- **Job Title** - A role being trained (e.g., "Customer Support Rep")
- **Criteria** - Aspects of performance being scored (e.g., "Empathy")
- **Session** - A completed or in-progress simulation
- **Transcript** - Full conversation history from a simulation
- **Score** - Rating (1-10) on a specific criterion
- **AI Customer** - The virtual customer powered by Groq LLM
- **CHAT mode** - Text-based simulation
- **VOICE mode** - Browser microphone-based simulation
- **PHONE mode** - Real phone call simulation via Telnyx
- **Weight** - Importance multiplier for a scoring criterion

---

## Appendix: Technical Details

### Data Privacy

- Conversations are stored in the database
- Admins with proper permissions can view all sessions
- Members can only view their own sessions
- Phone calls are recorded for scoring purposes
- No data is shared with third parties except AI providers (Groq)

### AI Model Information

- **Provider:** Groq
- **Model:** llama-3.3-70b-versatile (chat), llama3-70b-8192 (voice)
- **Temperature:** 0.75 (balanced creativity/consistency)
- **Max tokens:** 400 words per response

### System Architecture

- **Frontend:** Next.js 16 with React 19
- **Backend:** Cloudflare Workers (edge runtime)
- **Database:** Neon Postgres (serverless)
- **Voice:** Telnyx (phone), Browser WebRTC (voice mode)
- **Deployment:** Cloudflare Pages at xpelevator.com

### API Rate Limits

Default limits (may vary by organization):
- **Chat messages:** 100 per minute per user
- **Simulations:** 20 starts per minute per user
- **API requests:** 1000 per hour per user

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 23, 2026 | Initial user guide |

---

## Feedback

Help us improve XPElevator! Send feedback to your administrator or development team.

**We'd love to hear about:**
- 🎯 Features you find most useful
- 🐛 Bugs or issues you encounter
- 💡 Ideas for improvement
- 📖 Unclear documentation

---

**End of User Guide**

For technical documentation, see [ARCHITECTURE.md](ARCHITECTURE.md).  
For development setup, see [README.md](../README.md).
