let twilioClient = null;

const getClient = () => {
  if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

const sendVisitorCodeSMS = async ({ to, visitorName, code, estateName, expectedDate }) => {
  const client = getClient();
  if (!client || !process.env.TWILIO_PHONE_NUMBER) return { skipped: true };

  const dateStr = new Date(expectedDate).toLocaleDateString();
  const message = `${estateName} Estate: Hi ${visitorName}, your visitor code is ${code} for ${dateStr}. Show this at the gate.`;

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    return { sent: true };
  } catch (err) {
    console.error('SMS send failed:', err.message);
    return { error: err.message };
  }
};

module.exports = { sendVisitorCodeSMS };
