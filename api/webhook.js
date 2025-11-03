// api/webhook.js
// Fortunex AI backend endpoint for Stripe webhook verification

const Stripe = require('stripe');
const getRawBody = require('raw-body');

// Disable automatic body parsing so we can verify the Stripe signature
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    res.statusCode = 400;
    return res.end(`Unable to read raw body: ${err.message}`);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    res.statusCode = 400;
    return res.end(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle the events you care about
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('✅ Checkout session completed:', event.data.object.id);
        break;

      case 'invoice.payment_succeeded':
        console.log('💰 Payment succeeded:', event.data.object.id);
        break;

      case 'customer.subscription.deleted':
        console.log('🧾 Subscription canceled:', event.data.object.id);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Handler error:', err);
    res.statusCode = 500;
    return res.end('Webhook handler failed');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ received: true }));
};
