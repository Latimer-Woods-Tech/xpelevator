#!/usr/bin/env tsx
/**
 * Simple chat test script to verify the chat functionality is working.
 * Run with: npx tsx test-chat.js
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function testChat() {
  console.log('🧪 Testing XPElevator Chat Functionality');
  console.log('=====================================');

  try {
    // Test 1: Check if GROQ API is working
    console.log('\n1. Testing GROQ API...');
    const groqRes = await fetch(`${BASE_URL}/api/test-groq`);
    const groqData = await groqRes.json();

    if (groqData.success) {
      console.log('✅ GROQ API is working');
      console.log(`   Response: ${groqData.response}`);
    } else {
      console.log('❌ GROQ API failed:', groqData.error);
      return;
    }

    // Test 2: Check if jobs API is working
    console.log('\n2. Testing Jobs API...');
    const jobsRes = await fetch(`${BASE_URL}/api/jobs`);
    const jobsData = await jobsRes.json();

    if (Array.isArray(jobsData) && jobsData.length > 0) {
      console.log('✅ Jobs API is working');
      console.log(`   Found ${jobsData.length} job titles`);
    } else {
      console.log('❌ Jobs API failed or no data');
      console.log('   Make sure to run: npm run seed');
      return;
    }

    // Test 3: Try to create a simulation session
    console.log('\n3. Testing Simulation Creation...');
    const firstJob = jobsData[0];
    const firstScenario = firstJob.scenarios?.[0];

    if (!firstScenario) {
      console.log('❌ No scenarios found for job:', firstJob.name);
      return;
    }

    const simRes = await fetch(`${BASE_URL}/api/simulations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobTitleId: firstJob.id,
        scenarioId: firstScenario.id,
        type: firstScenario.type,
        userId: 'test-user',
      }),
    });

    const simData = await simRes.json();

    if (simRes.ok && simData.id) {
      console.log('✅ Simulation created successfully');
      console.log(`   Session ID: ${simData.id}`);

      // Test 4: Try the chat API
      console.log('\n4. Testing Chat API...');
      const chatRes = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: simData.id,
          content: 'Hello, I need help with my account.',
        }),
      });

      if (chatRes.ok) {
        console.log('✅ Chat API responded successfully');
        console.log('   Chat functionality appears to be working!');
      } else {
        const chatError = await chatRes.json();
        console.log('❌ Chat API failed:', chatError.error);
      }

    } else {
      console.log('❌ Simulation creation failed:', simData.error);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }

  console.log('\n=====================================');
  console.log('Test completed. Check the results above.');
}

// Run the test
testChat().catch(console.error);