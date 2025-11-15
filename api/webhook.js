// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const getRawBody = require('raw-body');

module.exports = async (req, res) => {
  // Stripe will POST to this endpoint. Browsers doing GET should get 405.
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Read raw body buffer
    const buf = await getRawBody(req);

    // Verify signature with your webhook secret from Vercel env
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // At this point the event is VERIFIED and parsed
  console.log('✅ Webhook received:', event.id, event.type);

  // For now, don't do any extra logic – just acknowledge
  res.status(200).json({ received: true });
};
