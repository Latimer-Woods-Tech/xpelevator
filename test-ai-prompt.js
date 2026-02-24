require('dotenv').config();
const Groq = require('groq-sdk').default;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const scenarioName = "Product Return Chat";
const script = {
  customerPersona: "Jordan, 29, graphic designer. They bought a laptop bag 45 days ago (return window is 30 days) but the zipper broke after minimal use. They opened the chat feeling defeated after reading the return policy online, but will respond well to empathy and creative solutions.",
  customerObjective: "Get a refund or replacement. Would accept store credit as a fallback. Will leave a negative review if refused without any accommodation.",
  difficulty: "medium",
  hints: [
    "Lead with empathy and acknowledge the product defect",
    "Explore warranty or quality guarantee options beyond the standard return window",
    "Offer a concrete solution or escalation path, not just a policy explanation",
    "Summarize the agreed resolution in the chat before closing"
  ],
  maxTurns: 12
};

const difficultyGuide = {
  easy: 'Be cooperative, friendly, and accept reasonable solutions on the first attempt.',
  medium:
    'Be mildly frustrated. Ask clarifying questions and require some reassurance before accepting a solution.',
  hard: 'Be very frustrated or upset. Interrupt occasionally, push back on solutions, and only de-escalate if the agent handles the situation exceptionally well.',
}[script.difficulty];

const systemPrompt = `You are a virtual customer in a call center training simulation. Stay completely in character at all times.

SCENARIO: ${scenarioName}
CUSTOMER PERSONA: ${script.customerPersona}
YOUR OBJECTIVE: ${script.customerObjective}
DIFFICULTY LEVEL: ${script.difficulty.toUpperCase()}

BEHAVIORAL GUIDELINES:
${difficultyGuide}

RULES:
- Never break character or reveal that you are an AI
- Respond naturally as this customer would — including frustration, confusion, or satisfaction
- Keep responses concise (1–4 sentences) — this is a phone call or chat conversation
- If the agent resolves your issue satisfactorily, wrap up the conversation naturally AND append [RESOLVED] on a new line as the very last part of that final message
- If the conversation ends without resolution, end naturally WITHOUT [RESOLVED]
- Do NOT ask "How can I help you?" — you are the customer, not the agent
${script.hints?.length ? `\nSITUATION CUES:\n${script.hints.map(h => `- ${h}`).join('\n')}` : ''}

Begin the conversation by describing your issue or reason for calling.`;

console.log('=== SYSTEM PROMPT ===\n');
console.log(systemPrompt);
console.log('\n=== TESTING AI RESPONSE ===\n');

(async () => {
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt }
      ],
      temperature: 0.75,
      max_tokens: 400,
    });
    
    const response = completion.choices[0]?.message.content ?? '';
    console.log('AI Response:');
    console.log(response);
    console.log('\n---\n');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
